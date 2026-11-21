import { and, eq } from "drizzle-orm"
import {
  db,
  projectGithubLinks,
  type BuildFormat,
  type BuildPlatform,
} from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { buildExportFileMap } from "@/lib/app-project/zip-export"
import { workspaceFromDoc } from "@/lib/verify/workspace"
import { ensureAppIdentity } from "./app-identity"
import { markDispatched, markFailed } from "./builds"
import { dispatchProjectWorkflow } from "./dispatch"
import {
  buildEasJson,
  buildReportScript,
  buildWorkflowYaml,
  patchAppJsonForPublish,
  profileName,
} from "./eas-config"

export type PublishBuildOptions = {
  projectId: string
  userId: string
  projectName: string
  previewScreens: unknown
  buildId: string
  platform: BuildPlatform
  format: BuildFormat
  version: string
  expoToken: string
  githubToken: string
  repoOwner: string
  repoName: string
}

export async function publishBuild(opts: PublishBuildOptions): Promise<void> {
  const {
    projectId,
    userId,
    projectName,
    previewScreens,
    buildId,
    platform,
    format,
    version,
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
    exportFiles["app.json"] = patchAppJsonForPublish(
      exportFiles["app.json"] || appJsonText,
      identity,
      version
    )
    exportFiles["eas.json"] = buildEasJson()
    exportFiles[".github/workflows/eas-build.yml"] = buildWorkflowYaml()

    const webhookUrl =
      process.env.PUBLISH_WEBHOOK_URL ||
      (process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/publish/webhook`
        : "http://localhost:3000/api/publish/webhook")
    exportFiles[".github/scripts/report-build.js"] = buildReportScript({ webhookUrl })

    const [linked] = await db
      .select()
      .from(projectGithubLinks)
      .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
      .limit(1)

    const profile = profileName(platform, format)
    const commitMsg = `Publish ${platform.toUpperCase()} ${format.toUpperCase()} v${version}`

    await dispatchProjectWorkflow({
      githubToken,
      expoToken,
      repoOwner,
      repoName,
      linked,
      exportFiles,
      commitMessage: commitMsg,
      workflowFileName: "eas-build.yml",
      workflowInputs: {
        build_id: buildId,
        platform,
        format,
        profile,
      },
      onDispatched: (info) => markDispatched(buildId, info),
      onFailed: (error) => markFailed(buildId, { error }),
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await markFailed(buildId, { error })
    throw err
  }
}
