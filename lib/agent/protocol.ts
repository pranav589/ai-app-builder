import { createHash } from "node:crypto"
import { z } from "zod"

import type { AppPlan, PlanScreen } from "./types"

// The planner answers in prose and, when it proposes or revises a plan,
// appends one <plan>{json}</plan> block. When the user clearly approves the
// plan in chat it appends <approve/>. Neither tag is shown in the chat.

const HEX = /^#[0-9a-fA-F]{6}$/
const color = (fallback: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .catch(fallback)
    .transform((v) => (HEX.test(v) ? v : fallback))

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "screen"

const strList = z
  .array(z.string())
  .catch([])
  .transform((a) => a.map((s) => s.trim()).filter(Boolean).slice(0, 12))

const screenSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  purpose: z.string().catch(""),
  keyElements: strList,
  navigatesTo: strList,
  presentation: z.enum(["tab", "stack", "modal"]).catch("stack"),
})

export const MAX_SCREENS = 10

const planSchema = z.object({
  appName: z.string().min(1).max(60),
  summary: z.string().catch(""),
  targetUsers: z.string().catch(""),
  coreFeatures: strList,
  design: z
    .object({
      style: z.string().catch("Clean and modern"),
      primaryColor: color("#1a4be0"),
      accentColor: color("#f59e0b"),
      backgroundColor: color("#f6f7f9"),
      surfaceColor: color("#ffffff"),
      textColor: color("#111111"),
      cornerRadius: z.enum(["sharp", "soft", "round"]).catch("soft"),
      typography: z.string().catch("System sans-serif"),
    })
    .catch({
      style: "Clean and modern",
      primaryColor: "#1a4be0",
      accentColor: "#f59e0b",
      backgroundColor: "#f6f7f9",
      surfaceColor: "#ffffff",
      textColor: "#111111",
      cornerRadius: "soft",
      typography: "System sans-serif",
    }),
  navigation: z.string().catch(""),
  screens: z.array(screenSchema).min(1),
})

/** Validates a plan, filling gaps and giving every screen a unique stable id. */
export function normalizePlan(raw: unknown): AppPlan | null {
  const parsed = planSchema.safeParse(raw)
  if (!parsed.success) return null
  const seen = new Set<string>()
  const screens: PlanScreen[] = parsed.data.screens.slice(0, MAX_SCREENS).map((s) => {
    let id = slug(s.id || s.name)
    while (seen.has(id)) id = `${id}-2`
    seen.add(id)
    return { id, name: s.name.trim(), purpose: s.purpose, keyElements: s.keyElements, navigatesTo: s.navigatesTo, presentation: s.presentation }
  })
  return { ...parsed.data, appName: parsed.data.appName.trim(), screens }
}

