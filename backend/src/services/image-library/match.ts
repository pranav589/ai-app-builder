import { and, sql } from "drizzle-orm"
import { db, imageLibrary } from "@/db"
import { isImageLibraryCategory } from "@app/shared/image-library/categories"

export const MIN_RANK_THRESHOLD = 0.05

export const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't",
  "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into",
  "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's",
  "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs",
  "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves"
])

/** Extracts meaningful search tokens from subject and collection label, stripped of stopwords and punctuation. */
export function tokenizeQuery(subject: string, collectionLabel: string): string[] {
  const combined = `${subject} ${collectionLabel}`.toLowerCase()
  const rawTokens = combined.match(/[a-z0-9]+/g) ?? []
  return Array.from(
    new Set(rawTokens.filter((t) => t.length > 1 && !STOPWORDS.has(t)))
  )
}

export type MatchedImage = {
  id: string
  url: string
}

/**
 * Searches the curated image library for an image matching the subject and
 * collection label. When `category` is one of IMAGE_LIBRARY_CATEGORIES, it
 * hard-filters to that category — otherwise a merely-popular word shared
 * across categories (a material, a color) can outrank the right subject
 * entirely (e.g. "leather" matching a watch instead of a shoe). Without a
 * category, at least 2 of the search tokens must actually appear in the
 * candidate's own text as a weaker safety net against single-word flukes.
 * Returns the highest-ranked unused image above MIN_RANK_THRESHOLD, or null
 * if no good match exists.
 */
export async function findLibraryImage(
  subject: string,
  collectionLabel: string,
  usedIds?: Set<string>,
  category?: string
): Promise<MatchedImage | null> {
  const tokens = tokenizeQuery(subject, collectionLabel)
  if (!tokens.length) return null

  const queryString = tokens.join(" OR ")
  const hardCategory = isImageLibraryCategory(category) ? category : undefined
  const minOverlap = hardCategory ? 1 : Math.min(2, tokens.length)

  try {
    const conditions = [sql`${imageLibrary.search} @@ websearch_to_tsquery('english', ${queryString})`]
    if (hardCategory) conditions.push(sql`${imageLibrary.category} = ${hardCategory}`)

    const candidates = await db
      .select({
        id: imageLibrary.id,
        url: imageLibrary.url,
        category: imageLibrary.category,
        tags: imageLibrary.tags,
        description: imageLibrary.description,
        rank: sql<number>`ts_rank(${imageLibrary.search}, websearch_to_tsquery('english', ${queryString}))`,
      })
      .from(imageLibrary)
      .where(and(...conditions))
      .orderBy(sql`ts_rank(${imageLibrary.search}, websearch_to_tsquery('english', ${queryString})) desc`)
      .limit(20)

    for (const c of candidates) {
      if (usedIds?.has(c.id) || Number(c.rank) < MIN_RANK_THRESHOLD) continue
      const haystack = `${c.category} ${(c.tags ?? []).join(" ")} ${c.description ?? ""}`.toLowerCase()
      const overlap = tokens.filter((t) => haystack.includes(t)).length
      if (overlap < minOverlap) continue
      usedIds?.add(c.id)
      return { id: c.id, url: c.url }
    }
  } catch (e) {
    console.warn("Image library lookup failed:", e instanceof Error ? e.message : e)
  }

  return null
}
