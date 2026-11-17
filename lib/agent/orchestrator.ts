import "server-only"
import { randomBytes } from "node:crypto"
import { Agent, assistant, run as runAgent, system, user, type AgentInputItem } from "@openai/agents"
import { asc, desc, eq, sql } from "drizzle-orm"

import { db, messages, projects, type Project } from "@/db"
import { readAppDoc, type AppDoc } from "@/lib/app-runtime/app-doc"
import { commitSnapshot } from "@/lib/versions/store"
import { engineOf } from "@/lib/verify/engine"
import { coderAdapter } from "@/lib/verify/coder"
import { runChange } from "@/lib/verify/run"
import { verifiedEditPrompt } from "@/lib/verify/prompts"
import { docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import type { GateName } from "@/lib/verify/types"
import { regenOutcome } from "./generation-guard"
import { emptyDataModel, normalizeDataModel, type DataModel } from "@/lib/app-runtime/data-model"
import { baseThemeFromPlan, fallbackThemes, normalizeThemes, type AppTheme, type ThemePackage } from "@/lib/app-runtime/theme"
import { autoImport, checkFile, projectExports, screenPath, type ProjectFiles } from "@/lib/app-project/project"
import { undefinedNames } from "@/lib/app-project/analyze"
import { applyHunks, parseEdits } from "@/lib/app-project/patch"
import { ICONS } from "@/lib/app-project/icons"
import { platformFiles } from "@/lib/app-project/templates"
import { getFastModel, getModel, reasoningEffort, reasoningProviderData } from "./config"
import {
  FOUNDATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  SCREEN_INSTRUCTIONS,
  SHELL_INSTRUCTIONS,
  EDIT_INSTRUCTIONS,
  editPrompt,
  editRetryPrompt,
  fixPrompt,
  foundationPrompt,
  layoutsPrompt,
  routeContracts,
  screenPrompt,
  shellPrompt,
} from "./prompts"
import {
  TagStreamFilter,
  type EditRequest,
  dataHash,
  extractCode,
  parseFiles,
  parseFoundationJson,
  parsePlanJson,
  parsePlannerReply,
  componentsHash,
  screenBuildHash,
  screenSpecHash,
  shellHash,
  themeHash,
} from "./protocol"
import type { LiveRun } from "./registry"
import type {
  AgentPhase,
  AppPlan,
  BuildProgress,
  ChatMessageKind,
  GeneratedScreen,
  StoredMessage,
} from "./types"

const id = (p: string) => `${p}-${Date.now()}-${randomBytes(3).toString("hex")}`

let planner: Agent | null = null
let designer: Agent | null = null
let planFixer: Agent | null = null
let foundation: Agent | null = null
let shell: Agent | null = null
let fixer: Agent | null = null
let editor: Agent | null = null

function agents() {
  const model = getModel()
  // Support work (themes + data, fixes, edits) can run on a faster model (AI_MODEL_FAST).
  const fast = getFastModel()
  // Hidden reasoning before the first visible token is the slowest part of a
  // call on reasoning models; keep it small (AI_REASONING_EFFORT).
  const reasoning = { effort: reasoningEffort() }
  const providerData = reasoningProviderData()
  // The gateway's default output cap is small enough to cut a file off
  // mid-way, so set explicit limits.
  planner ??= new Agent({ name: "Planner", instructions: PLANNER_INSTRUCTIONS, model, modelSettings: { maxTokens: 6000, reasoning, providerData } })
  designer ??= new Agent({ name: "Screen engineer", instructions: SCREEN_INSTRUCTIONS, model, modelSettings: { maxTokens: 24000, reasoning, providerData } })
  shell ??= new Agent({ name: "App shell", instructions: SHELL_INSTRUCTIONS, model, modelSettings: { maxTokens: 24000, reasoning, providerData } })
  // Edits and fixes return only the changed lines (search/replace blocks).
  editor ??= new Agent({ name: "Code editor", instructions: EDIT_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 12000, reasoning, providerData } })
  fixer ??= new Agent({ name: "Code fixer", instructions: EDIT_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 16000, reasoning, providerData } })
  planFixer ??= new Agent({
    name: "Plan fixer",
    instructions:
      "You repair malformed JSON. Return only the corrected JSON object for the app plan you are given: valid JSON, same content, no prose, no code fences.",
    model: fast,
    modelSettings: { maxTokens: 6000, reasoning, providerData },
  })
  foundation ??= new Agent({ name: "Design system", instructions: FOUNDATION_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 12000, reasoning, providerData } })
  return { planner, designer, planFixer, foundation, shell, fixer, editor }
}

// ---------------------------------------------------------------- persistence

type DbMessage = typeof messages.$inferSelect

