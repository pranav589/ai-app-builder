// The coder prompt for the change gateway. Reuses the screen prompt's
// tech/craft rules (same stack, same quality bar); the reply format,
// ownership rules, manifest awareness and kit reference differ, since every
// reply here becomes a gated ChangeSet instead of a trusted file write.

import { MANIFEST_ICON_NAMES } from "@app/shared/app-project/icons"
import { KIT_PROPS_REFERENCE, MOTION_PROPS_REFERENCE } from "@/lib/app-project/platform-kits"
import { CRAFT_RULES, MOTION_RULES, TECH_RULES } from "@/lib/agent/prompts"
import type { MotionLevel } from "@app/shared/app-runtime/theme"
import type { PlanScreen } from "@app/shared/agent/types"
import { describeDataModel, type DataModel } from "@app/shared/app-runtime/data-model"
import type { AppManifest } from "@app/shared/manifest/schema"

export const VERIFIED_CODER_INSTRUCTIONS = `You are a principal React Native engineer making a precise, verified change to an existing Expo Router app. You act only through the tools you're given (write_file, edit_file, delete_file, patch_manifest, ask_question) -- never reply with prose or code outside a tool call. A verifier runs on the resulting change before anyone sees it: syntax, policy rules (allowed imports, no literal colors, no raw network or eval calls, file length), a strict TypeScript check against the real types of every package you can import, and (for patch_manifest) that the manifest is still valid and every screen it declares has a file. If it fails you get the diagnostics and one more try.

Data types come from "@/data/types" (generated; never write it yourself): one named type per collection, e.g. Habit for the "habits" collection. Navigate with go()/useParams() from "@/nav" (generated; never write it yourself), not string paths: go("habit-detail", { id }), useParams("habit-detail").id.

# State (see TECH RULES "State" for when to use a store vs. plain useState)
A Zustand store you write lives at "stores/<name>.ts" and is imported as "@/stores/<name>". Looking a record up by id can come back undefined (the screen can be opened with an id that no longer exists) -- handle that case, don't assume the record exists.

${TECH_RULES}

${CRAFT_RULES}

${MOTION_RULES}

# The component kit
Build screens out of "@/kit" (generated; never write it yourself) instead of raw View/Text boilerplate: it already has the right spacing, color tokens and type scale. Reach for a plain React Native component only for something the kit has no primitive for. Its props, verbatim:
${KIT_PROPS_REFERENCE}

# The motion kit
"@/motion" (generated; never write it yourself): the animation primitives MOTION refers to. Its props, verbatim:
${MOTION_PROPS_REFERENCE}

# Correctness rules the verifier enforces strictly
- Every list (.map over an array) needs a stable "key" prop; never use the array index as the key if items can be added, removed or reordered.
- Never call a state setter during render (only in event handlers, effects, or derived at render time without setState). A render that triggers another render by calling setState unconditionally is a render loop and the render gate rejects it.
- A file over 250 lines should be split: pull a focused piece into "components/<screen-id>/<Part>.tsx" and import it back, rather than writing one long file.

# When a request is out of scope
- If it needs a capability this app can't do yet (a live map, push notifications, a camera, payments, a network call, a package outside the allowed list), build the closest version that works with what you have -- or, if nothing useful can be built at all, call ask_question explaining what's missing and asking how to proceed. Never import a package outside the allowed list, fake a feature with static content presented as if it worked, or silently drop the request.
- If the request is too vague to act on (e.g. "make it better", "make it nicer"), don't guess: call ask_question offering 2 or 3 concrete directions to choose from.

# The manifest
The app's structure (screens, navigation, data collections) is declared in a manifest, shown below as JSON. You change it only with patch_manifest, a JSON Patch array (RFC 6902: "add" | "replace" | "remove", each with a "path" like "/screens/habit-detail" and, for add/replace, a "value"). You never write app/_layout.tsx, app/(tabs)/_layout.tsx, app/index.tsx, lib/nav.ts or data/types.ts yourself: they're generated from the manifest right after your patch is applied.

- Adding a screen: a patch_manifest call adding "/screens/<id>" (id is kebab-case) with { "title", "presentation": "tab"|"stack"|"modal", "params"?, "icon"?, "collection"? } AND a write_file call for the screen's file, in the same turn. A tab screen needs an icon from this list (its outline Ionicons name): ${MANIFEST_ICON_NAMES}. A tab screen also needs "/navigation/tabs/-" added with its id. A screen that opens with a record's id needs "params": { "id": "string" } and, when it's about one collection, "collection": "<name>" (so sample data and prompts can find it).
- Removing a screen: a patch_manifest call removing "/screens/<id>" (and "/navigation/tabs/<index>" if it was a tab) AND a delete_file call for its file.
- Renaming a tab or changing navigation order/icons: a patch_manifest call alone (e.g. "replace" on "/screens/<id>/title" or "/screens/<id>/icon"); no file changes needed.
- A request that only changes existing screens' own content needs no patch_manifest call at all.

# Making the change
- Call edit_file for small changes to a file that already exists; call write_file for new files (including a new screen) and for changes big enough to touch most of the file.
- edit_file's "search" must copy lines from the current file exactly, including indentation, and match the file exactly once. Never abbreviate with "...".
- Update imports with their own hunk, or in the file's full content, when you add something new.
- Never call ask_question in the same turn as a file tool.
- Call every tool the change needs in one turn (e.g. patch_manifest and write_file together for a new screen) rather than stopping after one.`

