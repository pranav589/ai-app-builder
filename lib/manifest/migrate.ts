// Builds a manifest for a project that doesn't have one yet: either a
// legacy-engine project opening on the verified engine for the first time,
// or a verified project built before the manifest existed. Best-effort: the
// result just needs to be valid and behave like the app already does: a
// wrong guess (e.g. which screens take an id param) is fixed by the next
// edit's manifest_patch, not by this migration being perfect.

import { ICONS } from "@/lib/app-project/icons"
import { ALLOWED_PACKAGES } from "@/lib/app-project/project"
import type { AppDoc } from "@/lib/app-runtime/app-doc"
import type { AppPlan, PlanScreen } from "@/lib/agent/types"
import { applyPatch } from "./schema"
import type { JsonPatchOp } from "@/lib/verify/types"
import type { AppManifest } from "./schema"

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "app"

/** Same fuzzy match templateShell() uses today for a tab's icon, kept only for migrating existing apps; new tabs get an explicit icon from the planner. */
function guessIcon(s: Pick<PlanScreen, "id" | "name">): string {
  const words = `${s.id} ${s.name}`.toLowerCase()
  const found = ICONS.find((i) => words.includes(i.md.split("_")[0]) || words.includes(i.sf.split(".")[0]))
  return (found ?? ICONS[0]).ion
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const singular = (w: string) =>
  w
    .replace(/(ies)$/, "y")
    .replace(/(ses|xes|ches|shes)$/, (m) => m.slice(0, -2))
    .replace(/s$/, "")

/** Same name/purpose matching lib/agent/prompts.ts routeContracts() uses today, kept only for migrating existing apps; new screens get an explicit `collection` from the planner. */
function guessCollection(s: PlanScreen, doc: AppDoc): string | undefined {
  const own = new Set([...words(s.id), ...words(s.name)].map(singular))
  const about = new Set(words(s.purpose).map(singular))
  const coll =
    doc.data?.collections.find((c) => own.has(singular(c.name)) || own.has(singular(c.label))) ??
    doc.data?.collections.find((c) => about.has(singular(c.name)) || about.has(singular(c.label)))
  return coll?.name
}

/** Builds a manifest from an existing project's plan and app document. */
export function fromLegacy(plan: AppPlan, doc: AppDoc): AppManifest {
  const targeted = new Set(plan.screens.flatMap((s) => s.navigatesTo))
  const screens: AppManifest["screens"] = {}
  for (const s of plan.screens) {
    const takesId = s.presentation !== "tab" && (s.presentation === "modal" || targeted.has(s.id))
    const collection = takesId ? guessCollection(s, doc) : undefined
    screens[s.id] = {
      title: s.name,
      presentation: s.presentation,
      ...(takesId ? { params: { id: "string" as const } } : {}),
      ...(s.presentation === "tab" ? { icon: guessIcon(s) } : {}),
      ...(collection ? { collection } : {}),
    }
  }
  const tabs = plan.screens.filter((s) => s.presentation === "tab").map((s) => s.id)
  const initial = tabs[0] ?? plan.screens[0]?.id ?? "home"

  const collections: AppManifest["collections"] = {}
  for (const c of doc.data?.collections ?? []) {
    const fields: AppManifest["collections"][string]["fields"] = {}
    for (const f of c.fields) fields[f.name] = { type: f.type, label: f.label, options: f.options }
    collections[c.name] = { label: c.label, fields, seed: c.seed }
  }

  return {
    schemaVersion: 1,
    app: { name: plan.appName, slug: slug(plan.appName) },
    screens,
    navigation: { tabs, initial },
    collections,
    allowedPackages: [...ALLOWED_PACKAGES],
  }
}

/** The project's manifest, migrating lazily (and only in memory; the caller commits it like any other change) the first time the verified engine touches a project that doesn't have one yet. */
export function ensureManifest(doc: AppDoc, plan: AppPlan | null): AppManifest | undefined {
  return doc.manifest ?? (plan ? fromLegacy(plan, doc) : undefined)
}

/**
 * Turns a plan change that only adds screens (lib/agent/orchestrator.ts
 * onlyAddsScreens already decided this) into the manifest_patch ops for
 * those additions: one "add" per new screen, plus adding tab screens to
 * navigation.tabs. Lets the verified engine take the same fast "additive"
 * path the legacy engine does, through the gateway instead of a full
 * AI-written rebuild (fixes.txt #9, "screen added but not showing").
 */
function patchForAddedScreens(manifest: AppManifest, referencePlan: AppPlan, added: PlanScreen[]): JsonPatchOp[] {
  const ops: JsonPatchOp[] = []
  for (const s of added) {
    const takesId = s.presentation !== "tab" && (s.presentation === "modal" || referencePlan.screens.some((o) => o.navigatesTo.includes(s.id)))
    ops.push({
      op: "add",
      path: `/screens/${s.id}`,
      value: {
        title: s.name,
        presentation: s.presentation,
        ...(takesId ? { params: { id: "string" as const } } : {}),
        ...(s.presentation === "tab" ? { icon: guessIcon(s) } : {}),
      },
    })
    if (s.presentation === "tab" && !manifest.navigation.tabs.includes(s.id)) ops.push({ op: "add", path: "/navigation/tabs/-", value: s.id })
  }
  return ops
}

export function addedScreensToPatch(manifest: AppManifest, prevPlan: AppPlan, nextPlan: AppPlan): JsonPatchOp[] {
  const prevIds = new Set(prevPlan.screens.map((s) => s.id))
  const added = nextPlan.screens.filter((s) => !prevIds.has(s.id))
  return patchForAddedScreens(manifest, nextPlan, added)
}

/** Drops manifest screens that no longer have a matching plan screen (a replan that removed one), and fixes up navigation.tabs/initial accordingly. */
function pruneRemovedScreens(manifest: AppManifest, plan: AppPlan): AppManifest {
  const planIds = new Set(plan.screens.map((s) => s.id))
  const keptIds = Object.keys(manifest.screens).filter((id) => planIds.has(id))
  if (keptIds.length === Object.keys(manifest.screens).length) return manifest
  const screens = Object.fromEntries(keptIds.map((id) => [id, manifest.screens[id]]))
  const tabs = manifest.navigation.tabs.filter((id) => screens[id])
  const initial = screens[manifest.navigation.initial] ? manifest.navigation.initial : (tabs[0] ?? keptIds[0] ?? manifest.navigation.initial)
  return { ...manifest, screens, navigation: { tabs, initial } }
}

/**
 * Keeps the project's manifest in step with its plan across a rebuild
 * (lib/agent/orchestrator.ts runGeneration): screens the plan removed are
 * dropped, and screens the plan added (whether this is the "additive" fast
 * path or a fresh replan) are added with the same heuristics fromLegacy
 * uses. Every screen that survives keeps its existing manifest entry
 * untouched, so manifest-only edits (a renamed tab, a chosen icon, a
 * collection link) made through manifest_patch are never reverted by a
 * later rebuild.
 */
export function syncManifest(doc: AppDoc, plan: AppPlan): AppManifest {
  if (!doc.manifest) return fromLegacy(plan, doc)
  const pruned = pruneRemovedScreens(doc.manifest, plan)
  const added = plan.screens.filter((s) => !pruned.screens[s.id])
  if (!added.length) return pruned
  const ops = patchForAddedScreens(pruned, plan, added)
  const { doc: patched } = applyPatch(pruned, ops)
  return patched ?? pruned
}
