import { eq } from "drizzle-orm"

import { db, messages } from "@/db"
import { readAppDoc, type AppDoc } from "@app/shared/app-runtime/app-doc"
import { emptyDataModel, normalizeDataModel, type DataModel } from "@app/shared/app-runtime/data-model"
import { asMotionLevel, baseThemeFromPlan, fallbackThemes, normalizeThemes, type AppTheme, type ThemePackage } from "@app/shared/app-runtime/theme"
import { autoImport, checkFile, projectExports, screenPath, type ProjectFiles } from "@app/shared/app-project/project"
import { undefinedNames } from "@/lib/app-project/analyze"
import { applyHunks, parseEdits } from "@/lib/app-project/patch"
import { ICONS } from "@app/shared/app-project/icons"
import { platformFiles } from "@/lib/app-project/templates"
import { PLATFORM_KIT_FILES } from "@/lib/app-project/platform-kits"
import { withApiClientDeps } from "@/lib/app-project/api-client"
import { compileManifest } from "@app/shared/manifest/compile"
import { syncManifest } from "@app/shared/manifest/migrate"
import { coderAdapter } from "@/lib/verify/coder"
import { MAX_REPAIRS, runChange } from "@/lib/verify/run"
import { verifiedNewScreenPrompt } from "@/lib/verify/prompts"
import { commitSnapshot } from "@/lib/versions/store"
import { getAgents, heartbeat, streamText } from "./agents"
import { regenOutcome, screenSideFiles, storedSideFiles } from "./generation-guard"
import { latestPlan, loadProject, saveDoc, saveMessage, saveScreens, setPhase } from "./history"
import { fillSeedImages } from "./seed-images"
import {
  fixPrompt,
  foundationPrompt,
  layoutsPrompt,
  routeContracts,
  shellPrompt,
} from "./prompts"
import {
  componentsHash,
  dataHash,
  extractCode,
  parseFiles,
  parseFoundationJson,
  screenBuildHash,
  screenSpecHash,
  shellHash,
  themeHash,
} from "./protocol"
import type { LiveRun } from "./registry"
import type { AppPlan, BuildProgress, GeneratedScreen } from "@app/shared/agent/types"
import { emitAttempts, verifyDebugFail } from "./verify-glue"

// ---------------------------------------------------------------- foundation

/**
 * Makes the theme package and data model the screens are built on. Parts
 * that are still current are kept (a plan tweak that doesn't touch the design
 * keeps the creator's chosen theme). Never fails: a broken AI answer falls
 * back to derived themes and an empty data model.
 */
async function buildFoundation(
  run: LiveRun,
  plan: AppPlan,
  doc: AppDoc
): Promise<{ themes: ThemePackage; data: DataModel }> {
  const tHash = themeHash(plan)
  const dHash = dataHash(plan)
  let themes = doc.themes?.hash === tHash && doc.themes.themes.length ? doc.themes : undefined
  let data = doc.data?.hash === dHash ? doc.data : undefined
  if (themes && data) return { themes, data }

  const { foundation } = getAgents()
  const hb = heartbeat(run, () => "Creating the theme package and app data")
  let raw = ""
  try {
    const base = fallbackThemes(plan)[0]
    raw = await streamText(foundation, foundationPrompt(plan, base, new Date().toISOString().slice(0, 10), data ? undefined : doc.data), () => hb.touch())
  } catch (e) {
    console.warn("foundation generation failed, using fallbacks", e instanceof Error ? e.message : e)
  } finally {
    hb.stop()
  }
  const parsed = parseFoundationJson(raw)

  if (!themes) {
    const list = parsed?.themes ? normalizeThemes(parsed.themes, plan) : fallbackThemes(plan)
    const keep = doc.themes?.activeId
    themes = { themes: list, activeId: list.some((t) => t.id === keep) ? keep! : list[0].id, hash: tHash, motion: asMotionLevel(parsed?.motion) }
  }
  if (!data) {
    const fresh = parsed?.data ? normalizeDataModel(parsed.data, dHash) : emptyDataModel(dHash)
    data = doc.data ? mergeDataModels(doc.data, fresh, dHash) : fresh
  }
  return { themes, data }
}

/**
 * Keeps every collection the built screens already use (same name, fields
 * and seed), adding only what the new model brings, so a plan change never
 * pulls the data out from under existing screens.
 */
