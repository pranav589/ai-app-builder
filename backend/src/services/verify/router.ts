// Phase 8: a small, fast classification step for the verified engine, run
// before the (slow, streaming) planner on every chat message once a project
// has a built app. Most chat messages are small edits to what's already
// there; routing them straight to the coder with focused context, instead
// of through a full planning pass, is what fixes.txt #2 and #4 are about.

import { z } from "zod"
import type { AppManifest } from "@app/shared/manifest/schema"

export const ROUTES = ["question", "edit", "add_screen", "structure", "integration", "unsupported"] as const
export type Route = (typeof ROUTES)[number]

export type RouterReply = { route: Route; targets: string[]; answer?: string }

export const ROUTER_INSTRUCTIONS = `You are a fast router in front of an AI app builder. Given the app's current screens and the user's latest message, call classify exactly once to pick exactly one route so the system can skip slow planning for an ordinary small edit.

Routes:
- question: the user is asking about the app, not asking to change it ("what screens does this have?", "where is the delete button?"). Answer it yourself in "answer" from the structure given. No files change.
- edit: a small, concrete change to one or more screens or components that already exist (text, layout, styling, a bug fix, a new field on an existing screen). List the screen ids it's about in "targets".
- add_screen: the user wants a new screen, tab or page added.
- structure: a change to navigation, the data model, or several screens at once that is not a simple edit (renaming or reordering tabs, a field used across many screens, a broad redesign).
- integration: the request needs a capability this app builder can't do yet (a live map, push notifications, camera, payments, a live network integration, a package outside the allowed list). Explain in "answer" what's missing, and suggest the closest smaller version if there is one.
- unsupported: the request is unrelated to building this app, or too vague to act on ("make it better", "make it nicer", "surprise me"). Ask in "answer" for specifics; offer 2 or 3 concrete directions when you can think of good ones.

When you are not confident between "edit" and "structure", or not confident at all, choose "structure": it goes through full planning, which is always correct, just slower.`

export function routerPrompt(manifest: AppManifest, message: string): string {
  const screens = Object.entries(manifest.screens)
    .map(([id, s]) => `- ${id} (${s.presentation}${s.collection ? `, about "${s.collection}"` : ""}): ${s.title}`)
    .join("\n")
  return `App structure:
Screens:
${screens || "(none yet)"}
Tabs: ${manifest.navigation.tabs.join(", ") || "none"}

User's latest message:
${message}

Classify it now.`
}

const routeEnum = z.enum(ROUTES)

/** Parses the router's tagged reply. Null when the reply doesn't name a known route (the caller falls back to the planner). */
export function parseRouterReply(raw: string): RouterReply | null {
  const routeMatch = /<route>\s*([a-z_]+)\s*<\/route>/i.exec(raw)
  if (!routeMatch) return null
  const parsed = routeEnum.safeParse(routeMatch[1].trim().toLowerCase())
  if (!parsed.success) return null
  const targetsMatch = /<targets>([\s\S]*?)<\/targets>/i.exec(raw)
  const targets = (targetsMatch?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  const answerMatch = /<answer>([\s\S]*?)<\/answer>/i.exec(raw)
  const answer = answerMatch?.[1].trim()
  return { route: parsed.data, targets, answer: answer || undefined }
}
