const encoder = new TextEncoder()

export const sseHeaders = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const

export function sseEvent<T>(e: T): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(e)}\n\n`)
}