export function toStoredMessage(m: DbMessage): StoredMessage {
  const kind = (["plan", "build"].includes(m.type ?? "") ? m.type : "standard") as ChatMessageKind
  return {
    id: m.id,
    sender: m.sender === "user" ? "user" : "assistant",
    kind,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    plan: kind === "plan" ? ((m.plan as AppPlan | null) ?? undefined) : undefined,
    build: kind === "build" ? ((m.pipelineData as BuildProgress | null) ?? undefined) : undefined,
    version: (m.pipelineData as { version?: number } | null)?.version,
  }
}

async function saveMessage(
  projectId: string,
  m: {
    id?: string
    sender: "user" | "assistant"
    kind: ChatMessageKind
    text: string
    plan?: AppPlan
    build?: BuildProgress
    meta?: Record<string, unknown>
    /** The version this message committed, shown as a small label in the chat. */
    version?: number
  }
) {
  const pipelineData =
    m.kind === "build"
      ? m.build ?? null
      : m.meta || m.version !== undefined
        ? { ...(m.meta ?? {}), ...(m.version !== undefined ? { version: m.version } : {}) }
        : null
  const [row] = await db
    .insert(messages)
    .values({
      id: m.id ?? id("msg"),
      projectId,
      sender: m.sender,
      text: m.text,
      type: m.kind,
      plan: m.plan ?? null,
      pipelineData,
    })
    .returning()
  return toStoredMessage(row)
}

export async function saveUserMessage(projectId: string, text: string, screenId?: string) {
  return saveMessage(projectId, { sender: "user", kind: "standard", text, meta: screenId ? { screenId } : undefined })
}

export async function setPhase(projectId: string, phase: AgentPhase, extra: Partial<Project> = {}) {
  await db
    .update(projects)
    .set({ status: phase, updatedAt: new Date(), ...extra })
    .where(eq(projects.id, projectId))
}

export async function latestPlan(projectId: string): Promise<AppPlan | null> {
  const [row] = await db
    .select({ plan: messages.plan })
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(desc(messages.createdAt))
    .limit(60)
    .then((rows) => rows.filter((r) => r.plan))
  return (row?.plan as AppPlan | undefined) ?? null
}

async function loadProject(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error("project not found")
  return project
}

// ---------------------------------------------------------------- streaming helpers

/**
 * The gateway can go quiet for a long time before the first token. While
 * nothing arrives, keep the user informed with a status line. Unlike before,
 * this only emits when the label itself changes, not once a second: each
 * event carries a `since` timestamp so the client counts elapsed seconds
 * itself instead of being sent a new event every second for the same status.
 */
