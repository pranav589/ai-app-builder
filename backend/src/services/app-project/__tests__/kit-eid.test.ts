// @vitest-environment jsdom
//
// Regression test for the canvas inspector (Phase 8, item 3): the eid the
// inline editor acts on has to point at the screen's own JSX usage of a
// @/kit component ("app/home.tsx:N:Text"), not at the line inside kit.ts
// where that component happens to render its underlying React Native
// element ("kit/index.tsx:N:Text") -- which isn't owned by the app and
// can't be edited, and would silently restyle every use of the component
// if it somehow were. This mounts the actual compiled KIT_SOURCE and a
// sample screen, with the same classic-JSX-with-__source transform and
// data-eid factory the real preview uses, and reads the rendered DOM.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import * as RNW from "react-native-web"

import { compileForPreview } from "@app/shared/app-project/project"
import { KIT_PATH, KIT_SOURCE } from "@/lib/app-project/kit"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A trimmed copy of preview-runtime/modules.ts's dev JSX factory: every
// element remembers where it was written, as data-eid="file:line:Type".
function makeJsx(file: string) {
  return function __jsx(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    if (props && ("__source" in props || "__self" in props)) {
      const { __source, __self: _s, ...rest } = props as { __source?: { lineNumber?: number }; __self?: unknown }
      if (type !== React.Fragment && __source?.lineNumber && !("dataSet" in rest)) {
        const name = typeof type === "string" ? type : ((type as { displayName?: string; name?: string })?.displayName ?? (type as { name?: string })?.name ?? "El")
        ;(rest as Record<string | symbol, unknown>).dataSet = { eid: `${file}:${__source.lineNumber}:${name}` }
      }
      props = rest
    }
    return React.createElement(type as never, props, ...(children as React.ReactNode[]))
  }
}
const __frag = React.Fragment

function loadModule(file: string, source: string, requires: Record<string, unknown>) {
  const code = compileForPreview(file, source)
  const fakeRequire = (spec: string) => {
    if (spec in requires) return requires[spec]
    throw new Error(`unexpected require in ${file}: ${spec}`)
  }
  const mod = { exports: {} as Record<string, unknown> }
  const fn = new Function("require", "module", "exports", "__jsx", "__frag", code)
  fn(fakeRequire, mod, mod.exports, makeJsx(file), __frag)
  return mod.exports
}

describe("canvas inspector eid through a @/kit component", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("points at the screen's own usage line, not at kit's internal implementation", async () => {
    const theme = { exports: { useTheme: () => ({ colors: { text: "#111", textMuted: "#666", primary: "#246", success: "#2a2", warning: "#a80", danger: "#a22", surface: "#fff", border: "#ddd", onPrimary: "#fff", background: "#fff" }, spacing: {}, radius: {} }) } }
    const kit = loadModule(KIT_PATH, KIT_SOURCE, {
      react: React,
      "react-native": RNW,
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      "@expo/vector-icons": { Ionicons: () => null },
      "@/theme": theme.exports,
    })

    const screenSource = `import { Text } from "@/kit"\n\nexport default function Home() {\n  return <Text variant="title">Hi there</Text>\n}\n`
    const screen = loadModule("app/home.tsx", screenSource, { react: React, "@/kit": kit }) as { default: React.ComponentType }

    await act(async () => {
      root.render(React.createElement(screen.default))
    })

    const el = container.querySelector("[data-eid]")
    expect(el?.getAttribute("data-eid")).toBe("app/home.tsx:4:Text")
    expect(el?.textContent).toBe("Hi there")
  })
})
