import { assistant, system, user, type AgentInputItem } from "@openai/agents"

import { messages, type Project } from "@/db"
import { describeElement, parseElementRef } from "@app/shared/agent/element-context"
import type { AppPlan, BuildProgress, GeneratedScreen } from "@app/shared/agent/types"

type DbMessage = typeof messages.$inferSelect

export function historyToInput(
  project: Project,
  history: DbMessage[],
  screens: GeneratedScreen[],
  components: string[] = [],
  /**
   * The current plan, verbatim. Chat history is sliced to the most recent
   * messages (see runPlanning), so on an active project the message that
   * originally carried this <plan> can scroll out of that window. Without
   * it the planner has to improvise wording for every existing screen when
   * asked to add just one, which breaks the exact-text match that lets an
   * addition build without another approval and keeps unrelated screens
   * from being rebuilt.
   */
  plan: AppPlan | null = null
): AgentInputItem[] {
  const names = new Map(screens.map((s) => [s.id, s.name]))
  const assets = project.assets ?? []
  const context = [
    `Project: "${project.name}".`,
    assets.length
      ? `Files the creator attached to the first message (names only): ${assets.map((a) => `${a.name} (${a.type})`).join(", ")}.`
      : "No files were attached.",
    screens.length
      ? `Screens already built on the canvas (id: name): ${screens.filter((s) => s.state === "ready").map((s) => `${s.id}: ${s.name}`).join(", ") || "none yet"}. Changes to these screens are edits (call request_edit); adding, removing or renaming screens is a plan change (call propose_plan with the full plan).`
      : "No screens have been designed yet.",
    components.length ? `Shared component files: ${components.join(", ")}.` : "",
    plan
      ? `The current plan, exactly as last approved (reproduce every field for every unchanged screen character-for-character; only add, remove or edit what the person actually asked to change):\n${JSON.stringify(plan)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const items: AgentInputItem[] = [system(context)]
  for (const m of history) {
    if (m.sender === "user") {
      const screenId = (m.pipelineData as { screenId?: string } | null)?.screenId
      const about = screenId && names.get(screenId) ? `[About the "${names.get(screenId)}" screen] ` : ""
      const el = parseElementRef((m.pipelineData as { element?: unknown } | null)?.element)
      items.push(user(`${el ? `${describeElement(el)}\n` : ""}${about}${m.text}`))
    } else if (m.type === "plan" && m.plan) {
      // Reconstructed as plain text, not the old <plan> tag: history is here
      // to remind the model what it proposed, not to model a reply format
      // it should imitate (the model now reports a plan by calling
      // propose_plan, not by writing a tag -- re-showing the tag in its own
      // past turns biased it right back toward writing tags instead of
      // calling the tool, confirmed by seeing it happen on a live project).
      items.push(assistant(`${m.text}\n\nProposed plan:\n${JSON.stringify(m.plan)}`))
    } else if (m.type === "build") {
      const b = m.pipelineData as BuildProgress | null
      items.push(assistant(`(Designed screens: ${b?.screens.map((s) => `${s.name} [${s.state}]`).join(", ") ?? "none"})`))
    } else {
      items.push(assistant(m.text))
    }
  }
  return items
}