function heartbeat(run: LiveRun, label: () => string) {
  let lastLabel: string | null = null
  const emitIfChanged = () => {
    const text = label()
    if (text === lastLabel) return
    lastLabel = text
    run.emit({ type: "status", text, since: Date.now() })
  }
  emitIfChanged()
  const timer = setInterval(emitIfChanged, 1000)
  return {
    touch: () => {},
    stop: () => clearInterval(timer),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_ATTEMPTS = 3

/**
 * Streams one agent turn. Failures before the first token (the gateway
 * intermittently answers "model not found" or drops the request) are retried,
 * since nothing has reached the user yet; failures mid-stream are not.
 */
async function streamText(
  agent: Agent,
  input: string | AgentInputItem[],
  onDelta: (delta: string) => void,
  onRetry?: (attempt: number) => void,
  /** Filled with the model's stop reason ("stop", "length"...). "length" means the output was cut off. */
  info?: { finishReason?: string }
): Promise<string> {
  let current = agent
  for (let attempt = 1; ; attempt++) {
    let text = ""
    try {
      const result = await runAgent(current, input, { stream: true, maxTurns: 1 })
      for await (const ev of result) {
        if (ev.type !== "raw_model_stream_event") continue
        if (ev.data.type === "output_text_delta") {
          text += ev.data.delta
          onDelta(ev.data.delta)
        } else if (ev.data.type === "model" && info) {
          const reason = (ev.data.event as { choices?: { finish_reason?: string | null }[] })?.choices?.[0]?.finish_reason
          if (reason) info.finishReason = reason
        }
      }
      await result.completed
      if (result.error) throw result.error
      // Some providers only deliver the final text.
      if (!text && typeof result.finalOutput === "string") {
        text = result.finalOutput
        onDelta(text)
      }
      return text
    } catch (e) {
      if (text || attempt >= MAX_ATTEMPTS) throw e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`agent call failed before output (attempt ${attempt}), retrying`, msg)
      // The output budget ran out before any visible text: hidden reasoning
      // ate it. Sending the same request again fails the same way, so retry
      // with reasoning off and more room.
      if (/finish_reason='?length/i.test(msg)) {
        const s = current.modelSettings
        const pd = s.providerData && "reasoning" in s.providerData ? { ...s.providerData, reasoning: { enabled: false } } : s.providerData
        current = current.clone({
          modelSettings: { ...s, reasoning: { effort: "none" }, providerData: pd, maxTokens: Math.min(32_000, Math.round((s.maxTokens ?? 16_000) * 1.5)) },
        })
        onRetry?.(attempt)
        continue
      }
      onRetry?.(attempt)
      await sleep(1500 * attempt)
    }
  }
}

// ---------------------------------------------------------------- planning

function historyToInput(
  project: Project,
  history: DbMessage[],
  screens: GeneratedScreen[],
  components: string[] = []
): AgentInputItem[] {
  const names = new Map(screens.map((s) => [s.id, s.name]))
  const assets = project.assets ?? []
  const context = [
    `Project: "${project.name}".`,
    assets.length
      ? `Files the creator attached to the first message (names only): ${assets.map((a) => `${a.name} (${a.type})`).join(", ")}.`
      : "No files were attached.",
    screens.length
      ? `Screens already built on the canvas (id: name): ${screens.filter((s) => s.state === "ready").map((s) => `${s.id}: ${s.name}`).join(", ") || "none yet"}. Changes to these screens are edits (<edit targets="...">); adding, removing or renaming screens is a plan change (the full updated <plan>).`
      : "No screens have been designed yet.",
    components.length ? `Shared component files: ${components.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const items: AgentInputItem[] = [system(context)]
  for (const m of history) {
    if (m.sender === "user") {
      const screenId = (m.pipelineData as { screenId?: string } | null)?.screenId
      const about = screenId && names.get(screenId) ? `[About the "${names.get(screenId)}" screen] ` : ""
      items.push(user(about + m.text))
    } else if (m.type === "plan" && m.plan) {
      items.push(assistant(`${m.text}\n\n<plan>\n${JSON.stringify(m.plan)}\n</plan>`))
    } else if (m.type === "build") {
      const b = m.pipelineData as BuildProgress | null
      items.push(assistant(`(Designed screens: ${b?.screens.map((s) => `${s.name} [${s.state}]`).join(", ") ?? "none"})`))
    } else {
      items.push(assistant(m.text))
    }
  }
  return items
}

/** Runs the planner on the conversation so far. Returns whether the user approved the plan in chat. */
/** Sent to the planner when a request turned out to need a new screen. */
export const NEW_SCREEN_NUDGE =
  "The person's latest request may need a new screen, which an <edit> cannot do (the editor can only change files that already exist). If it does, reply again: one short sentence saying you are adding it now, then the full updated <plan> with every existing screen unchanged and the new screen added, and no <edit> block. If it really is only a change to existing screens, reply with the <edit> as before."

export async function runPlanning(run: LiveRun, projectId: string, opts: { first: boolean; nudge?: string }) {
  const { planner, planFixer } = agents()
  const project = await loadProject(projectId)
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.createdAt))
  const recent = history.slice(-40)
  const doc = readAppDoc(project.previewScreens)
  const screens = doc.screens
  const components = Object.keys(doc.files ?? {}).filter((p) => p.startsWith("components/"))
  const hadPlan = history.some((m) => m.plan)
  const prevPlan = await latestPlan(projectId)

  await setPhase(projectId, "planning")
  run.emit({ type: "phase", phase: "planning" })
  run.emit({ type: "status", text: opts.first ? "Reading your request" : "Reading your message" })

  const messageId = id("msg")
  run.emit({ type: "message_start", id: messageId })

  const filter = new TagStreamFilter()
  let phaseLabel = opts.first ? "Understanding your idea" : "Thinking"
  let gotText = false
  let lastNames = 0
  const hb = heartbeat(run, () => phaseLabel)

  let raw = ""
  try {
    const input = historyToInput(project, recent, screens, components)
    if (opts.nudge) input.push(system(opts.nudge))
    raw = await streamText(planner, input, (delta) => {
      hb.touch()
      const visible = filter.push(delta)
      if (visible) {
        if (!gotText) {
          gotText = true
          run.emit({ type: "status", text: "Writing" })
        }
        run.emit({ type: "text", id: messageId, delta: visible })
      }
      if (filter.insidePlan) {
        const names = filter.screenNamesSoFar()
        if (names.length === 0 && phaseLabel !== "Drafting the app plan") {
          phaseLabel = "Drafting the app plan"
          run.emit({ type: "status", text: phaseLabel })
        } else if (names.length > lastNames) {
          lastNames = names.length
          phaseLabel = `Planning screens: ${names.join(", ")}`
          run.emit({ type: "plan_progress", screens: names })
          run.emit({ type: "status", text: phaseLabel })
        }
      }
    }, () => run.emit({ type: "status", text: "The AI model didn't answer, trying again" }))
  } finally {
    hb.stop()
  }
  const tail = filter.end()
  if (tail) run.emit({ type: "text", id: messageId, delta: tail })

  let reply = parsePlannerReply(raw)
  // The editor can only change existing files, so a new screen sent as an
  // edit would be silently dropped. Ask once more for the plan instead.
  const lastUser = [...recent].reverse().find((m) => m.sender === "user")?.text ?? ""
  if (reply.edit && !reply.plan && !opts.nudge && asksForNewScreen(lastUser, reply.edit.instruction)) {
    run.emit({ type: "status", text: "Adding it to the plan" })
    const again = await streamText(
      planner,
      [...historyToInput(project, recent, screens, components), system(NEW_SCREEN_NUDGE)],
      () => {}
    ).catch(() => "")
    const retried = parsePlannerReply(again)
    if (retried.plan || retried.planInvalid) {
      raw = again
      reply = retried
      filter.planText = ""
    }
  }
  let plan = reply.plan
  if (reply.planInvalid) {
    run.emit({ type: "status", text: "Tidying up the plan" })
    const fixed = await streamText(planFixer, filter.planText || raw, () => {}).catch(() => "")
    plan = parsePlanJson(fixed)
  }

  let text = reply.text
  if (!text && plan) text = "Here's the plan for your app. Approve it to start building, or tell me what to change."
  if (!text && !plan) text = "Sorry, I couldn't put a reply together. Please try again."

  // Same id as the streamed message, so the client swaps it in place.
  // Edits only make sense once there are built screens to change.
  const edit = !plan && reply.edit && screens.some((s) => s.state === "ready") ? reply.edit : null

  const saved = await saveMessage(projectId, {
    id: messageId,
    sender: "assistant",
    kind: plan ? "plan" : "standard",
    text,
    plan: plan ?? undefined,
    meta: edit ? { edit } : undefined,
  })
  run.emit({ type: "message_done", message: saved })

  // The agent's product name usually beats the one guessed from the prompt.
  if (plan && !hadPlan && plan.appName && plan.appName !== project.name) {
    await db.update(projects).set({ name: plan.appName.slice(0, 60) }).where(eq(projects.id, projectId))
    run.emit({ type: "project", name: plan.appName.slice(0, 60) })
  }

  // A revision that only adds screens to a built app is built right away:
  // the existing screens keep their specs, so only the new ones are built.
  const additive = !!plan && prevPlan !== null && screens.some((s) => s.state === "ready") && onlyAddsScreens(prevPlan, plan)
  const approved = additive || (reply.approved && !plan && (hadPlan || !!prevPlan))
  if (!approved) {
    const nextPhase: AgentPhase = !plan && screens.some((s) => s.state === "ready") ? "ready" : "awaiting_approval"
    await setPhase(projectId, nextPhase)
    run.emit({ type: "phase", phase: nextPhase })
  }
  return { approved, edit }
}

/** Edit distance with adjacent swaps (Damerau-Levenshtein, optimal string alignment). */
function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

const ASK_VERBS = ["add", "create", "build", "need", "want", "include", "insert"]
/** Words that make the screen the place of a change ("add a scroll to this screen"), not the thing added. */
const STOP_WORDS = new Set(
  "to on in at of for from into inside onto within under over this that these those my our your its the current existing same each every".split(" ")
)
const COUNT_WORDS = new Set("a an another one more some two three new extra separate".split(" "))
// One typo allowed: "screeb", "sceen", "scren", "screne".
const isScreenWord = (w: string) => ["screen", "screens"].some((t) => editDistance(w, t) <= 1) || w === "page" || w === "pages"
const isAskVerb = (w: string) => ASK_VERBS.includes(w) || w === "ad" || (w.length >= 4 && ASK_VERBS.some((v) => v.length >= 4 && editDistance(w, v) <= 1))

/**
 * "add a welcome screen", "ad a welcome screeb", "I need a profile page",
 * "create onboarding screens"; not "add a scroll to this screen" or
 * "make the screen darker". The edit instruction is checked too: the planner
 * writes it without typos, even when the person's message had some.
 */
function asksForNewScreen(userText: string, instruction: string) {
  return [userText, instruction].some((text) => {
    const words = text.toLowerCase().split(/[^a-z']+/).filter(Boolean)
    return words.some((w, i) => {
      const isNew = w === "new"
      if (!isAskVerb(w) && !isNew) return false
      let filler = 0
      for (const next of words.slice(i + 1, i + 7)) {
        if (isScreenWord(next)) return true
        if (STOP_WORDS.has(next)) return false
        if (!COUNT_WORDS.has(next) && ++filler > (isNew ? 2 : 3)) return false
      }
      return false
    })
  })
}

/** True when `next` keeps the design and every screen of `prev` as they were, and adds at least one. */
function onlyAddsScreens(prev: AppPlan, next: AppPlan) {
  if (next.screens.length <= prev.screens.length) return false
  if (JSON.stringify(prev.design) !== JSON.stringify(next.design)) return false
  const nextById = new Map(next.screens.map((s) => [s.id, s]))
  return prev.screens.every((s) => {
    const n = nextById.get(s.id)
    return n && n.presentation === s.presentation && n.name === s.name && JSON.stringify(n.keyElements) === JSON.stringify(s.keyElements) && n.purpose === s.purpose
  })
}

// ---------------------------------------------------------------- app document

/** Writes the whole app document (screens, themes, data model). */
async function saveDoc(projectId: string, doc: AppDoc, extra: Partial<Project> = {}) {
  await db
    .update(projects)
    .set({ previewScreens: doc, updatedAt: new Date(), ...extra })
    .where(eq(projects.id, projectId))
}

/**
 * Writes only the screens, leaving the rest of the document alone, so a
 * theme the creator picks while screens are still building isn't lost.
 */
async function saveScreens(projectId: string, screens: GeneratedScreen[]) {
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{}'::jsonb), '{screens}', ${JSON.stringify(screens)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}

// ---------------------------------------------------------------- verified engine glue
//
// lib/verify/* stays free of DB access (Phase 3 depends on that split): it
// only runs the change gateway against a Workspace built from in-memory
// files. Everything here does the persistence (loading the project,
// committing the result) and turns a RunResult into the chat events and
// messages the legacy engine already produces for the same situations.

/** VERIFY_DEBUG_FAIL=<gate>:<n>, ignored in production: fails `gate` synthetically for a run's first `n` attempts. */
function verifyDebugFail(): { gate: GateName; n: number } | undefined {
  if (process.env.NODE_ENV === "production") return undefined
  const raw = process.env.VERIFY_DEBUG_FAIL?.trim()
  if (!raw) return undefined
  const [gate, nStr] = raw.split(":")
  const n = Number(nStr)
  if (!gate || !Number.isFinite(n)) return undefined
  return { gate: gate as GateName, n }
}

/** Every verified model call + gate run, as an event the run's agent_events log already captures. */
function emitAttempts(run: LiveRun, attempts: { n: number; modelMs: number; gatesMs: number; ok: boolean; failedAt?: GateName; diagnostics?: string; tokens?: { prompt?: number; completion?: number } }[]) {
  for (const a of attempts) run.emit({ type: "attempt", ...a })
}

// ---------------------------------------------------------------- runtime repair

export type RepairResult = { path: string; code: string; screenId?: string } | null

/**
 * Fixes a file that crashed in the preview. On the legacy engine, the crash
 * message goes to the fixer together with the file and what the project
 * actually exports; the repaired file is saved only if it passes every check.
 * On the verified engine, it goes through the same change gateway as an edit.
 */
export async function repairFile(run: LiveRun, projectId: string, path: string, message: string): Promise<RepairResult> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const screen = doc.screens.find((s) => s.path === path && s.code)
  const code = screen?.code ?? doc.files?.[path]
  if (!code) return null
  const label = screen?.name ?? path.split("/").pop() ?? path

  if (engineOf(project) === "verified") {
    const ws = workspaceFromDoc(doc)
    const exports = projectExports(ws.files)
    const prompt = verifiedEditPrompt(`In the running app, ${path} crashed with: "${message.slice(0, 500)}". Find the cause and fix it.`, [{ path, code }], {
      screens: doc.screens.filter((s) => s.state === "ready").map((s) => `/${s.id}: ${s.name}`).join(", "),
      components: Object.entries(exports).map(([n, e]) => `${n} (${e.module})`).join(", "),
      data: doc.data ?? emptyDataModel(),
    })
    const result = await runChange(ws, prompt, coderAdapter, {
      debugFail: verifyDebugFail(),
      projectKey: projectId,
      onState: (state) => run.emit({ type: "run_state", state }),
    })
    emitAttempts(run, result.attempts)
    if (result.state === "needs_user") return null

    const updatedDoc = docFromWorkspace(doc, result.ws)
    await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: `Repaired ${label}`, runId: run.runId })
    const newCode = updatedDoc.screens.find((s) => s.path === path)?.code ?? updatedDoc.files?.[path]
    if (newCode === undefined || newCode === code) return null
    return screen ? { path, code: newCode, screenId: screen.id } : { path, code: newCode }
  }

  const files: ProjectFiles = {
    ...(doc.files ?? {}),
    ...Object.fromEntries(doc.screens.filter((s) => s.code && s.path).map((s) => [s.path!, s.code!])),
  }
  const fixed = await checkAndFix(run, path, code, files, label, [
    `In the running app this file crashed with: "${message.slice(0, 500)}". Find the cause and fix it.`,
  ])
  if (blocking(fixed.problems).length || fixed.code === code) return null

  // Re-read so a concurrent change to other screens isn't lost.
  const latest = readAppDoc((await loadProject(projectId)).previewScreens)
  const updatedDoc: AppDoc = screen
    ? { ...latest, screens: latest.screens.map((s) => (s.id === screen.id ? { ...s, code: fixed.code } : s)) }
    : { ...latest, files: { ...(latest.files ?? {}), [path]: fixed.code } }
  await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: `Repaired ${label}`, runId: run.runId })
  return screen ? { path, code: fixed.code, screenId: screen.id } : { path, code: fixed.code }
}

// ---------------------------------------------------------------- targeted edits

/**
 * Applies a change request to built screens without touching the plan:
 * the editor returns only the changed lines, they are applied, checked
 * (imports, undefined names, compile) and saved. The old screen stays on
 * the canvas until the new one is ready.
 *
 * With `escalate`, a change that turns out to need a new screen (the editor
 * says so, writes a new route file, or the edit targets a screen that
 * doesn't exist) returns { needsPlan: true } without saving anything, so the
 * caller can send it through the plan instead of dropping it.
 */
export async function runEdit(run: LiveRun, projectId: string, edit: EditRequest, opts: { escalate?: boolean } = {}): Promise<{ needsPlan: boolean }> {
  const { editor } = agents()
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const ready = doc.screens.filter((s) => s.state === "ready" && s.code && s.path)
  const files: ProjectFiles = {
    ...(doc.files ?? {}),
    ...Object.fromEntries(ready.map((s) => [s.path!, s.code!])),
  }

  // Targets are screen ids (or names) and project file paths.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const targetPaths = new Set<string>()
  let unknownScreen = false
  for (const t of edit.targets) {
    const screen = ready.find((s) => s.id === t || norm(s.name) === norm(t) || s.path === t)
    if (screen) targetPaths.add(screen.path!)
    else if (files[t.replace(/^@\//, "")]) targetPaths.add(t.replace(/^@\//, ""))
    else if (!t.includes("/") || /^app\//.test(t)) unknownScreen = true
  }
  if (opts.escalate && unknownScreen) return { needsPlan: true }
  if (!targetPaths.size && ready[0]) targetPaths.add(ready[0].path!)
  const nameOf = (path: string) => ready.find((s) => s.path === path)?.name ?? path.split("/").pop()!.replace(/\.\w+$/, "")
  const label = [...targetPaths].map(nameOf).join(", ")

  run.emit({ type: "status", text: `Editing ${label}` })
  const hb = heartbeat(run, () => `Editing ${label}`)
  const exports = projectExports(files)
  let raw = ""
  try {
    raw = await streamText(
      editor,
      editPrompt(
        edit.instruction,
        [...targetPaths].map((p) => ({ path: p, code: files[p] })),
        {
          screens: ready.map((s) => `/${s.id}: ${s.name}`).join(", "),
          components: Object.entries(exports)
            .map(([n, e]) => `${n} (${e.module})`)
            .join(", "),
          data: doc.data ?? emptyDataModel(),
        }
      ),
      () => hb.touch()
    )
  } finally {
    hb.stop()
  }

  // The editor can't add routes: it says so, or writes a screen file that doesn't exist yet.
  const edits = parseEdits(raw)
  const newRoute = edits.some((fe) => fe.kind === "file" && /^app\/.+\.tsx$/.test(fe.path) && !(fe.path in files) && !/_layout\.tsx$/.test(fe.path))
  if (opts.escalate && (/<needs_plan\s*\/?>/i.test(raw) || newRoute)) return { needsPlan: true }

  // Apply: patches to existing files, whole files for rewrites and new components.
  const changed: ProjectFiles = {}
  const retry: string[] = []
  for (const fe of edits) {
    const allowed = targetPaths.has(fe.path) || (fe.kind === "file" && /^components\/[\w-]+\.tsx?$/.test(fe.path)) || fe.path in files
    if (!allowed) continue
    if (fe.kind === "file") {
      changed[fe.path] = fe.code
      continue
    }
    const base = changed[fe.path] ?? files[fe.path]
    if (base === undefined) continue
    const { code, failed } = applyHunks(base, fe.hunks)
    if (failed.length) retry.push(fe.path)
    else changed[fe.path] = code
  }
  // Blocks that didn't match: ask for the whole updated file instead.
  for (const path of retry) {
    run.emit({ type: "status", text: `Editing ${nameOf(path)}` })
    const again = await streamText(editor, editRetryPrompt(edit.instruction, path, files[path]), () => {}).catch(() => "")
    const whole = parseEdits(again).find((f) => f.kind === "file" && f.path === path)
    if (whole && whole.kind === "file") changed[path] = whole.code
  }

  // Check everything that changed; keep only files that run.
  const next: ProjectFiles = { ...files, ...changed }
  const saved: ProjectFiles = {}
  const failed: string[] = []
  for (const [path, code] of Object.entries(changed)) {
    const checked = await checkAndFix(run, path, code, next, nameOf(path))
    if (blocking(checked.problems).length) {
      failed.push(nameOf(path))
      continue
    }
    saved[path] = checked.code
    next[path] = checked.code
  }

  // Save: screens by id, other files into the project files.
  const latest = readAppDoc((await loadProject(projectId)).previewScreens)
  const screenUpdates = latest.screens.map((s) => (s.path && saved[s.path] !== undefined ? { ...s, code: saved[s.path], state: "ready" as const } : s))
  const fileUpdates = Object.fromEntries(Object.entries(saved).filter(([p]) => !latest.screens.some((s) => s.path === p)))
  let version: number | undefined
  if (Object.keys(saved).length) {
    const updatedDoc: AppDoc = { ...latest, screens: screenUpdates, files: { ...(latest.files ?? {}), ...fileUpdates } }
    ;({ version } = await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: `Edit: ${edit.instruction.slice(0, 140)}`, runId: run.runId }))
    for (const s of screenUpdates) if (s.path && saved[s.path] !== undefined) run.emit({ type: "screen_done", screen: s })
    if (Object.keys(fileUpdates).length) run.emit({ type: "files", files: updatedDoc.files! })
  }

  const done = Object.keys(saved).map(nameOf)
  const text = done.length
    ? `Updated ${done.join(", ")}.${failed.length ? ` I couldn't apply the change to ${failed.join(", ")} cleanly, so ${failed.length === 1 ? "it was" : "they were"} left as before.` : ""}`
    : "I couldn't apply that change cleanly, so nothing was changed. Could you describe it a little differently?"
  const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text, version })
  run.emit({ type: "message_done", message: msg })
  await setPhase(projectId, "ready")
  run.emit({ type: "phase", phase: "ready" })
  return { needsPlan: false }
}

/**
 * The verified engine's edit path: builds a Workspace from the AppDoc, runs
 * the change gateway (lib/verify/run.ts) with the coder model, and on
 * success commits a snapshot. On `needs_user`, posts a plain-words message
 * and leaves the app unchanged. Target resolution and escalation mirror
 * runEdit so both engines behave the same from the chat's point of view.
 */
export async function runVerifiedEdit(run: LiveRun, projectId: string, edit: EditRequest, opts: { escalate?: boolean } = {}): Promise<{ needsPlan: boolean }> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const ready = doc.screens.filter((s) => s.state === "ready" && s.code && s.path)
  const ws = workspaceFromDoc(doc)

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const targetPaths = new Set<string>()
  let unknownScreen = false
  for (const t of edit.targets) {
    const screen = ready.find((s) => s.id === t || norm(s.name) === norm(t) || s.path === t)
    if (screen) targetPaths.add(screen.path!)
    else if (ws.files[t.replace(/^@\//, "")]) targetPaths.add(t.replace(/^@\//, ""))
    else if (!t.includes("/") || /^app\//.test(t)) unknownScreen = true
  }
  if (opts.escalate && unknownScreen) return { needsPlan: true }
  if (!targetPaths.size && ready[0]) targetPaths.add(ready[0].path!)
  const nameOf = (path: string) => ready.find((s) => s.path === path)?.name ?? path.split("/").pop()!.replace(/\.\w+$/, "")
  const label = [...targetPaths].map(nameOf).join(", ")

  run.emit({ type: "status", text: `Editing ${label}`, since: Date.now() })
  const prompt = verifiedEditPrompt(
    edit.instruction,
    [...targetPaths].map((p) => ({ path: p, code: ws.files[p] })),
    {
      screens: ready.map((s) => `/${s.id}: ${s.name}`).join(", "),
      components: Object.entries(projectExports(ws.files)).map(([n, e]) => `${n} (${e.module})`).join(", "),
      data: doc.data ?? emptyDataModel(),
    }
  )

  const result = await runChange(ws, prompt, coderAdapter, {
    debugFail: verifyDebugFail(),
    projectKey: projectId,
    onState: (state) => {
      run.emit({ type: "run_state", state })
      run.emit({ type: "status", text: state === "repairing" ? `Fixing ${label}` : `Editing ${label}`, since: Date.now() })
    },
  })
  emitAttempts(run, result.attempts)

  if (result.state === "needs_user") {
    const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text: result.message })
    run.emit({ type: "message_done", message: msg })
    await setPhase(projectId, "ready")
    run.emit({ type: "phase", phase: "ready" })
    return { needsPlan: false }
  }

  const updatedDoc = docFromWorkspace(doc, result.ws)
  const { version } = await commitSnapshot(projectId, updatedDoc, {
    author: project.userId,
    intent: result.intent || `Edit: ${edit.instruction.slice(0, 140)}`,
    runId: run.runId,
  })
  for (const path of result.changed) {
    const screen = updatedDoc.screens.find((s) => s.path === path)
    if (screen) run.emit({ type: "screen_done", screen })
  }
  if (result.changed.some((p) => !updatedDoc.screens.some((s) => s.path === p))) run.emit({ type: "files", files: updatedDoc.files ?? {} })

  const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text: `Updated ${label}.`, version })
  run.emit({ type: "message_done", message: msg })
  await setPhase(projectId, "ready")
  run.emit({ type: "phase", phase: "ready" })
  return { needsPlan: false }
}

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

  const { foundation } = agents()
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
    themes = { themes: list, activeId: list.some((t) => t.id === keep) ? keep! : list[0].id, hash: tHash }
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
  const { fixer } = agents()
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
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ThemeProvider } from "@/theme"

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
${modals.map((s) => `          <Stack.Screen name="${s.id}" options={{ presentation: "modal" }} />`).join("\n")}
        </Stack>
      </SafeAreaProvider>
    </ThemeProvider>
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
  const { shell } = agents()
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
  const { designer } = agents()
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
    buildFoundation(run, plan, doc).then((r) => {
      console.info(`[build ${projectId}] foundation ${Date.now() - t0}ms`)
      run.emit({ type: "foundation", themes: r.themes, data: r.data })
      return r
    }),
    keepShell
      ? Object.fromEntries(Object.entries(doc.files!).filter(([p]) => SHELL_PATH.test(p)))
      : buildShell(
          run,
          plan,
          designTheme,
          // Only the file paths matter for checking the shell's imports.
          platformFiles(plan, { themes: [designTheme], activeId: designTheme.id, hash: "" }, doc.data ?? emptyDataModel()),
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

  // Project files: platform modules and config, then the shell.
  const platform = platformFiles(plan, themes, data)
  let files: ProjectFiles = { ...platform, ...shellFiles }
  await saveDoc(projectId, { ...doc, screens, themes, data, files, shellHash: sHash, componentsHash: cHash })
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
    const index = plan.screens.indexOf(spec)
    const path = screenPath(spec)
    // The first finished screen keeps the rest consistent.
    const reference = screens.find((s) => s.state === "ready" && s.code && s.id !== screenId)?.code

    active.add(spec.name)
    void update(screenId, { state: "generating", error: undefined, code: undefined })
    run.emit({ type: "screen_start", id: screenId, index: n, total: todo.length })
    run.emit({ type: "status", text: statusText() })

    let code = ""
    let error: string | undefined
    let truncatedBefore = false
    for (let attempt = 0; attempt < 2 && !code; attempt++) {
      if (attempt > 0) {
        run.emit({ type: "screen_start", id: screenId, index: n, total: todo.length })
        run.emit({ type: "status", text: `Retrying ${spec.name}` })
      }
      const started = Date.now()
      const hb = heartbeat(run, statusText)
      const info: { finishReason?: string } = {}
      try {
        const prompt = screenPrompt(plan, spec, index, {
          theme: designTheme,
          data,
          components: components(),
          styleReference: reference?.slice(0, STYLE_REF_LIMIT),
          contracts,
        })
        const raw = await streamText(
          designer,
          truncatedBefore
            ? `${prompt}

IMPORTANT: your previous attempt was cut off at the output limit. Write a more compact file: at most about 300 lines, reuse the shared components, keep styles short, and no comments.`
            : prompt,
          (delta) => {
            hb.touch()
            run.emit({ type: "screen_delta", id: screenId, delta })
          },
          () => run.emit({ type: "status", text: `The AI model didn't answer, trying ${spec.name} again` }),
          info
        )
        hb.stop()
        const written = Date.now()
        // Cut off at the output limit: the file is incomplete and no fix can
        // complete it (a fix would have to write it all again). Retry smaller.
        if (info.finishReason === "length") {
          truncatedBefore = true
          error = "The screen came out longer than the AI model's output limit."
          console.warn(`[build ${projectId}] screen ${screenId}: output cut off at the limit after ${written - started}ms (${raw.length} chars), retrying more compact`)
          continue
        }
        // Some models answer with a file name or a sentence instead of the
        // file (the code stays in their hidden reasoning). Nothing to fix:
        // ask again.
        const draft = extractCode(raw)
        if (draft.length < 300 || !/\bexport\b/.test(draft)) {
          error = "The AI model didn't return the screen's code."
          console.warn(`[build ${projectId}] screen ${screenId}: reply had no code (${raw.length} chars: ${JSON.stringify(raw.slice(0, 80))}), retrying`)
          continue
        }
        const allFiles = { ...files, ...Object.fromEntries(screens.filter((s) => s.code && s.path).map((s) => [s.path!, s.code!])) }
        const checked = await checkAndFix(run, path, draft, allFiles, spec.name)
        console.info(`[build ${projectId}] screen ${screenId}: written ${written - started}ms, checks/fixes ${Date.now() - written}ms`)
        const stop = blocking(checked.problems)
        if (stop.length) {
          error = stop[0]
          console.warn(`[build ${projectId}] screen ${screenId}: still failing checks`, stop)
        } else code = checked.code
      } catch (e) {
        error = e instanceof Error ? e.message : "Generation failed."
        console.error("screen generation failed", screenId, e)
      } finally {
        hb.stop()
      }
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
  files = { ...platform, ...shellFiles }
  const finalDoc: AppDoc = { ...doc, screens, themes, data, files, shellHash: sHash, componentsHash: cHash }
  const { version } = await commitSnapshot(projectId, finalDoc, {
    author: project.userId,
    intent: todo.length ? `Built ${todo.length} screen${todo.length === 1 ? "" : "s"}` : "Rebuilt (no screens changed)",
    runId: run.runId,
  })
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
