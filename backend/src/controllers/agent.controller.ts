import type { Request, Response, NextFunction } from "express"
import { Readable } from "node:stream"
import {
  handleAgentAction,
  handleCanvasEdits,
  handleJobWorker,
  handleRepairFile,
  handleThemeSwitch,
} from "../services/agent/agent.service"
import { EDITABLE_STYLE_KEYS } from "../services/verify/codemod"
import type { ElementEdit } from "@app/shared/preview/protocol"

const styleOf = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.length <= 200 && EDITABLE_STYLE_KEYS.has(k)) {
      out[k] = val
    }
  }
  return Object.keys(out).length ? out : undefined
}

export async function postAgent(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const controller = new AbortController()
    req.on("close", () => controller.abort())

    const result = await handleAgentAction(req.user!.id, projectId, req.body || {}, controller.signal)
    if (result.type === "json") {
      res.status(result.status).json(result.body)
      return
    }

    res.status(result.response.status)
    for (const [key, value] of result.response.headers.entries()) {
      res.setHeader(key, value)
    }

    if (result.response.body) {
      const nodeStream = Readable.fromWeb(result.response.body as import("node:stream/web").ReadableStream)
      nodeStream.pipe(res)
      req.on("close", () => {
        nodeStream.destroy()
      })
    } else {
      res.end()
    }
  } catch (err) {
    next(err)
  }
}

export async function postJobWorker(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    const result = await handleJobWorker(raw, req.headers)
    res.status(result.status).json(result.body)
  } catch (err) {
    next(err)
  }
}

const MAX_CANVAS_EDITS = 100

/** One element's edit from the request body, or null when it's malformed or changes nothing. */
function elementEditOf(v: unknown): ElementEdit | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const body = v as Record<string, unknown>
  const eid = typeof body.eid === "string" ? body.eid : ""
  if (!eid) return null
  const text = typeof body.text === "string" ? body.text : undefined
  const style = styleOf(body.style)
  const imageSrc = typeof body.imageSrc === "string" && body.imageSrc.length <= 4096 ? body.imageSrc : undefined
  if (text === undefined && !style && !imageSrc) return null
  const from = typeof body.from === "string" ? body.from : undefined
  return { eid, text, from, style, imageSrc }
}

export async function canvasEdit(req: Request, res: Response, next: NextFunction) {
  try {
    const raw: unknown = req.body?.edits
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CANVAS_EDITS) {
      res.status(400).json({ error: "Bad request" })
      return
    }
    const edits: ElementEdit[] = []
    for (const v of raw) {
      const edit = elementEditOf(v)
      if (!edit) {
        res.status(400).json({ error: "Bad request" })
        return
      }
      edits.push(edit)
    }

    const controller = new AbortController()
    req.on("close", () => controller.abort())

    const projectId = String(req.params.projectId || "")
    const result = await handleCanvasEdits(req.user!.id, projectId, edits, controller.signal)
    res.status(result.status).json(result.body)
  } catch (err) {
    next(err)
  }
}

export async function theme(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const themeId = String(req.body?.themeId || "")
    if (!themeId) {
      res.status(400).json({ error: "Bad request" })
      return
    }

    const result = await handleThemeSwitch(req.user!.id, projectId, themeId)
    res.status(result.status).json(result.body)
  } catch (err) {
    next(err)
  }
}

export async function repair(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const path = String(req.body?.path || "")
    const message = String(req.body?.message || "").slice(0, 1000)
    if (!path || !message || path.includes("..")) {
      res.status(400).json({ error: "Bad request" })
      return
    }

    const result = await handleRepairFile(req.user!.id, projectId, path, message)
    res.status(result.status).json(result.body)
  } catch (err) {
    next(err)
  }
}

