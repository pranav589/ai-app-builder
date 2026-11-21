// A fixed-window counter per key, held in this process's memory. It's a cheap
// brake on a leaked app key being hammered, not a precise quota: each server
// instance counts on its own.

const windows = new Map<string, { start: number; count: number }>()

/** True when `key` has used up its `limit` calls for the current `windowMs`. */
export function overLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const w = windows.get(key)
  if (!w || now - w.start >= windowMs) {
    if (windows.size > 10_000) windows.clear()
    windows.set(key, { start: now, count: 1 })
    return false
  }
  w.count++
  return w.count > limit
}
