import { describe, expect, it } from "vitest"
import {
  askQuestionParams,
  classifyParams,
  deleteFileParams,
  describeToolCalls,
  editFileParams,
  patchManifestParams,
  toolCallsToChangeSet,
  toolCallsToFileMap,
  toolCallsToRouterReply,
  writeFileParams,
  type ToolCallLog,
} from "@/lib/verify/tools"
import { parseReply } from "@/lib/verify/protocol"
import { parseRouterReply } from "@/lib/verify/router"

describe("tool parameter schemas", () => {
  it("write_file accepts a path and content", () => {
    expect(writeFileParams.parse({ path: "a.tsx", content: "x" })).toEqual({ path: "a.tsx", content: "x" })
  })

  it("edit_file requires at least one hunk", () => {
    expect(() => editFileParams.parse({ path: "a.tsx", hunks: [] })).toThrow()
    expect(editFileParams.parse({ path: "a.tsx", hunks: [{ search: "a", replace: "b" }] })).toEqual({
      path: "a.tsx",
      hunks: [{ search: "a", replace: "b" }],
    })
  })

  it("delete_file rejects a missing path", () => {
    expect(() => deleteFileParams.parse({})).toThrow()
  })

  it("patch_manifest validates each op shape", () => {
    expect(() => patchManifestParams.parse({ ops: [{ op: "bogus", path: "/x" }] })).toThrow()
    expect(patchManifestParams.parse({ ops: [{ op: "remove", path: "/screens/x" }] })).toEqual({ ops: [{ op: "remove", path: "/screens/x" }] })
  })

  it("ask_question requires a question string", () => {
    expect(() => askQuestionParams.parse({})).toThrow()
    expect(askQuestionParams.parse({ question: "Which screen?" })).toEqual({ question: "Which screen?" })
  })

  it("classify only accepts a known route", () => {
    expect(() => classifyParams.parse({ route: "bogus" })).toThrow()
    expect(classifyParams.parse({ route: "edit", targets: ["home"] })).toEqual({ route: "edit", targets: ["home"] })
  })
})

describe("toolCallsToChangeSet", () => {
  it("maps write+edit+delete+patch_manifest calls to the same ChangeSet shape parseReply produces", () => {
    const log: ToolCallLog = [
      { name: "write_file", args: { path: "components/Card.tsx", content: "export const Card = () => null\n" } },
      { name: "edit_file", args: { path: "app/home.tsx", hunks: [{ search: "fontSize: 17", replace: "fontSize: 22" }] } },
      { name: "delete_file", args: { path: "components/Old.tsx" } },
      { name: "patch_manifest", args: { ops: [{ op: "remove", path: "/screens/x" }] } },
    ]
    const { changeSet, question } = toolCallsToChangeSet(log, "Make the header bigger.")
    expect(question).toBeUndefined()
    expect(changeSet).toEqual({
      intent: "Make the header bigger.",
      manifestPatch: [{ op: "remove", path: "/screens/x" }],
      files: [
        { path: "components/Card.tsx", op: "write", content: "export const Card = () => null\n" },
        { path: "app/home.tsx", op: "edit", hunks: [{ search: "fontSize: 17", replace: "fontSize: 22" }] },
        { path: "components/Old.tsx", op: "delete" },
      ],
    })

    // Equivalent tagged-block reply should produce the same ChangeSet (modulo content newline exactness).
    const tagged = parseReply(`<intent>Make the header bigger.</intent>
<edit path="app/home.tsx">
<<<<<<< SEARCH
fontSize: 17
=======
fontSize: 22
>>>>>>> REPLACE
</edit>
<file path="components/Card.tsx">
export const Card = () => null
</file>
<delete path="components/Old.tsx"/>
<manifest_patch>[{"op":"remove","path":"/screens/x"}]</manifest_patch>`)
    expect(new Set(tagged.changeSet.files.map((f) => f.path))).toEqual(new Set(changeSet.files.map((f) => f.path)))
    expect(tagged.changeSet.manifestPatch).toEqual(changeSet.manifestPatch)
  })

  it("maps an ask_question call to the question field, no files", () => {
    const { changeSet, question } = toolCallsToChangeSet([{ name: "ask_question", args: { question: "Which screen?" } }])
    expect(question).toBe("Which screen?")
    expect(changeSet.files).toEqual([])
  })
})

describe("toolCallsToRouterReply", () => {
  it("maps a classify call to the same RouterReply shape parseRouterReply produces", () => {
    const log: ToolCallLog = [{ name: "classify", args: { route: "edit", targets: ["home", "about"] } }]
    const fromTool = toolCallsToRouterReply(log)
    const fromTags = parseRouterReply("<route>edit</route>\n<targets>home, about</targets>")
    expect(fromTool).toEqual(fromTags)
  })

  it("returns null when no classify call was made", () => {
    expect(toolCallsToRouterReply([])).toBeNull()
  })

  it("defaults targets to an empty array and keeps answer undefined when omitted", () => {
    expect(toolCallsToRouterReply([{ name: "classify", args: { route: "question" } }])).toEqual({ route: "question", targets: [], answer: undefined })
  })
})

describe("toolCallsToFileMap", () => {
  it("collects write_file calls into a path -> content map", () => {
    const log: ToolCallLog = [
      { name: "write_file", args: { path: "app/_layout.tsx", content: "a" } },
      { name: "write_file", args: { path: "components/Button.tsx", content: "b" } },
      { name: "edit_file", args: { path: "ignored.tsx", hunks: [] } },
    ]
    expect(toolCallsToFileMap(log)).toEqual({ "app/_layout.tsx": "a", "components/Button.tsx": "b" })
  })

  it("a later write_file for the same path wins", () => {
    const log: ToolCallLog = [
      { name: "write_file", args: { path: "a.tsx", content: "first" } },
      { name: "write_file", args: { path: "a.tsx", content: "second" } },
    ]
    expect(toolCallsToFileMap(log)).toEqual({ "a.tsx": "second" })
  })
})

describe("describeToolCalls", () => {
  it("renders a readable summary for the model's own conversational memory", () => {
    const log: ToolCallLog = [{ name: "write_file", args: { path: "a.tsx", content: "x" } }]
    expect(describeToolCalls(log)).toBe('write_file({"path":"a.tsx","content":"x"})')
  })
})
