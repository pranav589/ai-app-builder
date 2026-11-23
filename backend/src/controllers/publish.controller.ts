import type { Request, Response, NextFunction } from "express"
import {
  forgetExpoUserConnection,
  getExpoUserStatus,
  getWebDeploymentStatus,
  handlePublishWebhookEvent,
  handleWebWebhookEvent,
  listBuilds,
  retryBuild,
  saveExpoUserToken,
  startProjectBuild,
  stopBuild,
  stopWebDeployment,
  triggerWebDeployment,
} from "../services/publish/publish.service"
import { ExpoConnectError } from "../services/publish/expo-connect"

export async function expoStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getExpoUserStatus(req.user?.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function expoConnect(req: Request, res: Response, next: NextFunction) {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : ""
    if (!token) {
      res.status(400).json({ error: "missing_token", message: "Expo token is required." })
      return
    }

    const { username } = await saveExpoUserToken(req.user!.id, token)
    res.json({ ok: true, username })
  } catch (err) {
    if (err instanceof ExpoConnectError) {
      res.status(400).json({ error: err.code, message: err.message })
      return
    }
    next(err)
  }
}

export async function expoDisconnect(req: Request, res: Response, next: NextFunction) {
  try {
    await forgetExpoUserConnection(req.user!.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function publishNative(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await startProjectBuild(req.user!.id, projectId, req.body)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function listProjectBuilds(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await listBuilds(req.user!.id, projectId)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function retryProjectBuild(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const buildId = String(req.params.buildId || "")
    const result = await retryBuild(req.user!.id, projectId, buildId)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getWebDeploy(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await getWebDeploymentStatus(req.user!.id, projectId)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function triggerWebDeploy(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await triggerWebDeployment(req.user!.id, projectId)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    const sigHeader = String(req.headers["x-publish-signature"] || "")
    const result = await handlePublishWebhookEvent(raw, sigHeader)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function webWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    const sigHeader = String(req.headers["x-publish-signature"] || "")
    const result = await handleWebWebhookEvent(raw, sigHeader)
    res.json(result)
  } catch (err) {
    next(err)
  }
}


export async function stopProjectBuild(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stopBuild(String(req.params.projectId || ""), String(req.params.buildId || "")))
  } catch (err) {
    next(err)
  }
}

export async function stopWebDeploy(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stopWebDeployment(String(req.params.projectId || "")))
  } catch (err) {
    next(err)
  }
}
