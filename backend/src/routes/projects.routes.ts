import { Router } from "express"
import multer from "multer"
import { requireUser } from "../middleware/requireUser"
import { requireProjectOwner } from "../middleware/requireProjectOwner"
import { requireTrustedOrigin, requireTrustedOriginJson } from "../middleware/origin"
import * as projectsController from "../controllers/projects.controller"
import * as agentController from "../controllers/agent.controller"
import * as versionsController from "../controllers/versions.controller"
import * as backendController from "../controllers/backend.controller"
import * as deviceController from "../controllers/device.controller"
import * as githubController from "../controllers/github.controller"
import * as publishController from "../controllers/publish.controller"
import * as exportController from "../controllers/export.controller"
import * as projectEventsController from "../controllers/project-events.controller"

const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } })

export const projectsRouter = Router()

// Project lifecycle
projectsRouter.get("/", requireUser, projectsController.list)
projectsRouter.post("/", requireUser, requireTrustedOrigin, upload.array("assets"), projectsController.create)
projectsRouter.patch("/:projectId", requireUser, requireTrustedOriginJson, projectsController.rename)
projectsRouter.delete("/:projectId", requireUser, requireTrustedOrigin, projectsController.deleteProject)
projectsRouter.post("/:projectId/duplicate", requireUser, requireTrustedOrigin, projectsController.duplicate)
projectsRouter.patch("/:projectId/visibility", requireUser, requireTrustedOriginJson, projectsController.setVisibility)
projectsRouter.get("/:projectId/workspace", requireUser, projectsController.getWorkspace)
projectsRouter.get("/:projectId/export/zip", requireUser, exportController.exportZip)

// Agent
projectsRouter.post("/:projectId/agent", requireUser, requireTrustedOriginJson, agentController.postAgent)
projectsRouter.post("/:projectId/canvas-edit", requireUser, requireTrustedOriginJson, agentController.canvasEdit)
projectsRouter.patch("/:projectId/theme", requireUser, requireTrustedOriginJson, agentController.theme)
projectsRouter.post("/:projectId/repair", requireUser, requireTrustedOriginJson, agentController.repair)

// Versions
projectsRouter.get("/:projectId/versions", requireUser, versionsController.list)
projectsRouter.get("/:projectId/versions/:version/diff", requireUser, versionsController.diff)
projectsRouter.post("/:projectId/versions/:version/restore", requireUser, versionsController.restore)

// App backend (whichever provider it is on)
projectsRouter.get("/:projectId/backend", requireUser, requireProjectOwner, backendController.getBackend)
projectsRouter.delete("/:projectId/backend", requireUser, requireTrustedOriginJson, requireProjectOwner, backendController.deleteBackend)
projectsRouter.post("/:projectId/backend/data", requireUser, requireTrustedOriginJson, requireProjectOwner, backendController.postBackendData)

// Device preview
projectsRouter.get("/:projectId/device", requireUser, deviceController.getMetroLane)
projectsRouter.post("/:projectId/device", requireUser, requireTrustedOrigin, deviceController.postMetroLane)
projectsRouter.delete("/:projectId/device", requireUser, requireTrustedOrigin, deviceController.deleteMetroLane)
projectsRouter.get("/:projectId/device-build", requireUser, deviceController.getDeviceBuild)
projectsRouter.post("/:projectId/device-build", requireUser, requireTrustedOrigin, deviceController.postDeviceBuild)
projectsRouter.delete("/:projectId/device-build", requireUser, requireTrustedOrigin, deviceController.deleteDeviceBuild)

// Build / deploy status push (SSE)
projectsRouter.get("/:projectId/status-stream", requireUser, requireProjectOwner, projectEventsController.streamProjectStatus)

// GitHub
projectsRouter.get("/:projectId/github", requireUser, githubController.getLink)
projectsRouter.post("/:projectId/github/push", requireUser, requireTrustedOriginJson, githubController.push)

// Publish
projectsRouter.post("/:projectId/publish", requireUser, requireTrustedOriginJson, publishController.publishNative)
projectsRouter.get("/:projectId/builds", requireUser, publishController.listProjectBuilds)
projectsRouter.post("/:projectId/builds/:buildId/retry", requireUser, requireTrustedOriginJson, publishController.retryProjectBuild)
projectsRouter.post("/:projectId/builds/:buildId/stop", requireUser, requireTrustedOriginJson, requireProjectOwner, publishController.stopProjectBuild)
projectsRouter.get("/:projectId/publish/web", requireUser, publishController.getWebDeploy)
projectsRouter.post("/:projectId/publish/web", requireUser, requireTrustedOriginJson, publishController.triggerWebDeploy)
projectsRouter.delete("/:projectId/publish/web", requireUser, requireTrustedOrigin, requireProjectOwner, publishController.stopWebDeploy)