function mergeDataModels(old: DataModel, next: DataModel, hash: string): DataModel {
  const names = new Set(old.collections.map((c) => c.name))
  return {
    collections: [...old.collections, ...next.collections.filter((c) => !names.has(c.name))],
    settings: { ...next.settings, ...old.settings },
    user: old.user,
    hash,
  }
}

// ---------------------------------------------------------------- code checks

const MAX_FIXES = 2

/**
 * Everything that would stop a file from running: syntax, imports, missing
 * default export, hard-coded colors, and any name used but never defined.
 * Missing imports that can be inferred (well-known APIs, the project's own
 * components) are added first, with no AI round trip.
 */
function inspectFile(path: string, code: string, files: ProjectFiles): { code: string; problems: string[] } {
  const exports = projectExports(files)
  const fixed = autoImport(code, exports)
  const problems = checkFile(path, fixed, files)
  if (!problems.some((p) => p.startsWith("Syntax error"))) {
    const missing = undefinedNames(path, fixed)
    if (missing.length) {
      const available = Object.entries(exports)
        .map(([n, e]) => `${n} (${e.isDefault ? "default export of" : "from"} "${e.module}")`)
        .join(", ")
        .slice(0, 2000)
      problems.push(
        `These names are used but never defined or imported, so the app would crash: ${missing.join(", ")}. Import each from where it is defined, define it in this file, or replace it with something that exists. The project's own components and modules are: ${available || "none"}.`
      )
    }
  }
  return { code: fixed, problems }
}

/**
 * Checks a file and asks the model to repair it until it passes (or the
 * attempts run out). `reported` adds problems seen at runtime, which always
 * get at least one repair attempt. Returns the best version and what is
 * still wrong.
 */
async function checkAndFix(
  run: LiveRun,
  path: string,
  code: string,
  files: ProjectFiles,
  label: string,
  reported: string[] = []
): Promise<{ code: string; problems: string[] }> {
  const { fixer } = getAgents()
  let { code: current, problems } = inspectFile(path, code, files)
  problems = [...reported, ...problems]
  // Only problems that stop the app from running are worth a (slow) rewrite.
  // Style warnings ride along in the same request when there is one.
  for (let attempt = 0; attempt < MAX_FIXES && blocking(problems).length; attempt++) {
    run.emit({ type: "status", text: `Fixing ${label}` })
    const hb = heartbeat(run, () => `Fixing ${label}`)
    // First a small patch (seconds); the last attempt asks for the whole file.
    const whole = attempt === MAX_FIXES - 1
    console.warn(`[fix] ${path} attempt ${attempt + 1} (${whole ? "whole file" : "patch"}):`, blocking(problems))
    try {
      const info: { finishReason?: string } = {}
      const raw = await streamText(fixer, fixPrompt(path, current, problems, whole ? "file" : "patch"), () => hb.touch(), undefined, info)
      // A cut-off reply is unusable; don't let it replace anything.
      if (info.finishReason === "length") {
        console.warn(`[fix] ${path}: fixer output cut off at the limit`)
        continue
      }
      let candidate: string | null = null
      const edits = parseEdits(raw).filter((e) => e.path === path || e.path.endsWith(path.split("/").pop()!))
      for (const e of edits) {
        if (e.kind === "file") candidate = e.code
        else {
          const applied = applyHunks(candidate ?? current, e.hunks)
          if (!applied.failed.length) candidate = applied.code
        }
      }
      // A bare code reply (no blocks) is a whole file.
      if (candidate === null && !edits.length && /export\s+default|export\s+(function|const)/.test(raw)) candidate = extractCode(raw)
      if (candidate === null) continue
      const next = inspectFile(path, candidate, files)
      // Keep the fix only if it is no worse. A runtime report counts as fixed once the model has rewritten the file.
      if (next.problems.length <= problems.length) {
        current = next.code
        problems = next.problems
      }
    } catch (e) {
      console.warn("fix attempt failed", path, e instanceof Error ? e.message : e)
    } finally {
      hb.stop()
    }
  }
  return { code: current, problems }
}

/** Only syntax and import problems stop a file from running; style warnings don't. */
const blocking = (problems: string[]) => problems.filter((p) => !p.startsWith("Found "))

// ---------------------------------------------------------------- app shell

