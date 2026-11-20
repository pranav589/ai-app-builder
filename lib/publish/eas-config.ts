import type { BuildFormat, BuildPlatform } from "@/db"

export type AppIdentity = {
  androidPackage: string
  iosBundleId: string
  easProjectId?: string | null
  expoOwner?: string | null
}

export function profileName(
  platform: BuildPlatform,
  format: BuildFormat
): "production-aab" | "production-apk" | "production-ipa" {
  if (platform === "android" && format === "aab") return "production-aab"
  if (platform === "android" && format === "apk") return "production-apk"
  if (platform === "ios" && format === "ipa") return "production-ipa"
  throw new Error(`Invalid platform/format combination: ${platform}/${format}`)
}

export function buildEasJson(): string {
  const easConfig = {
    cli: {
      version: ">= 15.0.0",
      appVersionSource: "remote",
    },
    build: {
      "production-aab": {
        autoIncrement: true,
        // The generated project never commits a package-lock.json, and EAS Build
        // defaults to an immutable install (`npm ci`) that fails outright on a
        // missing/out-of-sync lockfile. Disable that enforcement so it falls back
        // to a normal `npm install`.
        env: { EAS_NO_FROZEN_LOCKFILE: "1" },
        android: {
          buildType: "app-bundle",
        },
      },
      "production-apk": {
        autoIncrement: true,
        env: { EAS_NO_FROZEN_LOCKFILE: "1" },
        android: {
          buildType: "apk",
        },
      },
      "production-ipa": {
        autoIncrement: true,
        env: { EAS_NO_FROZEN_LOCKFILE: "1" },
        ios: {
          buildConfiguration: "Release",
        },
      },
    },
  }
  return JSON.stringify(easConfig, null, 2) + "\n"
}

export function patchAppJsonForPublish(
  appJsonText: string,
  identity: AppIdentity,
  version: string
): string {
  let doc: Record<string, unknown> = {}
  try {
    if (appJsonText.trim()) {
      doc = JSON.parse(appJsonText) as Record<string, unknown>
    }
  } catch {
    doc = {}
  }

  const rawExpo = doc.expo && typeof doc.expo === "object" ? (doc.expo as Record<string, unknown>) : {}
  const rawAndroid = rawExpo.android && typeof rawExpo.android === "object" ? (rawExpo.android as Record<string, unknown>) : {}
  const rawIos = rawExpo.ios && typeof rawExpo.ios === "object" ? (rawExpo.ios as Record<string, unknown>) : {}
  const rawExtra = rawExpo.extra && typeof rawExpo.extra === "object" ? (rawExpo.extra as Record<string, unknown>) : {}
  const rawEas = rawExtra.eas && typeof rawExtra.eas === "object" ? (rawExtra.eas as Record<string, unknown>) : {}

  const extra: Record<string, unknown> = {
    ...rawExtra,
  }

  if (identity.easProjectId) {
    extra.eas = {
      ...rawEas,
      projectId: identity.easProjectId,
    }
  }

  const expo: Record<string, unknown> = {
    ...rawExpo,
    version,
    android: {
      ...rawAndroid,
      package: identity.androidPackage,
    },
    ios: {
      ...rawIos,
      bundleIdentifier: identity.iosBundleId,
    },
    extra,
  }

  if (identity.expoOwner) {
    expo.owner = identity.expoOwner
  }

  doc.expo = expo
  return JSON.stringify(doc, null, 2) + "\n"
}

export function buildWorkflowYaml(): string {
  return `name: EAS Build

on:
  workflow_dispatch:
    inputs:
      build_id:
        description: "Internal build ID"
        required: true
        type: string
      platform:
        description: "Target platform (android or ios)"
        required: true
        type: string
      format:
        description: "Output format (aab, apk, or ipa)"
        required: true
        type: string
      profile:
        description: "EAS build profile"
        required: true
        type: string

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup Expo and EAS
        uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: \${{ secrets.EXPO_TOKEN }}
          packager: npm

      - name: Install dependencies
        run: npm install --legacy-peer-deps

      - name: Commit regenerated lockfile if out of sync
        # EAS Build runs "npm ci", which fails if package-lock.json doesn't exactly match
        # package.json. We never commit a lockfile ourselves, so make sure the one npm just
        # generated above is pushed back before eas build runs, so EAS always sees one in sync.
        run: |
          if ! git diff --quiet -- package-lock.json; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add package-lock.json
            git commit -m "chore: sync package-lock.json for EAS build [skip ci]"
            git push origin HEAD:\${{ github.ref_name }}
          else
            echo "package-lock.json already in sync"
          fi

      - name: Initialize EAS project
        run: |
          eas whoami || true
          eas init --non-interactive --force 2>&1 || true

      - name: Run EAS Build
        id: eas-build
        continue-on-error: true
        run: |
          eas build --platform \${{ inputs.platform }} --profile \${{ inputs.profile }} --non-interactive --wait --json | tee result.json

      - name: Report build result
        if: always()
        env:
          PUBLISH_WEBHOOK_SECRET: \${{ secrets.PUBLISH_WEBHOOK_SECRET }}
          BUILD_ID: \${{ inputs.build_id }}
          PLATFORM: \${{ inputs.platform }}
          FORMAT: \${{ inputs.format }}
          PROFILE: \${{ inputs.profile }}
          GITHUB_SERVER_URL: \${{ github.server_url }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          GITHUB_RUN_ID: \${{ github.run_id }}
        run: node .github/scripts/report-build.js
`
}

