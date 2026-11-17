import { describe, expect, it } from "vitest"
import { runChange, type ModelAdapter } from "@/lib/verify/run"
import type { Workspace } from "@/lib/verify/types"

const base: Workspace = { files: { "app/home.tsx": "export default function Home() {\n  return null\n}\n" } }

const okReply = `<intent>Fix the header</intent>\n<file path="app/home.tsx">\nexport default function Home() {\n  return null\n}\n</file>`
const badReply = `<intent>Fix the header</intent>\n<file path="app/home.tsx">\nimport { pad } from "left-pad"\nexport default function Home() {\n  return null\n}\n</file>`

const adapter = (replies: string[]): ModelAdapter => {
  let n = 0
  return async () => ({ text: replies[Math.min(n++, replies.length - 1)], modelMs: 1 })
}

describe("runChange", () => {
  it("commits on the first attempt when the change passes", async () => {
    const result = await runChange(base, "make it nicer", adapter([okReply]))
    expect(result.state).toBe("committed")
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].ok).toBe(true)
  })

  it("repairs and commits after two failed attempts", async () => {
    const result = await runChange(base, "make it nicer", adapter([badReply, badReply, okReply]))
    expect(result.state).toBe("committed")
    expect(result.attempts).toHaveLength(3)
    expect(result.attempts[0].ok).toBe(false)
    expect(result.attempts[1].ok).toBe(false)
    expect(result.attempts[2].ok).toBe(true)
  })

  it("gives up after the repair budget and leaves the app unchanged", async () => {
    const result = await runChange(base, "make it nicer", adapter([badReply]), { maxRepairs: 3 })
    expect(result.state).toBe("needs_user")
    if (result.state === "needs_user") expect(result.reason).toBe("exhausted")
    expect(result.attempts).toHaveLength(4)
    expect(result.attempts.every((a) => !a.ok)).toBe(true)
  })

  it("asks the user when the model replies with only a question", async () => {
    const question = `<question>Maps aren't supported yet. Want a list of places instead?</question>`
    const result = await runChange(base, "add a map", adapter([question]))
    expect(result.state).toBe("needs_user")
    if (result.state === "needs_user") {
      expect(result.reason).toBe("question")
      expect(result.message).toBe("Maps aren't supported yet. Want a list of places instead?")
    }
    expect(result.attempts).toHaveLength(1)
  })

  it("treats a malformed reply as a parse problem and retries, not a crash", async () => {
    const result = await runChange(base, "make it nicer", adapter(["no tags at all", okReply]))
    expect(result.state).toBe("committed")
    expect(result.attempts[0].failedAt).toBe("parse")
  })

  it("respects VERIFY_DEBUG_FAIL by failing the named gate synthetically", async () => {
    const result = await runChange(base, "make it nicer", adapter([okReply, okReply, okReply]), { debugFail: { gate: "policy", n: 2 } })
    expect(result.state).toBe("committed")
    expect(result.attempts).toHaveLength(3)
    expect(result.attempts[0].failedAt).toBe("policy")
    expect(result.attempts[1].failedAt).toBe("policy")
    expect(result.attempts[2].ok).toBe(true)
  })
})
