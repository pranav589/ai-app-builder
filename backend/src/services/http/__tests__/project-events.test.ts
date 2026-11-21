import { describe, expect, it, vi } from "vitest"

// The module opens its single LISTEN connection once per process, so the handlers are captured
// when it does and kept for every test.
const m = vi.hoisted(() => ({
  onNotify: (_payload: string) => {},
  onListen: () => {},
  listen: vi.fn(),
}))

vi.mock("postgres", () => ({ default: () => ({ listen: m.listen }) }))

process.env.DIRECT_URL = "postgres://test"
const { subscribeToProject } = await import("../project-events")

m.listen.mockImplementation((_channel: string, onNotify: typeof m.onNotify, onListen: typeof m.onListen) => {
  m.onNotify = onNotify
  m.onListen = onListen
  return Promise.resolve()
})

const notify = (payload: string) => m.onNotify(payload)
const reconnect = () => m.onListen()

describe("subscribeToProject", () => {
  it("delivers a notification only to subscribers of that project", () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeToProject("p1", a)
    const offB = subscribeToProject("p2", b)
    notify(JSON.stringify({ table: "builds", projectId: "p1" }))
    expect(a).toHaveBeenCalledWith({ table: "builds" })
    expect(b).not.toHaveBeenCalled()
    offA()
    offB()
  })

  it("stops delivering after unsubscribe", () => {
    const a = vi.fn()
    subscribeToProject("p1", a)()
    notify(JSON.stringify({ table: "builds", projectId: "p1" }))
    expect(a).not.toHaveBeenCalled()
  })

  it("ignores a malformed payload", () => {
    const a = vi.fn()
    const off = subscribeToProject("p1", a)
    expect(() => notify("not json")).not.toThrow()
    expect(a).not.toHaveBeenCalled()
    off()
  })

  it("tells every subscriber to resync after the listener reconnects, but not on its first connect", () => {
    const a = vi.fn()
    const off = subscribeToProject("p1", a)
    reconnect() // first connect: nothing can have been missed
    expect(a).not.toHaveBeenCalled()
    reconnect()
    expect(a).toHaveBeenCalledWith({ resync: true })
    off()
  })
})
