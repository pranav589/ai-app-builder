import { describe, expect, it } from "vitest"
import {
  buildEasJson,
  buildReportScript,
  buildWorkflowYaml,
  patchAppJsonForPublish,
  profileName,
} from "../eas-config"

describe("eas-config", () => {
  describe("profileName", () => {
    it("maps android aab to production-aab", () => {
      expect(profileName("android", "aab")).toBe("production-aab")
    })

    it("maps android apk to production-apk", () => {
      expect(profileName("android", "apk")).toBe("production-apk")
    })

    it("maps ios ipa to production-ipa", () => {
      expect(profileName("ios", "ipa")).toBe("production-ipa")
    })

    it("throws on invalid platform/format combinations", () => {
      expect(() => profileName("android", "ipa" as any)).toThrow()
      expect(() => profileName("ios", "apk" as any)).toThrow()
      expect(() => profileName("ios", "aab" as any)).toThrow()
    })
  })

  describe("buildEasJson", () => {
    it("generates valid eas.json with all three profiles and appVersionSource remote", () => {
      const jsonStr = buildEasJson()
      const parsed = JSON.parse(jsonStr)

      expect(parsed.cli.appVersionSource).toBe("remote")
      expect(parsed.build["production-aab"].android.buildType).toBe("app-bundle")
      expect(parsed.build["production-apk"].android.buildType).toBe("apk")
      expect(parsed.build["production-ipa"].ios.buildConfiguration).toBe("Release")
    })
  })

  describe("patchAppJsonForPublish", () => {
    it("overwrites version, android.package, ios.bundleIdentifier, leaving AI fields intact", () => {
      const originalAppJson = JSON.stringify({
        expo: {
          name: "My App",
          slug: "my-app",
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
        androidPackage: "com.anything.myapp",
        iosBundleId: "com.anything.myapp",
        easProjectId: "eas-proj-123",
        expoOwner: "my-org",
      }

      const patched = patchAppJsonForPublish(originalAppJson, identity, "2.1.0")
      const result = JSON.parse(patched)

      expect(result.expo.name).toBe("My App")
      expect(result.expo.customField).toBe("keep-me")
      expect(result.expo.version).toBe("2.1.0")
      expect(result.expo.owner).toBe("my-org")
      expect(result.expo.android.package).toBe("com.anything.myapp")
      expect(result.expo.android.adaptiveIcon.backgroundColor).toBe("#fff")
      expect(result.expo.ios.bundleIdentifier).toBe("com.anything.myapp")
      expect(result.expo.ios.supportsTablet).toBe(true)
      expect(result.expo.extra.eas.projectId).toBe("eas-proj-123")
    })

    it("handles empty or malformed app.json gracefully", () => {
      const identity = {
        androidPackage: "com.anything.myapp",
        iosBundleId: "com.anything.myapp",
      }

      const patched = patchAppJsonForPublish("", identity, "1.0.0")
      const result = JSON.parse(patched)

      expect(result.expo.version).toBe("1.0.0")
      expect(result.expo.android.package).toBe("com.anything.myapp")
      expect(result.expo.ios.bundleIdentifier).toBe("com.anything.myapp")
    })
  })

  describe("buildWorkflowYaml", () => {
    it("includes workflow_dispatch, eas-version, and continue-on-error", () => {
      const yaml = buildWorkflowYaml()
      expect(yaml).toContain("workflow_dispatch:")
      expect(yaml).toContain("build_id:")
      expect(yaml).toContain("expo/expo-github-action@v8")
      expect(yaml).toContain("secrets.EXPO_TOKEN")
      expect(yaml).toContain("continue-on-error: true")
      expect(yaml).toContain("if: always()")
      expect(yaml).toContain(".github/scripts/report-build.js")
    })
  })

  describe("buildReportScript", () => {
    it("bakes in the webhook URL", () => {
      const script = buildReportScript({ webhookUrl: "https://example.com/api/publish/webhook" })
      expect(script).toContain("https://example.com/api/publish/webhook")
      expect(script).toContain("x-publish-signature")
      expect(script).toContain("PUBLISH_WEBHOOK_SECRET")
    })
  })
})
