import type { AppIdentity } from "./eas-config"

export function patchAppJsonForWebDeploy(
  appJsonText: string,
  identity: AppIdentity
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
  const rawAndroid =
    rawExpo.android && typeof rawExpo.android === "object" ? (rawExpo.android as Record<string, unknown>) : {}
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

export function buildWebDeployWorkflowYaml(): string {
  return `name: EAS Web Deploy

on:
  workflow_dispatch:
    inputs:
      project_id:
        description: "Internal project ID"
        required: true
        type: string
      run_id:
        description: "Internal web-deploy run ID"
        required: true
        type: string

jobs:
  deploy:
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

      - name: Report building stage
        env:
          PUBLISH_WEBHOOK_SECRET: \${{ secrets.PUBLISH_WEBHOOK_SECRET }}
          PROJECT_ID: \${{ inputs.project_id }}
          RUN_ID: \${{ inputs.run_id }}
          STAGE: building
        run: node .github/scripts/report-web-deploy.js --ping

      - name: Install dependencies
        run: npm install --legacy-peer-deps

      - name: Commit regenerated lockfile if out of sync
        run: |
          if ! git diff --quiet -- package-lock.json; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add package-lock.json
            git commit -m "chore: sync package-lock.json for EAS web deploy [skip ci]"
            git push origin HEAD:\${{ github.ref_name }}
          else
            echo "package-lock.json already in sync"
          fi

      - name: Initialize EAS project
        run: |
          eas whoami || true
          eas init --non-interactive --force 2>&1 || true

      - name: Export web bundle
        id: expo-export
        continue-on-error: true
        run: |
          npx expo export -p web

      - name: Report deploying stage
        if: steps.expo-export.outcome == 'success'
        env:
          PUBLISH_WEBHOOK_SECRET: \${{ secrets.PUBLISH_WEBHOOK_SECRET }}
          PROJECT_ID: \${{ inputs.project_id }}
          RUN_ID: \${{ inputs.run_id }}
          STAGE: deploying
        run: node .github/scripts/report-web-deploy.js --ping

      - name: Run EAS Deploy
        id: eas-deploy
        if: steps.expo-export.outcome == 'success'
        continue-on-error: true
        run: |
          eas deploy --non-interactive --prod --json | tee deploy-result.json

      - name: Report deploy result
        if: always()
        env:
          PUBLISH_WEBHOOK_SECRET: \${{ secrets.PUBLISH_WEBHOOK_SECRET }}
          PROJECT_ID: \${{ inputs.project_id }}
          RUN_ID: \${{ inputs.run_id }}
          EXPORT_OUTCOME: \${{ steps.expo-export.outcome }}
          DEPLOY_OUTCOME: \${{ steps.eas-deploy.outcome }}
          GITHUB_SERVER_URL: \${{ github.server_url }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          GITHUB_RUN_ID: \${{ github.run_id }}
        run: node .github/scripts/report-web-deploy.js
`
}

export function buildWebDeployReportScript(opts: { webhookUrl: string }): string {
  return `const fs = require("node:fs")
const crypto = require("node:crypto")

const WEBHOOK_URL = ${JSON.stringify(opts.webhookUrl)}

function extractJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {}

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

function findDeployUrl(obj) {
  if (!obj) return null
  if (typeof obj === "string") {
    if (obj.startsWith("http://") || obj.startsWith("https://")) return obj
    return null
  }
  if (typeof obj !== "object") return null

  if (typeof obj.url === "string" && obj.url.startsWith("http")) return obj.url
  if (obj.deployment && typeof obj.deployment.url === "string" && obj.deployment.url.startsWith("http")) {
    return obj.deployment.url
  }
  if (typeof obj.deployUrl === "string" && obj.deployUrl.startsWith("http")) return obj.deployUrl
  if (typeof obj.webUrl === "string" && obj.webUrl.startsWith("http")) return obj.webUrl
  if (typeof obj.productionUrl === "string" && obj.productionUrl.startsWith("http")) return obj.productionUrl

  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /url/i.test(k) && (v.startsWith("http://") || v.startsWith("https://"))) {
      return v
    }
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findDeployUrl(v)
      if (found) return found
    }
  }
  return null
}

async function postPayload(bodyStr, secret) {
  const timestamp = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac("sha256", secret).update(\`\${timestamp}.\${bodyStr}\`).digest("hex")
  const signature = \`t=\${timestamp},v1=\${hmac}\`

  // Retried a few times: a dropped webhook call (e.g. a brief tunnel hiccup in local dev) must
  // not leave the deployment row stuck in a non-terminal status forever.
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
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
      if (!res.ok) throw new Error(\`Webhook returned \${res.status}\`)
      return
    } catch (e) {
      lastErr = e
      console.error(\`Webhook POST attempt \${attempt + 1} failed:\`, e)
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastErr
}

async function main() {
  const projectId = process.env.PROJECT_ID
  const runId = process.env.RUN_ID
  const secret = process.env.PUBLISH_WEBHOOK_SECRET

  if (!projectId) {
    console.error("PROJECT_ID is not set in environment!")
    process.exit(1)
  }

  if (!runId) {
    console.error("RUN_ID is not set in environment!")
    process.exit(1)
  }

  if (!secret) {
    console.error("PUBLISH_WEBHOOK_SECRET is not set in environment!")
    process.exit(1)
  }

  // Handle mid-workflow ping if requested
  const isPing = process.argv.includes("--ping") || Boolean(process.env.STAGE)
  if (isPing) {
    const stage = process.env.STAGE || "deploying"
    console.log(\`Sending mid-workflow ping (stage: \${stage})...\`)
    const pingPayload = { projectId, runId, stage }
    await postPayload(JSON.stringify(pingPayload), secret)
    return
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com"
  const repo = process.env.GITHUB_REPOSITORY
  const githubRunId = process.env.GITHUB_RUN_ID
  const workflowRunUrl = repo && githubRunId ? \`\${serverUrl}/\${repo}/actions/runs/\${githubRunId}\` : null

  const exportOutcome = process.env.EXPORT_OUTCOME
  const deployOutcome = process.env.DEPLOY_OUTCOME

  let rawOutput = ""
  try {
    if (fs.existsSync("deploy-result.json")) {
      rawOutput = fs.readFileSync("deploy-result.json", "utf8")
    }
  } catch (e) {
    console.error("Failed to read deploy-result.json:", e)
  }

  const parsed = extractJson(rawOutput)
  const deployData = Array.isArray(parsed) ? parsed[0] : parsed

  let status = "failed"
  let url = findDeployUrl(deployData)
  let error = null

  if (!url && rawOutput) {
    const match = rawOutput.match(/https:\\/\\/[a-zA-Z0-9-.]+\\.(expo\\.app|eas\\.app)/i)
    if (match) url = match[0]
  }

  if (exportOutcome && exportOutcome !== "success") {
    status = "failed"
    error = "Failed to export web bundle (npx expo export -p web failed). Check the workflow run log for details."
  } else if (deployOutcome && deployOutcome !== "success") {
    status = "failed"
    if (deployData && deployData.error) {
      error = typeof deployData.error === "string" ? deployData.error : (deployData.error.message || JSON.stringify(deployData.error))
    }
    if (!error) {
      error = "EAS deploy failed. Check the workflow run log for details."
    }
  } else if (url) {
    status = "ready"
  } else {
    status = "failed"
    error = "EAS deploy completed but no live URL was found in the output. Check the workflow run log for details."
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
    projectId,
    runId,
    status,
    url: status === "ready" ? url : null,
    error: status === "failed" ? error : null,
    easProjectId,
    expoOwner,
    workflowRunUrl,
  }

  const bodyStr = JSON.stringify(payload)
  console.log("Reporting deploy result:", bodyStr)

  await postPayload(bodyStr, secret)
}

main().catch((e) => {
  console.error("Fatal error in web deploy report script:", e)
  process.exit(1)
})
`
}
