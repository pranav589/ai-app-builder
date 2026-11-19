import "server-only"
import { randomBytes } from "node:crypto"
import { system } from "@openai/agents"
import { asc, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { getAgents, heartbeat, streamText } from "./agents"
import { historyToInput } from "./history-to-input"
import { latestPlan, loadProject, saveMessage, setPhase } from "./history"
import {
  TagStreamFilter,
  type EditRequest,
  parsePlanJson,
  parsePlannerReply,
} from "./protocol"
import type { LiveRun } from "./registry"
import { NEW_SCREEN_NUDGE } from "./router"
import type { AgentPhase, AppPlan } from "./types"

const id = (p: string) => `${p}-${Date.now()}-${randomBytes(3).toString("hex")}`

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

/**
 * True when `next` keeps the design and every existing screen's identity
 * (id, name, presentation) as it was, adds at least one screen, and the
 * only way an existing screen's `navigatesTo` differs is by gaining a link
 * to one of the newly added screens -- never dropping or changing a link to
 * one that already existed. That covers the common case of adding a screen
 * that's reached from an existing one (e.g. a gear icon added to an
 * existing screen's header to open the new Settings screen): the existing
 * screen's `keyElements`/`purpose` legitimately change to describe that new
 * link, which would otherwise make this look like a non-additive replan.
 * Those existing-screen changes still rebuild that one screen
 * (screenBuildHash hashes the full spec); this check only decides whether
 * the change builds right away or waits for approval.
 */
export function onlyAddsScreens(prev: AppPlan, next: AppPlan) {
  if (next.screens.length <= prev.screens.length) return false
  if (JSON.stringify(prev.design) !== JSON.stringify(next.design)) return false
  const addedIds = new Set(next.screens.filter((s) => !prev.screens.some((p) => p.id === s.id)).map((s) => s.id))
  const nextById = new Map(next.screens.map((s) => [s.id, s]))
  return prev.screens.every((s) => {
    const n = nextById.get(s.id)
    if (!n || n.presentation !== s.presentation || n.name !== s.name) return false
    const keptOld = n.navigatesTo.filter((id) => !addedIds.has(id))
    const oldTargets = new Set(s.navigatesTo)
    return keptOld.length === s.navigatesTo.length && keptOld.every((id) => oldTargets.has(id))
  })
}

export async function runPlanning(run: LiveRun, projectId: string, opts: { first: boolean; nudge?: string }) {
  const { planner, planFixer } = getAgents()
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
    const input = historyToInput(project, recent, screens, components, prevPlan)
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
      [...historyToInput(project, recent, screens, components, prevPlan), system(NEW_SCREEN_NUDGE)],
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