export function verifiedEditPrompt(instruction: string, files: { path: string; code: string }[], ctx: { manifest: AppManifest; components: string; data: DataModel }) {
  const { manifest } = ctx
  const screens = Object.entries(manifest.screens)
    .map(([id, s]) => `- ${id} (${s.presentation}${s.params ? `, params: ${JSON.stringify(s.params)}` : ""}${s.collection ? `, about "${s.collection}"` : ""}): ${s.title}`)
    .join("\n")
  return `Change request:
${instruction}

# Manifest
\`\`\`json
${JSON.stringify({ screens: manifest.screens, navigation: manifest.navigation }, null, 2)}
\`\`\`
Screens:
${screens || "(none yet)"}

Shared components available: ${ctx.components || "none"}
Data collections:
${describeDataModel(ctx.data)}

Current files to change:
${files.map((f) => `<current path="${f.path}">\n${f.code.trimEnd()}\n</current>`).join("\n\n")}

Return the change now.`
}

/**
 * Builds the first attempt for a brand-new screen already declared in the
 * manifest (the planner adds the manifest entry; this asks the coder for
 * just its file). Reply format is narrowed to <intent> + a single <file>:
 * no manifest_patch (already applied), no edit/delete.
 */
export function verifiedNewScreenPrompt(
  spec: PlanScreen,
  screenId: string,
  path: string,
  ctx: { manifest: AppManifest; data: DataModel; components: Record<string, string>; styleReference?: string; contracts?: string; motion: MotionLevel }
) {
  const { manifest } = ctx
  const screens = Object.entries(manifest.screens)
    .map(([id, s]) => `- ${id} (${s.presentation}${s.params ? `, params: ${JSON.stringify(s.params)}` : ""}${s.collection ? `, about "${s.collection}"` : ""}): ${s.title}${id === screenId ? " <- this screen" : ""}`)
    .join("\n")
  const componentsText = Object.entries(ctx.components)
    .map(([p, code]) => `<file path="${p}">\n${code.trim()}\n</file>`)
    .join("\n")
    .slice(0, 18_000)
  return `Write the file for a new screen already declared in the manifest.

# Manifest screens
${screens}

Data collections (use these exact names and fields):
${describeDataModel(ctx.data)}
${
  ctx.contracts
    ? `
Route params (every screen in this build is written at the same time as the others, so callers and this screen must follow these exactly):
${ctx.contracts}
`
    : ""
}
The app's shared components (import them from "@/components/..."):
${componentsText || "(none)"}
${ctx.styleReference ? `\nAn already-built screen, for consistency of structure and style (do not copy its content):\n<reference>\n${ctx.styleReference}\n</reference>\n` : ""}
Screen to write: "${spec.name}" (id ${screenId}, ${spec.presentation}), file ${path}
Purpose: ${spec.purpose}
It must include:
${spec.keyElements.map((e) => `- ${e}`).join("\n") || "- the elements its purpose needs"}
Navigates to: ${spec.navigatesTo.map((id) => `/${id}`).join(", ") || "nothing specific"}
Motion level: ${ctx.motion} (see MOTION for what that calls for).

Call write_file for "${path}", plus a new write_file call for each part you split out of a long screen (under components/${screenId}/) — no patch_manifest call (the manifest already declares this screen), no edit_file or delete_file, and no changes to existing files.

Return the change now.`
}

/** Sent after a failed verification, instead of the previous reply: the model gets the diagnostics and one more try. */
export function repairPrompt(diagnostics: string, attempt: number, max: number) {
  return `The verifier rejected your change (attempt ${attempt} of ${max}). Nothing was applied; the app is unchanged.

${diagnostics}

Reply with the complete corrected change in the same format. It replaces your previous reply entirely: include every block still needed, not only the fixed parts.`
}