const SHELL_PATH = /^(app\/_layout\.tsx|app\/\(tabs\)\/_layout\.tsx|components\/[\w-]+\.tsx?)$/

/** Fallback layouts (root stack with its modals, native tabs), used only where the AI's shell didn't produce a working file. */
function templateShell(plan: AppPlan): ProjectFiles {
  const modals = plan.screens.filter((s) => s.presentation === "modal")
  const out: ProjectFiles = {
    "app/_layout.tsx": `import { Stack } from "expo-router"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ThemeProvider } from "@/theme"

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <Stack screenOptions={{ headerShown: false }}>
${modals.map((s) => `            <Stack.Screen name="${s.id}" options={{ presentation: "modal" }} />`).join("\n")}
          </Stack>
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
`,
  }
  const tabs = plan.screens.filter((s) => s.presentation === "tab")
  if (tabs.length) {
    // Native tabs with icons picked from the shared vocabulary by name.
    const icon = (s: (typeof tabs)[number]) => {
      const words = `${s.id} ${s.name}`.toLowerCase()
      return ICONS.find((i) => words.includes(i.md.split("_")[0]) || words.includes(i.sf.split(".")[0])) ?? ICONS[0]
    }
    out["app/(tabs)/_layout.tsx"] = `import { NativeTabs } from "expo-router/native-tabs"
import { useTheme } from "@/theme"

export default function TabsLayout() {
  const t = useTheme()
  return (
    <NativeTabs tintColor={t.colors.primary}>
${tabs
  .map((s) => {
    const i = icon(s)
    return `      <NativeTabs.Trigger name="${s.id}">
        <NativeTabs.Trigger.Label>${s.name.replace(/[<>{}]/g, "")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "${i.sf}", selected: "${i.sfSelected}" }} md="${i.md}" />
      </NativeTabs.Trigger>`
  })
  .join("\n")}
    </NativeTabs>
  )
}
`
  }
  return out
}

const LAYOUT_PATH = /^(app\/_layout\.tsx|app\/\(tabs\)\/_layout\.tsx)$/

/**
 * Layouts and the app's own shared components, written by the AI; files are
 * checked in parallel. With `keep`, the components stay as they are and only
 * the layouts are written (a navigation change with the same design).
 */
async function buildShell(
  run: LiveRun,
  plan: AppPlan,
  theme: AppTheme,
  platform: ProjectFiles,
  plannedPaths: string[],
  keep?: { components: ProjectFiles; layouts: ProjectFiles }
): Promise<ProjectFiles> {
  const templates = templateShell(plan)
  const { shell } = getAgents()
  const hb = heartbeat(run, () => (keep ? "Updating navigation" : "Setting up navigation and components"))
  let raw = ""
  try {
    raw = await streamText(shell, keep ? layoutsPrompt(plan, theme, keep.layouts, keep.components) : shellPrompt(plan, theme), () => hb.touch())
  } catch (e) {
    console.warn("shell generation failed", e instanceof Error ? e.message : e)
  } finally {
    hb.stop()
  }
  const hasTabs = plan.screens.some((s) => s.presentation === "tab")
  const allowed = keep ? LAYOUT_PATH : SHELL_PATH
  const generated = Object.fromEntries(
    Object.entries(parseFiles(raw)).filter(([p]) => allowed.test(p) && (hasTabs || !p.startsWith("app/(tabs)/")))
  )
  // Screens don't exist yet, but layouts may reference their files.
  const placeholders = Object.fromEntries(plannedPaths.map((p) => [p, ""]))
  const all: ProjectFiles = { ...platform, ...placeholders, ...keep?.components, ...generated }
  // Each file is checked (and repaired if needed) independently, so in parallel.
  const checked = await Promise.all(
    Object.entries(generated).map(async ([path, code]) => {
      const r = await checkAndFix(run, path, code, all, path.replace(/^components\//, ""))
      if (blocking(r.problems).length) {
        console.warn("dropping shell file", path, r.problems)
        return null
      }
      return [path, r.code] as const
    })
  )
  const out: ProjectFiles = { ...keep?.components, ...Object.fromEntries(checked.filter((x): x is readonly [string, string] => !!x)) }
  for (const [path, code] of Object.entries(templates)) out[path] ??= code
  return out
}

// ---------------------------------------------------------------- screen generation

const STYLE_REF_LIMIT = 12_000

/** Screens built at the same time after the first one (AI_SCREEN_CONCURRENCY to change). */
const SCREEN_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.AI_SCREEN_CONCURRENCY) || 3))

