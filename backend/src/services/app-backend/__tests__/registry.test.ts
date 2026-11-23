import { describe, expect, it } from "vitest"
import { BACKEND_PROVIDER_IDS } from "@app/shared/app-backend/providers"
import { getProvider, listProviders, providerFor } from "../registry"

describe("backend provider registry", () => {
  it("has an adapter for every provider the shared catalogue offers", () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual([...BACKEND_PROVIDER_IDS].sort())
  })

  it("resolves a provider by id and refuses unknown ones with a 404", () => {
    expect(getProvider("cloudhike").id).toBe("cloudhike")
    expect(() => getProvider("nope")).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => getProvider(undefined)).toThrow(expect.objectContaining({ status: 404 }))
  })

  it("answers the provider a stored row was set up with", () => {
    expect(providerFor({ provider: "cloudhike" }).id).toBe("cloudhike")
  })
})
