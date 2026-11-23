import type { Request, Response } from "express"
import { subscribeToProject } from "../services/http/project-events"
import { sseEvent, sseHeaders } from "../services/http/sse"

/** Keeps proxies from closing a stream that has nothing to say for a while. */
const PING_MS = 15_000

export function streamProjectStatus(req: Request, res: Response) {
  res.writeHead(200, sseHeaders)
  const unsubscribe = subscribeToProject(req.project!.id, (e) => res.write(sseEvent(e)))
  const ping = setInterval(() => res.write(": ping\n\n"), PING_MS)
  req.on("close", () => {
    clearInterval(ping)
    unsubscribe()
  })
  // Opens the stream immediately so EventSource reports "open" without waiting for a change.
  res.write(": connected\n\n")
}
