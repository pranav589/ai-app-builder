import type { Request, Response, NextFunction } from "express"
import {
  getDeviceBuildStatus,
  getMetroLaneStatus,
  getPublicDeviceManifest,
  startMetroLane,
  stopMetroLane,
  triggerDeviceBuild,
} from "../services/device/device.service"
import type { DeviceManifestPlatform } from "../services/device/manifest"

function parsePlatform(req: Request): DeviceManifestPlatform {
  const header = String(req.headers["expo-platform"] || req.headers["exponent-platform"] || "").toLowerCase()
  return header === "ios" ? "ios" : "android"
}

export async function getMetroLane(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const status = await getMetroLaneStatus(req.user!.id, projectId)
    if (!status) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(status)
  } catch (err) {
    next(err)
  }
}

export async function postMetroLane(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await startMetroLane(req.user!.id, projectId)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function deleteMetroLane(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await stopMetroLane(req.user!.id, projectId)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getDeviceBuild(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const host = req.headers.host
    const status = await getDeviceBuildStatus(req.user!.id, projectId, host)
    if (!status) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(status)
  } catch (err) {
    next(err)
  }
}

export async function postDeviceBuild(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await triggerDeviceBuild(req.user!.id, projectId, req.headers.host)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getManifest(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const platform = parsePlatform(req)
    const manifest = await getPublicDeviceManifest(projectId, platform)
    if (!manifest) {
      res.status(404).send("Not found.")
      return
    }

    res.setHeader("expo-protocol-version", "0")
    res.setHeader("expo-sfv-version", "0")
    res.setHeader("cache-control", "private, max-age=0")
    res.setHeader("content-type", manifest.contentType)
    res.send(Buffer.from(manifest.body))
  } catch (err) {
    next(err)
  }
}