function parseJsonLoose(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf("{")
    const end = t.lastIndexOf("}")
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export type PlannerReply = {
  /** What the user sees: the prose with tags removed. */
  text: string
  plan: AppPlan | null
  /** A <plan> block was present but could not be parsed. */
  planInvalid: boolean
  approved: boolean
  /** A change to already-built screens, applied directly to their code (no plan change, no rebuild). */
  edit: EditRequest | null
}

export type EditRequest = {
  /** Screen ids and/or project file paths to change. */
  targets: string[]
  instruction: string
}

export function parseEditTag(raw: string): EditRequest | null {
  const m = /<edit\b([^>]*)>([\s\S]*?)(?:<\/edit>|$)/i.exec(raw)
  if (!m) return null
  const attr = /targets\s*=\s*["']([^"']*)["']/i.exec(m[1])
  const targets = (attr?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6)
  const instruction = m[2].trim()
  return instruction ? { targets, instruction } : null
}

export function parsePlannerReply(raw: string): PlannerReply {
  const planMatch = /<plan>([\s\S]*?)(?:<\/plan>|$)/i.exec(raw)
  const plan = planMatch ? normalizePlan(parseJsonLoose(planMatch[1])) : null
  const approved = /<approve\s*\/?>/i.test(raw)
  // An edit never comes with a plan: a plan change goes through the normal build.
  const edit = plan ? null : parseEditTag(raw)
  const text = raw
    .replace(/<plan>[\s\S]*?(?:<\/plan>|$)/gi, "")
    .replace(/<edit\b[^>]*>[\s\S]*?(?:<\/edit>|$)/gi, "")
    .replace(/<approve\s*\/?>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { text, plan, planInvalid: !!planMatch && !plan, approved, edit }
}

export function parsePlanJson(raw: string) {
  return normalizePlan(parseJsonLoose(raw))
}

/**
 * Splits a streamed reply into visible prose and hidden tag content as the
 * tokens arrive, so the chat never flashes a half-written tag.
 */
export class TagStreamFilter {
  private buf = ""
  /** The hidden block being read: <plan>…</plan> or <edit …>…</edit>. */
  private inside: "plan" | "edit" | null = null
  planText = ""
  editText = ""

  /** Returns the newly visible text for this chunk. */
  push(chunk: string): string {
    this.buf += chunk
    let out = ""
    for (;;) {
      if (this.inside) {
        const close = `</${this.inside}>`
        const end = this.buf.toLowerCase().indexOf(close)
        const sink = this.inside === "plan" ? "planText" : "editText"
        if (end === -1) {
          // Keep a tail that might be the start of the closing tag.
          const keep = Math.min(this.buf.length, close.length)
          this[sink] += this.buf.slice(0, this.buf.length - keep)
          this.buf = this.buf.slice(this.buf.length - keep)
          return out
        }
        this[sink] += this.buf.slice(0, end)
        this.buf = this.buf.slice(end + close.length)
        this.inside = null
        continue
      }
      const open = this.buf.search(/<plan>|<edit\b[^>]*>|<approve\s*\/?>/i)
      if (open !== -1) {
        out += this.buf.slice(0, open)
        const rest = this.buf.slice(open)
        if (/^<plan>/i.test(rest)) {
          this.inside = "plan"
          this.buf = rest.slice("<plan>".length)
        } else if (/^<edit\b/i.test(rest)) {
          const tag = /^<edit\b[^>]*>/i.exec(rest)![0]
          this.inside = "edit"
          // Keep the opening tag: its attributes say what to edit.
          this.editText += tag
          this.buf = rest.slice(tag.length)
        } else {
          this.buf = rest.replace(/^<approve\s*\/?>/i, "")
        }
        continue
      }
      // Hold back anything that could be the beginning of a tag, including
      // an <edit targets="..."> whose attributes haven't all arrived yet.
      const lt = this.buf.lastIndexOf("<")
      const tail = lt === -1 ? "" : this.buf.slice(lt)
      if (lt !== -1 && (tail.length < 10 || (/^<edit\b[^>]*$/i.test(tail) && tail.length < 400))) {
        out += this.buf.slice(0, lt)
        this.buf = tail
      } else {
        out += this.buf
        this.buf = ""
      }
      return out
    }
  }

  /** Flushes held-back text once the stream ends. */
  end(): string {
    if (this.inside) {
      this[this.inside === "plan" ? "planText" : "editText"] += this.buf
      this.buf = ""
      return ""
    }
    const out = this.buf.replace(/<approve\s*\/?>/gi, "").replace(/<edit\b[^>]*$/i, "")
    this.buf = ""
    return out
  }

  get insidePlan() {
    return this.inside === "plan"
  }

  /** Screen names seen so far in the partially streamed plan JSON. */
  screenNamesSoFar(): string[] {
    const i = this.planText.indexOf('"screens"')
    if (i === -1) return []
    const names: string[] = []
    const re = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    re.lastIndex = i
    let m: RegExpExecArray | null
    while ((m = re.exec(this.planText))) names.push(m[1])
    return names
  }
}

const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16)

/** Bump when the screen contract changes, so screens made under the old one are rebuilt. */
const SCREEN_CONTRACT = "expo-sdk58-v1"

/** A screen is rebuilt when its spec, the design direction or the data contract changes. */
// What each part of the app is built from. Kept as narrow as possible, so a
// plan tweak rebuilds only what it really affects (editing one screen's spec
// rebuilds that screen, not the whole app).

/** A screen is rebuilt when its own spec, the design direction or the shell it uses changes. */
export function screenSpecHash(plan: AppPlan, screen: PlanScreen, shell = "") {
  return hash({ s: screen, d: plan.design, shell, c: SCREEN_CONTRACT })
}

/** The shell (layouts + components) depends on the design and the tab/modal structure only. */
export const shellHash = (plan: AppPlan) =>
  hash({
    d: plan.design,
    s: plan.screens.filter((s) => s.presentation !== "stack").map((s) => [s.id, s.presentation, s.presentation === "tab" ? s.name : ""]),
    c: SCREEN_CONTRACT,
  })

/** The app's shared components depend on the design direction only, not on the navigation. */
export const componentsHash = (plan: AppPlan) => hash({ d: plan.design, c: SCREEN_CONTRACT })

/**
 * What a screen's code actually depends on: its own spec, the shared
 * components (so the design), and the routes it opens. Adding a tab or a
 * modal elsewhere in the app doesn't touch it, so it isn't rebuilt.
 */
export function screenBuildHash(plan: AppPlan, screen: PlanScreen) {
  const byId = new Map(plan.screens.map((s) => [s.id, s]))
  const routes = [screen.id, ...screen.navigatesTo].map((id) => [id, byId.get(id)?.presentation ?? null])
  return hash({ s: screen, comp: componentsHash(plan), routes, c: SCREEN_CONTRACT })
}

/** The theme package depends on the design direction only (renaming the app keeps it). */
export const themeHash = (plan: AppPlan) => hash({ d: plan.design })

/**
 * The data model is redone only when features or the set of screens change.
 * Even then existing collections are kept (see buildFoundation).
 */
export const dataHash = (plan: AppPlan) =>
  hash({
    f: plan.coreFeatures,
    s: plan.screens.map((s) => s.id).sort(),
  })

export function parseFoundationJson(raw: string): { themes?: unknown; data?: unknown } | null {
  const v = parseJsonLoose(raw)
  return v && typeof v === "object" ? (v as { themes?: unknown; data?: unknown }) : null
}

/** Pulls one source file out of a model reply (drops prose and Markdown fences). */
export function extractCode(raw: string): string {
  const t = raw.trim()
  const fenced = /```(?:tsx|typescript|ts|jsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)(?:```|$)/.exec(t)
  const code = fenced ? fenced[1] : t
  return code.trim() + "\n"
}

/** Parses <file path="...">...</file> blocks from a model reply. */
export function parseFiles(raw: string): Record<string, string> {
  const files: Record<string, string> = {}
  const re = /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const path = m[1].trim().replace(/^\.?\//, "")
    if (!/^[\w@()[\]./-]+$/.test(path) || path.includes("..")) continue
    files[path] = extractCode(m[2])
  }
  return files
}