export function buildReportScript(opts: { webhookUrl: string }): string {
  return `const fs = require("node:fs")
const crypto = require("node:crypto")

const WEBHOOK_URL = ${JSON.stringify(opts.webhookUrl)}

function extractJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {}

  // Look for JSON array or object in output
  const arrayStart = text.indexOf("[")
  const arrayEnd = text.lastIndexOf("]")
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1))
    } catch {}
  }

  const objStart = text.indexOf("{")
  const objEnd = text.lastIndexOf("}")
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(text.slice(objStart, objEnd + 1))
    } catch {}
  }

  return null
}

async function main() {
  const buildId = process.env.BUILD_ID
  const secret = process.env.PUBLISH_WEBHOOK_SECRET
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com"
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID

  const workflowRunUrl = repo && runId ? \`\${serverUrl}/\${repo}/actions/runs/\${runId}\` : null

  let rawOutput = ""
  try {
    if (fs.existsSync("result.json")) {
      rawOutput = fs.readFileSync("result.json", "utf8")
    }
  } catch (e) {
    console.error("Failed to read result.json:", e)
  }

  const parsed = extractJson(rawOutput)
  const buildData = Array.isArray(parsed) ? parsed[0] : parsed

  let status = "failed"
  let easBuildId = null
  let artifactUrl = null
  let error = null
  let needsIosCredentials = 0

  if (buildData && typeof buildData === "object") {
    easBuildId = buildData.id || null
    const easStatus = String(buildData.status || "").toLowerCase()
    if (easStatus === "finished" || easStatus === "ready") {
      status = "ready"
    } else {
      status = "failed"
    }

    if (buildData.artifacts) {
      artifactUrl = buildData.artifacts.buildUrl || buildData.artifacts.applicationArchiveUrl || null
    }

    if (buildData.error) {
      if (typeof buildData.error === "string") {
        error = buildData.error
      } else if (typeof buildData.error.message === "string") {
        error = buildData.error.message
      } else if (Array.isArray(buildData.error.errors) && buildData.error.errors[0]?.message) {
        error = buildData.error.errors[0].message
      } else {
        error = "EAS build failed. Check the workflow run log for details."
      }
    }
  }

  if (status === "failed" && !error) {
    // Don't surface raw CLI/log output here - it can contain signed artifact/log URLs
    // and reads as noise. Full detail is still available via the "View build log" link.
    error = "EAS build failed. Check the workflow run log for details."
  }

  // Check for iOS credentials missing
  const combinedError = (error || "") + " " + rawOutput
  if (
    /apple.*credential|credential.*missing|provisioning profile|distribution certificate|apple team|not configured.*credentials/i.test(
      combinedError
    )
  ) {
    needsIosCredentials = 1
  }

  // Read app.json for any newly assigned easProjectId or expoOwner from eas init
  let easProjectId = null
  let expoOwner = null
  try {
    if (fs.existsSync("app.json")) {
      const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"))
      if (appJson && appJson.expo) {
        if (appJson.expo.owner) expoOwner = appJson.expo.owner
        if (appJson.expo.extra && appJson.expo.extra.eas && appJson.expo.extra.eas.projectId) {
          easProjectId = appJson.expo.extra.eas.projectId
        }
      }
    }
  } catch (e) {
    console.error("Failed to read app.json:", e)
  }

  const payload = {
    buildId,
    status,
    easBuildId,
    artifactUrl,
    error: status === "failed" ? error : null,
    needsIosCredentials,
    workflowRunUrl,
    easProjectId,
    expoOwner,
  }

  const bodyStr = JSON.stringify(payload)
  console.log("Reporting build result:", bodyStr)

  if (!secret) {
    console.error("PUBLISH_WEBHOOK_SECRET is not set in environment!")
    process.exit(1)
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac("sha256", secret).update(\`\${timestamp}.\${bodyStr}\`).digest("hex")
  const signature = \`t=\${timestamp},v1=\${hmac}\`

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-publish-signature": signature,
      },
      body: bodyStr,
    })
    console.log(\`Webhook response: \${res.status} \${res.statusText}\`)
    const resText = await res.text()
    console.log("Response text:", resText)
  } catch (e) {
    console.error("Failed to post build report:", e)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal error in report script:", e)
  process.exit(1)
})
`
}
