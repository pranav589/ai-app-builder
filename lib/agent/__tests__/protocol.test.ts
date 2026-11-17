import { describe, expect, it } from "vitest"
import { TagStreamFilter, parseEditTag, parsePlannerReply } from "@/lib/agent/protocol"

describe("parsePlannerReply", () => {
  it("extracts a valid plan and strips the tag from the visible text", () => {
    const plan = {
      appName: "Habit Tracker",
      summary: "Track daily habits",
      targetUsers: "Everyone",
      coreFeatures: ["Streaks"],
      design: { style: "Clean" },
      navigation: "Tabs",
      screens: [{ name: "Home", presentation: "tab" }],
    }
    const raw = `Here's a plan.\n<plan>${JSON.stringify(plan)}</plan>\nLet me know what you think.`
    const reply = parsePlannerReply(raw)
    expect(reply.plan?.appName).toBe("Habit Tracker")
    expect(reply.plan?.screens).toHaveLength(1)
    expect(reply.plan?.screens[0].id).toBe("home")
    expect(reply.text).toBe("Here's a plan.\n\nLet me know what you think.")
    expect(reply.planInvalid).toBe(false)
    expect(reply.approved).toBe(false)
    expect(reply.edit).toBeNull()
  })

  it("flags a <plan> block that fails validation without crashing", () => {
    const reply = parsePlannerReply("<plan>{ not json </plan>")
    expect(reply.plan).toBeNull()
    expect(reply.planInvalid).toBe(true)
  })

  it("detects approval", () => {
    expect(parsePlannerReply("Looks great! <approve/>").approved).toBe(true)
    expect(parsePlannerReply("Looks great! <approve />").approved).toBe(true)
    expect(parsePlannerReply("Looks great.").approved).toBe(false)
  })

  it("parses an edit tag only when there is no plan", () => {
    const reply = parsePlannerReply(`<edit targets="home,about">Make the header bigger.</edit>`)
    expect(reply.edit).toEqual({ targets: ["home", "about"], instruction: "Make the header bigger." })
    expect(reply.plan).toBeNull()
  })

  it("gives every screen a unique, stable id, deduping collisions", () => {
    const plan = {
      appName: "App",
      screens: [{ name: "Home" }, { name: "Home" }],
    }
    const reply = parsePlannerReply(`<plan>${JSON.stringify(plan)}</plan>`)
    expect(reply.plan?.screens.map((s) => s.id)).toEqual(["home", "home-2"])
  })

  it("caps screens at MAX_SCREENS", () => {
    const plan = {
      appName: "App",
      screens: Array.from({ length: 15 }, (_, i) => ({ name: `Screen ${i}` })),
    }
    const reply = parsePlannerReply(`<plan>${JSON.stringify(plan)}</plan>`)
    expect(reply.plan?.screens).toHaveLength(10)
  })
})

describe("parseEditTag", () => {
  it("returns null without an instruction", () => {
    expect(parseEditTag(`<edit targets="home"></edit>`)).toBeNull()
  })

  it("returns null with no edit tag", () => {
    expect(parseEditTag("just text")).toBeNull()
  })

  it("defaults to no targets", () => {
    expect(parseEditTag("<edit>Fix the bug.</edit>")).toEqual({ targets: [], instruction: "Fix the bug." })
  })
})

describe("TagStreamFilter", () => {
  it("passes through plain prose unchanged across chunks", () => {
    const f = new TagStreamFilter()
    let out = f.push("Hello ")
    out += f.push("world")
    out += f.end()
    expect(out).toBe("Hello world")
  })

  it("hides a <plan> block split across chunks and captures its content", () => {
    const f = new TagStreamFilter()
    let out = ""
    out += f.push("Here is a plan: <pla")
    out += f.push(`n>{"a":1}</pla`)
    out += f.push("n> done.")
    out += f.end()
    expect(out).toBe("Here is a plan:  done.")
    expect(f.planText).toBe('{"a":1}')
  })

  it("hides an <edit> block including its opening tag attributes", () => {
    const f = new TagStreamFilter()
    let out = f.push(`before <edit targets="home">change the title</edit> after`)
    out += f.end()
    expect(out).toBe("before  after")
    expect(f.editText).toBe(`<edit targets="home">change the title`)
  })

  it("drops a bare <approve/> tag", () => {
    const f = new TagStreamFilter()
    let out = f.push("Great! <approve/>")
    out += f.end()
    expect(out).toBe("Great! ")
  })
})
