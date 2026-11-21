// The verified coder answers in tagged blocks (the AI gateway doesn't pass
// tool calls through). This turns a reply into a ChangeSet, or a question for
// the user. A malformed reply becomes a `protocol` problem, never a crash.
//
//   <intent>one sentence</intent>
//   <manifest_patch>[ JSON Patch ops ]</manifest_patch>   (Phase 6; ignored for now)
//   <file path="components/x.tsx"> whole file </file>
//   <edit path="app/(tabs)/home.tsx"> <<<<<<< SEARCH … ======= … >>>>>>> REPLACE </edit>
//   <delete path="components/Old.tsx"/>
//   <question>only when the request can't be done without the user's input</question>

import type { ChangeSet, FileChange, JsonPatchOp } from "@app/shared/verify/types"

export type ParsedReply = { changeSet: ChangeSet; question?: string; problems: string[] }

const stripFence = (s: string) => {
  const t = s.replace(/^\s*\n/, "").replace(/\s+$/, "")
  const m = /^```[\w-]*\s*\n([\s\S]*?)\n?```$/.exec(t.trim())
  return (m ? m[1] : t) + "\n"
}

const cleanPath = (p: string) => p.trim().replace(/^\.?\//, "")

export function parseReply(raw: string): ParsedReply {
  const problems: string[] = []
  const files: FileChange[] = []
  let manifestPatch: JsonPatchOp[] = []

  const intent = /<intent>([\s\S]*?)<\/intent>/i.exec(raw)?.[1].trim() ?? ""
  const question = /<question>([\s\S]*?)<\/question>/i.exec(raw)?.[1].trim()

  const mp = /<manifest_patch>([\s\S]*?)<\/manifest_patch>/i.exec(raw)
  if (mp) {
    try {
      const v = JSON.parse(stripFence(mp[1]))
      if (!Array.isArray(v)) throw new Error("manifest_patch must be a JSON array")
      manifestPatch = v
    } catch (e) {
      problems.push(`<manifest_patch> is not valid JSON: ${e instanceof Error ? e.message : e}`)
    }
  }

  for (const m of raw.matchAll(/<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g)) files.push({ path: cleanPath(m[1]), op: "write", content: stripFence(m[2]) })
  for (const m of raw.matchAll(/<edit\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/edit>/g)) {
    const hunks = [...m[2].matchAll(/<{5,9}\s*SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9}\s*REPLACE/g)].map((h) => ({ search: h[1], replace: h[2] }))
    if (hunks.length) files.push({ path: cleanPath(m[1]), op: "edit", hunks })
    else problems.push(`<edit path="${m[1]}"> has no SEARCH/REPLACE blocks.`)
  }
  for (const m of raw.matchAll(/<delete\s+path=["']([^"']+)["']\s*\/?>/g)) files.push({ path: cleanPath(m[1]), op: "delete" })

  // An unclosed <file> means the output was cut off.
  const opened = (raw.match(/<file\s+path=/g) ?? []).length
  const closed = (raw.match(/<\/file>/g) ?? []).length
  if (opened > closed) problems.push(`A <file> block wasn't closed (the output may have been cut off). Opened ${opened}, closed ${closed}.`)
  if (!question && !files.length && !manifestPatch.length && !problems.length) problems.push("The reply had no <file>, <edit>, <delete> or <question> block.")

  return { changeSet: { intent, manifestPatch, files }, question, problems }
}
