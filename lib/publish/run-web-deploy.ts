import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { buildExportFileMap } from "@/lib/app-project/zip-export"
import { workspaceFromDoc } from "@/lib/verify/workspace"
import { ensureAppIdentity } from "./app-identity"
import { dispatchProjectWorkflow } from "./dispatch"
import { buildEasJson } from "./eas-config"
import {
  buildWebDeployReportScript,
  buildWebDeployWorkflowYaml,
  patchAppJsonForWebDeploy,
} from "./eas-web-config"
import { markWebDispatched, markWebFailed } from "./web-deploy"

export type RunWebDeployOptions = {
  projectId: string
  runId: string
  userId: string
  projectName: string
  previewScreens: unknown
  expoToken: string
  githubToken: string
  repoOwner: string
  repoName: string
}

export async function runWebDeploy(opts: RunWebDeployOptions): Promise<void> {
  const {
    projectId,
    runId,
    userId,
    projectName,
    previewScreens,
    expoToken,
    githubToken,
    repoOwner,
    repoName,
  } = opts

  try {
    const doc = readAppDoc(previewScreens)
    const { files } = workspaceFromDoc(doc)
    const appJsonText = files["app.json"] || ""

    const identity = await ensureAppIdentity(projectId, appJsonText)

    const exportFiles = await buildExportFileMap(projectId, projectName, files)
    exportFiles["app.json"] = patchAppJsonForWebDeploy(
      exportFiles["app.json"] || appJsonText,
      identity
    )
    exportFiles["eas.json"] = buildEasJson()
    exportFiles[".github/workflows/eas-web-deploy.yml"] = buildWebDeployWorkflowYaml()

    // Reuses PUBLISH_WEBHOOK_URL's host (e.g. a Cloudflare/ngrok tunnel in local dev) so the web
    // deploy webhook stays reachable without needing a second tunnel URL configured separately.
    const webhookUrl =
      process.env.PUBLISH_WEB_WEBHOOK_URL ||
      (process.env.PUBLISH_WEBHOOK_URL
        ? process.env.PUBLISH_WEBHOOK_URL.replace(/\/api\/publish\/webhook\/?$/, "/api/publish/web-webhook")
        : process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/publish/web-webhook`
        : "http://localhost:3000/api/publish/web-webhook")
    exportFiles[".github/scripts/report-web-deploy.js"] = buildWebDeployReportScript({ webhookUrl })

    const [linked] = await db
      .select()
      .from(projectGithubLinks)
      .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
      .limit(1)

    const commitMsg = "Publish Web App (EAS Hosting)"

    await dispatchProjectWorkflow({
      githubToken,
      expoToken,
      repoOwner,
      repoName,
      linked,
      exportFiles,
      commitMessage: commitMsg,
      workflowFileName: "eas-web-deploy.yml",
      workflowInputs: {
        project_id: projectId,
        run_id: runId,
      },
      onDispatched: (info) => markWebDispatched(projectId, runId, info),
      onFailed: (error) => markWebFailed(projectId, runId, error),
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await markWebFailed(projectId, runId, error)
    throw err
  }
}
