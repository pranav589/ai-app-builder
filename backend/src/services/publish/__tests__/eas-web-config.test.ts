import { describe, expect, it } from "vitest"
import {
  buildWebDeployReportScript,
  buildWebDeployWorkflowYaml,
  patchAppJsonForWebDeploy,
} from "../eas-web-config"

describe("eas-web-config", () => {
  describe("patchAppJsonForWebDeploy", () => {
    it("patches android package, ios bundle ID, eas project ID, and expo owner without modifying version", () => {
      const originalAppJson = JSON.stringify({
        expo: {
          name: "My App",
          slug: "my-app",
          version: "1.2.3",
          customField: "keep-me",
          android: {
            package: "old.package",
            adaptiveIcon: { backgroundColor: "#fff" },
          },
          ios: {
            bundleIdentifier: "old.bundle",
            supportsTablet: true,
          },
        },
      })

      const identity = {
        androidPackage: "com.test.webapp",
        iosBundleId: "com.test.webapp",
        easProjectId: "eas-proj-web-456",
        expoOwner: "my-web-org",
      }

      const patched = patchAppJsonForWebDeploy(originalAppJson, identity)
      const result = JSON.parse(patched)

      expect(result.expo.name).toBe("My App")
      expect(result.expo.customField).toBe("keep-me")
      // Crucial: version remains untouched, unlike native publish
      expect(result.expo.version).toBe("1.2.3")
      expect(result.expo.owner).toBe("my-web-org")
      expect(result.expo.android.package).toBe("com.test.webapp")
      expect(result.expo.android.adaptiveIcon.backgroundColor).toBe("#fff")
      expect(result.expo.ios.bundleIdentifier).toBe("com.test.webapp")
      expect(result.expo.ios.supportsTablet).toBe(true)
      expect(result.expo.extra.eas.projectId).toBe("eas-proj-web-456")
    })

    it("handles empty or malformed app.json safely without crashing", () => {
      const identity = {
        androidPackage: "com.fallback.app",
        iosBundleId: "com.fallback.app",
      }

      const patched = patchAppJsonForWebDeploy("", identity)
      const result = JSON.parse(patched)

      expect(result.expo.android.package).toBe("com.fallback.app")
      expect(result.expo.ios.bundleIdentifier).toBe("com.fallback.app")
      expect(result.expo.version).toBeUndefined()
    })
  })

  describe("buildWebDeployWorkflowYaml", () => {
    it("generates a valid workflow YAML with workflow_dispatch and proper EAS commands", () => {
      const yaml = buildWebDeployWorkflowYaml()

      expect(yaml).toContain("name: EAS Web Deploy")
      expect(yaml).toContain("workflow_dispatch:")
      expect(yaml).toContain("project_id:")
      expect(yaml).toContain("npx expo export -p web")
      expect(yaml).toContain("node .github/scripts/report-web-deploy.js --ping")
      expect(yaml).toContain("eas deploy --non-interactive --prod --json | tee deploy-result.json")
      expect(yaml).toContain("node .github/scripts/report-web-deploy.js")
    })
  })

  describe("buildWebDeployReportScript", () => {
    it("embeds the provided webhook URL and contains reporting logic", () => {
      const script = buildWebDeployReportScript({
        webhookUrl: "https://myapp.com/api/publish/web-webhook",
      })

      expect(script).toContain("https://myapp.com/api/publish/web-webhook")
      expect(script).toContain("findDeployUrl")
      expect(script).toContain("extractJson")
      expect(script).toContain("x-publish-signature")
      expect(script).toContain("isPing")
    })
  })
})
