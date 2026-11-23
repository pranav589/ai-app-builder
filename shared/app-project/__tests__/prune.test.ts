import { describe, expect, it } from "vitest"
import { pruneProject, usedPackageRoots } from "../prune"

const BASE_PACKAGE_JSON = JSON.stringify(
  {
    name: "my-app",
    dependencies: {
      expo: "~58.0.25",
      react: "19.3.0",
      "react-native-reanimated": "4.7.1",
      "expo-image-picker": "~58.0.10",
      "expo-location": "~58.0.22",
      "expo-local-authentication": "~58.0.3",
      "expo-notifications": "~58.1.9",
      "expo-haptics": "~58.0.8",
      "expo-image": "~58.0.18",
      "expo-clipboard": "~58.0.4",
      "expo-sharing": "~58.0.23",
      "expo-linking": "~58.0.17",
    },
  },
  null,
  2
)

const BASE_APP_JSON = JSON.stringify(
  { expo: { name: "App", plugins: ["expo-router", "expo-font", "expo-notifications", "expo-local-authentication", "expo-location", "expo-image-picker"] } },
  null,
  2
)

describe("usedPackageRoots", () => {
  it("collects bare package specifiers, mapping subpaths to their package root", () => {
    const files = {
      "app/home.tsx": `import { Ionicons } from "@expo/vector-icons/Ionicons"\nimport { NativeTabs } from "expo-router/native-tabs"\nimport "./local"\nimport { useTheme } from "@/theme"\n`,
    }
    expect(usedPackageRoots(files)).toEqual(new Set(["@expo/vector-icons", "expo-router", "expo-symbols"]))
  })

  it("ignores non-code files", () => {
    expect(usedPackageRoots({ "data/seed.json": `{"x": "expo-location"}` })).toEqual(new Set())
  })

  it("infers expo-symbols from NativeTabs, since its md icons need it natively with no JS import", () => {
    const files = { "app/(tabs)/_layout.tsx": `import { NativeTabs } from "expo-router/native-tabs"\n` }
    expect(usedPackageRoots(files)).toEqual(new Set(["expo-router", "expo-symbols"]))
  })
})

describe("pruneProject", () => {
  it("drops optional packages and their plugins when nothing imports them", () => {
    const files = { "package.json": BASE_PACKAGE_JSON, "app.json": BASE_APP_JSON, "app/home.tsx": `import { View } from "react-native"\n` }
    const pruned = pruneProject(files)
    const pkg = JSON.parse(pruned["package.json"])
    expect(pkg.dependencies).toEqual({ expo: "~58.0.25", react: "19.3.0", "react-native-reanimated": "4.7.1" })
    const app = JSON.parse(pruned["app.json"])
    expect(app.expo.plugins).toEqual(["expo-router", "expo-font"])
  })

  it("keeps expo-symbols when a tab layout uses NativeTabs, with no plugin needed", () => {
    const files = {
      "package.json": BASE_PACKAGE_JSON.replace('"expo-linking": "~58.0.17"', '"expo-linking": "~58.0.17", "expo-symbols": "~58.0.5"'),
      "app.json": BASE_APP_JSON,
      "app/(tabs)/_layout.tsx": `import { NativeTabs } from "expo-router/native-tabs"\n<NativeTabs.Trigger.Icon sf={{ default: "house" }} md="home" />\n`,
    }
    const pruned = pruneProject(files)
    const pkg = JSON.parse(pruned["package.json"])
    expect(pkg.dependencies["expo-symbols"]).toBe("~58.0.5")
  })

  it("keeps a package and its plugin when a screen imports it", () => {
    const files = {
      "package.json": BASE_PACKAGE_JSON,
      "app.json": BASE_APP_JSON,
      "app/scan.tsx": `import * as Location from "expo-location"\n`,
    }
    const pruned = pruneProject(files)
    const pkg = JSON.parse(pruned["package.json"])
    expect(pkg.dependencies["expo-location"]).toBe("~58.0.22")
    const app = JSON.parse(pruned["app.json"])
    expect(app.expo.plugins).toContain("expo-location")
  })

  it("leaves core/platform packages alone even though nothing imports them directly", () => {
    const files = { "package.json": BASE_PACKAGE_JSON, "app.json": BASE_APP_JSON, "app/home.tsx": `import { View } from "react-native"\n` }
    const pruned = pruneProject(files)
    const pkg = JSON.parse(pruned["package.json"])
    expect(pkg.dependencies["react-native-reanimated"]).toBe("4.7.1")
  })

  it("computes usage from a separate `usage` file set (screens tracked apart from platform files)", () => {
    const files = { "package.json": BASE_PACKAGE_JSON, "app.json": BASE_APP_JSON }
    const usage = { "app/profile.tsx": `import * as LocalAuthentication from "expo-local-authentication"\n` }
    const pruned = pruneProject(files, usage)
    const pkg = JSON.parse(pruned["package.json"])
    expect(pkg.dependencies["expo-local-authentication"]).toBe("~58.0.3")
    expect(pkg.dependencies["expo-notifications"]).toBeUndefined()
  })

  it("is a no-op when package.json/app.json are absent", () => {
    const files = { "app/home.tsx": `import { View } from "react-native"\n` }
    expect(pruneProject(files)).toEqual(files)
  })

  it("leaves malformed package.json untouched instead of throwing", () => {
    const files = { "package.json": "not json", "app/home.tsx": "" }
    expect(pruneProject(files)["package.json"]).toBe("not json")
  })

  it("drops axios/react-query once a disconnect leaves nothing importing them", () => {
    const connected = JSON.stringify({ dependencies: { react: "19.3.0", axios: "^1.21.1", "@tanstack/react-query": "^5.108.0" } })
    const files = { "package.json": connected, "stores/useTasksStore.ts": `import { create } from "zustand"\n` }
    const pruned = pruneProject(files)
    expect(JSON.parse(pruned["package.json"]).dependencies).toEqual({ react: "19.3.0" })
  })

  it("keeps axios/react-query while lib/api.ts (or a screen) still imports them", () => {
    const connected = JSON.stringify({ dependencies: { react: "19.3.0", axios: "^1.21.1", "@tanstack/react-query": "^5.108.0" } })
    const files = { "package.json": connected, "lib/api.ts": `import axios from "axios"\nimport { useQuery } from "@tanstack/react-query"\n` }
    const pruned = pruneProject(files)
    const deps = JSON.parse(pruned["package.json"]).dependencies
    expect(deps.axios).toBeTruthy()
    expect(deps["@tanstack/react-query"]).toBeTruthy()
  })
})
