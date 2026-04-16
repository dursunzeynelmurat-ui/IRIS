/**
 * IRIS Ingestion — Text Similarity & Event Matching
 *
 * Completely deterministic similarity functions used to score whether two
 * incoming items represent the same real-world event. No ML, no external
 * dependencies.
 */

// ── Stopwords (mirrored from hash.ts to keep files self-contained) ───────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to',
  'of', 'for', 'and', 'or', 'but', 'with', 'has', 'have', 'had', 'by',
  'from', 'that', 'this', 'which', 'who', 'be', 'been', 'being', 'it', 'its',
]);

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Tokenise `text` into a deduplicated list of lowercase, punctuation-free
 * words, excluding stopwords.
 *
 * @param text - Any plain text string.
 * @returns Array of unique non-empty tokens.
 */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));

  return [...new Set(words)];
}

/**
 * Compute the Jaccard similarity between two text strings.
 *
 * Both strings are tokenised before comparison.
 * `|intersection| / |union|`
 *
 * @param a - First text string.
 * @param b - Second text string.
 * @returns Similarity score in the range `[0.0, 1.0]`. Returns `0` when both
 *          tokenised sets are empty.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 && setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Measure keyword overlap between two keyword arrays.
 *
 * `|shared keywords| / max(|A|, |B|)`
 *
 * Comparison is case-insensitive.
 *
 * @param keywordsA - Keyword list for item A.
 * @param keywordsB - Keyword list for item B.
 * @returns Overlap score in the range `[0.0, 1.0]`. Returns `0` when both
 *          arrays are empty.
 */
export function keywordOverlap(keywordsA: string[], keywordsB: string[]): number {
  const maxLen = Math.max(keywordsA.length, keywordsB.length);
  if (maxLen === 0) return 0;

  const setB = new Set(keywordsB.map((k) => k.toLowerCase()));
  let shared = 0;
  for (const kw of keywordsA) {
    if (setB.has(kw.toLowerCase())) shared++;
  }

  return shared / maxLen;
}

/**
 * Score how well two location strings match.
 *
 * - `1.0` — both present and equal (case-insensitive)
 * - `0.5` — one location string contains the other (case-insensitive)
 * - `0.0` — no match, or either value is `null`
 *
 * @param locA - Location for item A, or `null`.
 * @param locB - Location for item B, or `null`.
 * @returns Match score: `0.0`, `0.5`, or `1.0`.
 */
export function locationMatch(locA: string | null, locB: string | null): number {
  if (locA === null || locB === null) return 0;

  const a = locA.toLowerCase().trim();
  const b = locB.toLowerCase().trim();

  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.5;
  return 0;
}

/** Parameters for {@link computeMatchScore}. */
export interface MatchScoreParams {
  titleA: string;
  titleB: string;
  summaryA?: string;
  summaryB?: string;
  keywordsA?: string[];
  keywordsB?: string[];
  locationA?: string | null;
  locationB?: string | null;
  /** Absolute time difference between the two items in hours. */
  hoursApart: number;
}

/**
 * Compute a 0–100 composite match score indicating how likely two items are
 * to represent the same real-world event.
 *
 * **Weighted formula:**
 * ```
 * title   × 0.40
 * summary × 0.20  (falls back to titleScore when summaries are unavailable)
 * keyword × 0.20  (falls back to 50 when keywords are unavailable)
 * location× 0.10
 * time    × 0.10  (100 − hoursApart × 4, floored at 0; zero score at 25 h+)
 * ```
 *
 * @param params - Scoring parameters (see {@link MatchScoreParams}).
 * @returns Integer score in the range `[0, 100]`.
 */
export function computeMatchScore(params: MatchScoreParams): number {
  const {
    titleA,
    titleB,
    summaryA,
    summaryB,
    keywordsA,
    keywordsB,
    locationA = null,
    locationB = null,
    hoursApart,
  } = params;

  const titleScore = jaccardSimilarity(titleA, titleB) * 100;

  const summaryScore =
    summaryA != null && summaryB != null
      ? jaccardSimilarity(summaryA, summaryB) * 100
      : titleScore;

  const kwScore =
    keywordsA != null && keywordsB != null
      ? keywordOverlap(keywordsA, keywordsB) * 100
      : 50;

  const locScore = locationMatch(locationA, locationB) * 100;

  const timeScore = Math.max(0, 100 - hoursApart * 4);

  const weighted =
    titleScore   * 0.40 +
    summaryScore * 0.20 +
    kwScore      * 0.20 +
    locScore     * 0.10 +
    timeScore    * 0.10;

  return Math.round(weighted);
}
