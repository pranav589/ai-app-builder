import { describe, expect, it } from "vitest"
import { applyElementEdit as apply, parseEid } from "@/lib/verify/codemod"

/** The edited code, or null when the codemod refused. */
const applyElementEdit = (...args: Parameters<typeof apply>) => {
  const r = apply(...args)
  return "code" in r ? r.code : null
}

describe("parseEid", () => {
  it("splits file, line and tag", () => {
    expect(parseEid("app/(tabs)/home.tsx:42:Text")).toEqual({ file: "app/(tabs)/home.tsx", line: 42, tag: "Text" })
  })

  it("rejects a malformed eid", () => {
    expect(parseEid("not-an-eid")).toBeNull()
    expect(parseEid("app/home.tsx:Text")).toBeNull()
  })
})

describe("applyElementEdit", () => {
  it("returns null when no element matches the line and tag", () => {
    const code = `export default function Home() {\n  return <Text>Hi</Text>\n}\n`
    expect(applyElementEdit(code, { line: 99, tag: "Text" }, { text: "Hey" })).toBeNull()
    expect(applyElementEdit(code, { line: 2, tag: "View" }, { text: "Hey" })).toBeNull()
  })

  it("replaces a plain text child", () => {
    const code = `export default function Home() {\n  return <Text>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Hello there" })
    expect(out).toContain("<Text>Hello there</Text>")
  })

  it("inserts text into an element with no children", () => {
    const code = `export default function Home() {\n  return <Text></Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Hi" })
    expect(out).toContain("<Text>Hi</Text>")
  })

  it("refuses a text edit when the children are dynamic, rather than dropping it silently", () => {
    const code = `export default function Home({ title }) {\n  return <Text style={{ fontSize: 14 }}>{title}</Text>\n}\n`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Hi", from: "Welcome", style: { fontSize: "18px" } })).toBeNull()
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { style: { fontSize: "18px" } })).toContain("fontSize: 18")
  })

  it("writes a numeric React Native style (no unit) for a pixel value, but keeps a color quoted", () => {
    const code = `export default function Home() {\n  return <Text style={{ fontSize: 14 }}>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { style: { fontSize: "22px", color: "#112233" } })
    expect(out).toContain("fontSize: 22")
    expect(out).toContain(`color: "#112233"`)
  })

  it("overwrites an existing style property", () => {
    const code = `export default function Home() {\n  return <Text style={{ color: "red", fontSize: 14 }}>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { style: { color: "blue" } })
    expect(out).toContain(`color: "blue"`)
    expect(out).toContain("fontSize: 14")
    expect(out).not.toContain("red")
  })

  it("adds a new style property to an existing object", () => {
    const code = `export default function Home() {\n  return <Text style={{ color: "red" }}>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { style: { fontWeight: "700" } })
    expect(out).toContain(`color: "red"`)
    expect(out).toContain(`fontWeight: "700"`)
  })

  it("adds a style prop to an element that had none", () => {
    const code = `export default function Home() {\n  return <Text>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { style: { color: "blue" } })
    expect(out).toContain(`<Text style={{ color: "blue" }}>Hi</Text>`)
  })

  it("wraps a StyleSheet-referencing style prop in an array instead of guessing its contents", () => {
    const code = `export default function Home() {\n  return <Text style={styles.title}>Hi</Text>\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { style: { color: "blue" } })
    expect(out).toContain(`style={[styles.title, { color: "blue" }]}`)
  })

  it("handles a self-closing element", () => {
    const code = `export default function Home() {\n  return <View style={{ padding: 8 }} />\n}\n`
    const out = applyElementEdit(code, { line: 2, tag: "View" }, { style: { padding: "12px" } })
    expect(out).toContain(`padding: 12`)
  })

  it("returns null when there is nothing to change", () => {
    const code = `export default function Home() {\n  return <Text>Hi</Text>\n}\n`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, {})).toBeNull()
  })

  it("picks the element whose current text matches when a line has several of the same tag", () => {
    const code = `export default function Home() {
  return <Row><Text>One</Text><Text>Two</Text></Row>
}
`
    const out = applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Second", from: "Two" })
    expect(out).toContain("<Text>One</Text><Text>Second</Text>")
  })

  it("refuses (never guesses) when several elements on the line can't be told apart", () => {
    const code = `export default function Home() {
  return <Row><Text>Same</Text><Text>Same</Text></Row>
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { text: "X", from: "Same" })).toBeNull()
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { style: { color: "red" } })).toBeNull()
  })

  it("refuses when the current text doesn't match what was tapped (stale eid)", () => {
    const code = `export default function Home() {
  return <Text>Profile</Text>
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Hi", from: "Settings" })).toBeNull()
  })

  it("edits a kit component's text prop (e.g. a Button label) by its current value", () => {
    const code = `export default function Home() {
  return <Button label="Save" onPress={save} variant="primary" />
}
`
    const out = applyElementEdit(code, { line: 2, tag: "Button" }, { text: "Save changes", from: "Save" })
    expect(out).toContain(`<Button label="Save changes" onPress={save} variant="primary" />`)
  })

  it("refuses a prop text edit when the prop is dynamic", () => {
    const code = `export default function Home({ n }) {
  return <Stat label="Steps" value={n} />
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Stat" }, { text: "9", from: "1200" })).toBeNull()
    expect(applyElementEdit(code, { line: 2, tag: "Stat" }, { text: "Walked", from: "Steps" })).toContain(`label="Walked"`)
  })

  it("keeps the line count when replacing multi-line text, so eids below stay valid", () => {
    const code = `export default function Home() {
  return (
    <Text>
      Hello
    </Text>
  )
}
`
    const out = applyElementEdit(code, { line: 3, tag: "Text" }, { text: "Bye", from: "Hello" })!
    expect(out).toContain("<Text>\n      Bye\n    </Text>")
    expect(out.split("\n").length).toBe(code.split("\n").length)
  })

  it("escapes text that isn't valid bare JSX", () => {
    const code = `export default function Home() {
  return <Text>Hi</Text>
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { text: "a {b} <c>", from: "Hi" })).toContain(`<Text>{"a {b} <c>"}</Text>`)
  })

  it("accepts the lone element on the line when the runtime name differs from the source tag (an alias)", () => {
    const code = `export default function Home() {
  return <RNText>Hi</RNText>
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { text: "Yo", from: "Hi" })).toContain("<RNText>Yo</RNText>")
  })

  it("appends a style property after a trailing comma without breaking syntax", () => {
    const code = `export default function Home() {
  return <Text style={{ color: "red", }}>Hi</Text>
}
`
    expect(applyElementEdit(code, { line: 2, tag: "Text" }, { style: { fontWeight: "700" } })).toContain(`{{ color: "red", fontWeight: "700", }}`)
  })
})
