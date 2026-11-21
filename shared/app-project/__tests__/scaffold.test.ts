import { describe, expect, it } from "vitest"
import { readmeFile, scaffoldFiles, slug } from "../scaffold"

describe("scaffoldFiles", () => {
  it("includes all scaffold files when projectId is null and uses generic metro config", () => {
    const files = scaffoldFiles(null)
    expect(Object.keys(files).sort()).toEqual([".gitignore", "babel.config.js", "metro.config.js"])
    expect(files["babel.config.js"]).toContain("babel-preset-expo")
    expect(files[".gitignore"]).toContain("node_modules/")
    expect(files["metro.config.js"]).toContain("getDefaultConfig")
    expect(files["metro.config.js"]).not.toContain("cacheVersion")
  })

  it("includes per-project cacheVersion in metro config when projectId is provided", () => {
    const files = scaffoldFiles("p1")
    expect(Object.keys(files).sort()).toEqual([".gitignore", "babel.config.js", "metro.config.js"])
    expect(files["metro.config.js"]).toContain(`config.cacheVersion = "p1"`)
  })
})

describe("readmeFile", () => {
  it("renders a README mentioning project name and run commands", () => {
    const content = readmeFile("Awesome App")
    expect(content).toContain("# Awesome App")
    expect(content).toContain("npm install")
    expect(content).toContain("npx expo start")
  })
})

describe("slug", () => {
  it("converts names to clean hyphenated slugs", () => {
    expect(slug("My Super App!")).toBe("my-super-app")
    expect(slug("")).toBe("my-app")
  })
})
