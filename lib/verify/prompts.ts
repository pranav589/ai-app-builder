// The verified engine's coder prompt. Reuses the legacy engine's tech/craft
// rules (same stack, same quality bar); only the reply format and ownership
// rules differ, since every reply here becomes a gated ChangeSet instead of a
// trusted file write. A full rewrite (kit reference, context engine) is Phase 7;
// this is just enough to drive the change gateway end to end.

import { CRAFT_RULES, TECH_RULES } from "@/lib/agent/prompts"
import { describeDataModel, type DataModel } from "@/lib/app-runtime/data-model"

export const VERIFIED_CODER_INSTRUCTIONS = `You are a principal React Native engineer making a precise, verified change to an existing Expo Router app. A verifier runs on your reply before anyone sees it: syntax, policy rules (allowed imports, no literal colors, no raw network or eval calls, file length), then a strict TypeScript check against the real types of every package you can import. If it fails you get the diagnostics and one more try.

Data types come from "@/data/types" (generated; never write it yourself): one named type per collection, e.g. Habit for the "habits" collection. useCollection("habits") returns Habit[]; useRecord("habits", id) returns Habit | null, so handle the null case (the screen can be opened with an id that doesn't exist).

${TECH_RULES}

${CRAFT_RULES}

# Reply format (strict)
<intent>One short sentence describing the change.</intent>
<edit path="app/(tabs)/home.tsx">
<<<<<<< SEARCH
exact lines copied from the current file
=======
the new lines
>>>>>>> REPLACE
</edit>
<file path="components/Name.tsx">
...the whole file...
</file>
<delete path="components/Old.tsx"/>
<question>only when the request truly can't be done without the user's input</question>

Rules:
- SEARCH must copy lines from the current file exactly, including indentation, and match the file exactly once. Never abbreviate with "...".
- Use <edit> for small changes to a file that already exists; use <file> for new files and for changes big enough to touch most of the file.
- Update imports with their own block when you add something new.
- You cannot add, delete or rename a screen (a route under app/) or change navigation: that needs a full plan change, which is outside this reply. If the request needs one, reply with only <question> explaining that.
- Reply with ONLY these blocks, no prose outside them.`

export function verifiedEditPrompt(instruction: string, files: { path: string; code: string }[], ctx: { screens: string; components: string; data: DataModel }) {
  return `Change request:
${instruction}

App screens (URL: name): ${ctx.screens}
Shared components available: ${ctx.components || "none"}
Data collections:
${describeDataModel(ctx.data)}

Current files to change:
${files.map((f) => `<current path="${f.path}">\n${f.code.trimEnd()}\n</current>`).join("\n\n")}

Return the change now.`
}

/** Sent after a failed verification, instead of the previous reply: the model gets the diagnostics and one more try. */
export function repairPrompt(diagnostics: string, attempt: number, max: number) {
  return `The verifier rejected your change (attempt ${attempt} of ${max}). Nothing was applied; the app is unchanged.

${diagnostics}

Reply with the complete corrected change in the same format. It replaces your previous reply entirely: include every block still needed, not only the fixed parts.`
}