export async function runGeneration(run: LiveRun, projectId: string) {
  const plan = await latestPlan(projectId)
  if (!plan) throw new Error("There is no plan to build yet.")
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const previous = new Map(doc.screens.map((s) => [s.id, s]))
  const dHash = dataHash(plan)
  const sHash = shellHash(plan)
  const cHash = componentsHash(plan)

  // The shell is two parts: shared components (follow the design) and layouts
  // (follow the tab/modal structure). A navigation change only redoes the layouts.
  const keepShell = doc.shellHash === sHash && !!doc.files?.["app/_layout.tsx"]
  const oldComponents = Object.fromEntries(Object.entries(doc.files ?? {}).filter(([p]) => /^components\/[\w-]+\.tsx?$/.test(p)))
  const keepComponents =
    keepShell ||
    (Object.keys(oldComponents).length > 0 &&
      // Projects built before componentsHash existed: the theme hash tracks the same design fields.
      (doc.componentsHash ? doc.componentsHash === cHash : doc.themes?.hash === themeHash(plan)))

  // Keep screens whose own spec, components and routes haven't changed; (re)build the rest, in plan order.
  let screens: GeneratedScreen[] = plan.screens.map((s) => {
    const hash = screenBuildHash(plan, s)
    const prev = previous.get(s.id)
    const path = screenPath(s)
    // Screens built before screenBuildHash existed carry the older, stricter hash.
    const current = prev?.specHash === hash || (prev?.specHash === screenSpecHash(plan, s, sHash) && keepShell)
    return prev && prev.state === "ready" && current && keepComponents && prev.code && prev.path === path
      ? { ...prev, name: s.name, specHash: hash }
      : { id: s.id, name: s.name, state: "pending", specHash: hash, path }
  })
  const todo = screens.filter((s) => s.state !== "ready").map((s) => s.id)

  const progress = (): BuildProgress => ({ screens: screens.map(({ id, name, state }) => ({ id, name, state })) })
  await saveDoc(projectId, { ...doc, screens }, { status: "generating", screensCount: screens.length })
  run.emit({ type: "phase", phase: "generating" })

  const buildMsg = await saveMessage(projectId, {
    sender: "assistant",
    kind: "build",
    text: todo.length
      ? `Building ${todo.length} React Native ${todo.length === 1 ? "screen" : "screens"}, one at a time, on a switchable theme package.`
      : "Every screen is already up to date.",
    build: progress(),
  })
  run.emit({ type: "build_start", message: buildMsg, screens })

  // Themes + data and the shell don't depend on each other: build them in
  // parallel. The shell is designed against the plan's own palette, which
  // is what the theme package's first theme is anyway.
  const designTheme = baseThemeFromPlan(plan)
  const t0 = Date.now()
  run.emit({
    type: "status",
    text: keepShell ? "Creating the theme package and app data" : keepComponents ? "Updating navigation, themes and data" : "Setting up themes, data and navigation",
  })
  const [{ themes, data }, shellFiles] = await Promise.all([
    buildFoundation(run, plan, doc).then(async (r) => {
      console.info(`[build ${projectId}] foundation ${Date.now() - t0}ms`)
      const data = await fillSeedImages(r.data, run)
      const result = { themes: r.themes, data }
      run.emit({ type: "foundation", themes: result.themes, data: result.data })
      return result
    }),
    keepShell
      ? Object.fromEntries(Object.entries(doc.files!).filter(([p]) => SHELL_PATH.test(p)))
      : buildShell(
          run,
          plan,
          designTheme,
          // Only the file paths matter for checking the shell's imports.
          { ...platformFiles(plan, { themes: [designTheme], activeId: designTheme.id, hash: "" }, doc.data ?? emptyDataModel()), ...PLATFORM_KIT_FILES },
          screens.map((s) => s.path!),
          // Same design: keep the components (screens are built on them) and redo only the layouts.
          keepComponents
            ? { components: oldComponents, layouts: Object.fromEntries(Object.entries(doc.files ?? {}).filter(([p]) => LAYOUT_PATH.test(p))) }
            : undefined
        ).then((r) => {
          console.info(`[build ${projectId}] shell ${Date.now() - t0}ms (${Object.keys(r).length} files)`)
          return r
        }),
  ])

  // Project files: platform modules and config, then the shell. On the
  // Navigation and typed nav/data files come from the manifest compiler,
  // not the AI shell (Phase 6): the manifest is built once (or reused from
  // a previous edit) and recompiled on every build so it never drifts from
  // the plan. The component and motion kits ship the same way: platform
  // files, not AI-written.
  // platformFiles() always starts package.json from the base template, which
  // has no axios/react-query -- backend-conversion.ts only adds those once,
  // at connect time, into package.json directly, not this template, so every
  // build after that has to re-merge them back in or they silently vanish
  // the moment any edit (not just a connect/disconnect) rebuilds this file,
  // even though the connected screens still import @/lib/api and need them.
  const platform = { ...platformFiles(plan, themes, data), ...PLATFORM_KIT_FILES }
  if (doc.backend.provider !== "local" && platform["package.json"]) platform["package.json"] = withApiClientDeps(platform["package.json"])
  const manifest = syncManifest({ ...doc, data }, plan)
  const generated = compileManifest(manifest, { connected: doc.backend.provider !== "local" })
  let sideFiles = storedSideFiles(doc.files ?? {}, (p) => SHELL_PATH.test(p))
  let files: ProjectFiles = { ...platform, ...shellFiles, ...generated, ...sideFiles }
  await saveDoc(projectId, { ...doc, screens, themes, data, files, manifest, shellHash: sHash, componentsHash: cHash })
  run.emit({ type: "files", files })

  // Several screens finish at once now, so progress saves are queued: each
  // write carries the latest state and they run one after another, in order.
  let saveChain: Promise<void> = Promise.resolve()
  const update = (screenId: string, patch: Partial<GeneratedScreen>) => {
    screens = screens.map((s) => (s.id === screenId ? { ...s, ...patch } : s))
    const snapshot = screens
    const build = progress()
    run.emit({ type: "build_progress", messageId: buildMsg.id, build })
    saveChain = saveChain
      .then(async () => {
        await saveScreens(projectId, snapshot)
        await db.update(messages).set({ pipelineData: build }).where(eq(messages.id, buildMsg.id))
      })
      .catch((e) => console.error("saving build progress failed", e))
    return saveChain
  }

  const components = () => Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("components/")))
  // What each screen is opened with, agreed before any screen is written, so callers and callees match.
  const contracts = routeContracts(plan, data)

  // One status line for everything in flight.
  const active = new Set<string>()
  const statusText = () => (active.size ? `Building ${[...active].join(", ")}` : "Finishing up")

  let failures = 0
  const kept: string[] = []
  const buildScreen = async (screenId: string, n: number) => {
    const spec = plan.screens.find((s) => s.id === screenId)!
    const path = screenPath(spec)
    // The first finished screen keeps the rest consistent.
    const reference = screens.find((s) => s.state === "ready" && s.code && s.id !== screenId)?.code

    active.add(spec.name)
    void update(screenId, { state: "generating", error: undefined, code: undefined })
    run.emit({ type: "screen_start", id: screenId, index: n, total: todo.length })
    run.emit({ type: "status", text: statusText() })

    const started = Date.now()
    const hb = heartbeat(run, statusText)
    let code = ""
    let error: string | undefined
    try {
      // A brand-new screen goes through the same change gateway an edit
      // does: the coder model (@/kit, typed @/nav and @/data/types), bounded
      // repair fed with real diagnostics, then parse/policy/tsc/render gates
      // before anything is kept. Snapshot the other screens built so far
      // once; concurrent siblings finishing mid-repair aren't picked up, same
      // as an edit's own single Workspace snapshot.
      const allFiles = { ...files, ...Object.fromEntries(screens.filter((s) => s.code && s.path).map((s) => [s.path!, s.code!])) }
      const prompt = verifiedNewScreenPrompt(spec, screenId, path, {
        manifest,
        data,
        components: components(),
        styleReference: reference?.slice(0, STYLE_REF_LIMIT),
        contracts,
        motion: themes.motion ?? "subtle",
      })
      const result = await runChange({ files: allFiles }, prompt, coderAdapter, {
        debugFail: verifyDebugFail(),
        projectKey: projectId,
        onDelta: (delta) => {
          hb.touch()
          run.emit({ type: "screen_delta", id: screenId, delta })
        },
        onState: (state) => {
          if (state !== "writing" && state !== "repairing") return
          // Reset the live preview for the retry; the client clears its
          // buffer for this screen id on screen_start.
          run.emit({ type: "screen_start", id: screenId, index: n, total: todo.length })
          run.emit({ type: "status", text: state === "repairing" ? `Retrying ${spec.name}` : statusText() })
        },
      })
      emitAttempts(run, result.attempts)
      if (result.state === "needs_user") {
        error = result.reason === "question" ? result.message : `Didn't pass the verified engine's checks after ${MAX_REPAIRS} repair rounds: ${result.message}`
        console.warn(`[build ${projectId}] screen ${screenId}: ${error}`)
      } else {
        code = result.ws.files[path]
        const extra = screenSideFiles(path, allFiles, result.ws.files, result.changed)
        if (Object.keys(extra).length) {
          sideFiles = { ...sideFiles, ...extra }
          files = { ...files, ...extra }
          run.emit({ type: "files", files })
        }
        console.info(`[build ${projectId}] screen ${screenId}: verified in ${Date.now() - started}ms (${result.attempts.length} attempt${result.attempts.length === 1 ? "" : "s"})`)
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Generation failed."
      console.error("screen generation failed", screenId, e)
    } finally {
      hb.stop()
    }

    active.delete(spec.name)
    const outcome = regenOutcome(previous.get(screenId), path, code, error)
    if (outcome.kept) kept.push(spec.name)
    if (outcome.failed) failures++
    void update(screenId, outcome.patch)
    run.emit({ type: "screen_done", screen: screens.find((s) => s.id === screenId)! })
    if (active.size) run.emit({ type: "status", text: statusText() })
  }

  // The first screen alone sets the visual reference (unless one is already
  // built); the rest are built a few at a time.
  const tBuild = Date.now()
  const queue = todo.map((id, n) => [id, n] as const)
  if (!screens.some((s) => s.state === "ready" && s.code) && queue.length) {
    const [id, n] = queue.shift()!
    await buildScreen(id, n)
  }
  const workers = Array.from({ length: Math.min(SCREEN_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await buildScreen(next[0], next[1])
  })
  await Promise.all(workers)
  await saveChain
  console.info(`[build ${projectId}] ${todo.length} screens in ${Date.now() - tBuild}ms (concurrency ${SCREEN_CONCURRENCY})`)

  // The shell is kept; refresh only in case a later build changes it.
  files = { ...platform, ...shellFiles, ...generated, ...sideFiles }
  const finalDoc: AppDoc = { ...doc, screens, themes, data, files, manifest, shellHash: sHash, componentsHash: cHash }
  const { version, doc: committedDoc } = await commitSnapshot(projectId, finalDoc, {
    author: project.userId,
    intent: todo.length ? `Built ${todo.length} screen${todo.length === 1 ? "" : "s"}` : "Rebuilt (no screens changed)",
    runId: run.runId,
  })
  // commitSnapshot may have pruned package.json/app.json; the client's code
  // tab is built from the files stream, not a fresh read of this commit, so
  // without this it would show the pre-prune files until reopened.
  if (committedDoc.files && committedDoc.files !== files) run.emit({ type: "files", files: committedDoc.files })
  await setPhase(projectId, "ready")
  run.emit({ type: "phase", phase: "ready" })
  const done = screens.filter((s) => s.state === "ready").length
  const keptNote = kept.length ? ` Kept the previous version of ${kept.join(", ")}.` : ""
  const summary = await saveMessage(projectId, {
    sender: "assistant",
    kind: "standard",
    text:
      (failures
        ? `${done} of ${screens.length} screens are ready. ${failures === 1 ? "One screen" : `${failures} screens`} didn't come out right; say "retry" and I'll rebuild ${failures === 1 ? "it" : "them"}.`
        : `All ${screens.length} screens are written in React Native and wired together. Tap through the app in **Preview**, see the code in **Code**, try other looks from the **theme menu** above the canvas, or select a screen and choose **Edit with AI**.`) + keptNote,
    version,
  })
  run.emit({ type: "message_done", message: summary })
}
