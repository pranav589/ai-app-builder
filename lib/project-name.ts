// Turns the user's first prompt into a short, title-cased project name, e.g.
// "Build me a habit tracker with streaks and reminders" -> "Habit Tracker".
// A local heuristic for now; it can be swapped for a model call later without
// changing callers.

const MAX_WORDS = 5
const MAX_CHARS = 40
const FALLBACK = "Untitled App"

// Openers people type before describing the app itself.
const LEAD_IN =
  /^(?:(?:hey|hi|hello|please|pls|ok|okay|so|can you|could you|would you|will you|i want(?: you)? to|i'd like(?: you)? to|i would like(?: you)? to|i need(?: you)? to|help me|let's|lets|we need to|i want|i need)[\s,]+)*(?:(?:build|create|make|design|generate|develop|code|write|prototype)\s+(?:me\s+|us\s+|for me\s+)?)?(?:(?:an?|the|my|our|some|simple|basic)\s+)*/i

// Words that start a clause describing features rather than naming the app.
const CLAUSE_BREAK =
  /\s+(?:with|that|which|where|who|so|using|via|like|including|featuring|to|and|but|in|on|built)\s+|\s+-\s+|[,.;:!?()–—]/i

const GENERIC = new Set(["app", "application", "platform", "tool", "website", "site", "mobile", "ios", "android"])
const SMALL_WORDS = new Set(["for", "of", "and", "the", "a", "an", "to", "in", "on", "with"])
const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "can", "could", "will", "would", "should",
  "lets", "let", "users", "user", "people", "someone", "them", "it", "is", "are", "be",
  "a", "an", "the", "to", "of", "and", "for", "where", "that", "which", "who",
])

const ACRONYMS = new Set(["ai", "ar", "vr", "crm", "pdf", "qr", "gps", "nft", "api", "ui"])

function capitalize(part: string) {
  const lower = part.toLowerCase()
  if (ACRONYMS.has(lower)) return lower.toUpperCase()
  // Keep words the user already styled (e.g. "iPhone", "TikTok").
  if (/[A-Z]/.test(part.slice(1))) return part
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function titleCase(words: string[]) {
  return words
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.split("-").map(capitalize).join("-")
    )
    .join(" ")
}

const words = (s: string) => s.split(/\s+/).filter(Boolean)

export function generateProjectName(prompt: string): string {
  const firstLine =
    prompt
      .split(/\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  const cleaned = firstLine.replace(/["'`*_#>]/g, "").replace(/\s+/g, " ").trim()
  if (!cleaned) return FALLBACK

  const body = cleaned.replace(LEAD_IN, "")
  const [headRaw, ...restParts] = body.split(CLAUSE_BREAK)
  let head = words(headRaw ?? "")
  let maxWords = MAX_WORDS

  // "A marketplace for secondhand furniture": keep the short "for ..." phrase.
  const forMatch = /^(.+?)\s+for\s+(.+)$/i.exec(headRaw ?? "")
  if (forMatch) {
    const base = words(forMatch[1])
    const target = words(forMatch[2]).slice(0, 3)
    if (base.length + 1 + target.length <= MAX_WORDS + 1) {
      head = [...base, "for", ...target]
      maxWords = MAX_WORDS + 1
    } else head = base
  }

  // Only generic words left ("an app where I can track my plants"): name it
  // after the content words of the description instead.
  const meaningful = head.filter((w) => !GENERIC.has(w.toLowerCase()))
  if (meaningful.length === 0) {
    const rest = words(restParts.join(" ").replace(/[^\p{L}\p{N}\s]/gu, " "))
      .filter((w) => !STOP_WORDS.has(w.toLowerCase()) && !GENERIC.has(w.toLowerCase()))
      .slice(0, 3)
    head = rest.length ? [...rest, "App"] : []
  }

  if (head.length > maxWords) head = head.slice(-maxWords)
  let name = titleCase(head)
  if (name.length > MAX_CHARS) {
    const cut = name.slice(0, MAX_CHARS)
    name = cut.slice(0, Math.max(cut.lastIndexOf(" "), 12)).trim()
  }
  return name || FALLBACK
}
