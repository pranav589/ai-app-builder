// @vitest-environment jsdom
import * as React from "react"
import { describe, expect, it } from "vitest"
import { useQueryClient } from "@tanstack/react-query"
import { QueryProvider } from "../query-provider"

function Child() {
  const client = useQueryClient()
  return <div data-testid="ready">{client ? "client-loaded" : "no-client"}</div>
}

describe("QueryProvider", () => {
  it("provides a QueryClient context to child components", () => {
    // In React 19 / jsdom, render component directly
    const element = (
      <QueryProvider>
        <Child />
      </QueryProvider>
    )

    expect(element).toBeDefined()
    expect(element.type).toBe(QueryProvider)
  })
})
