/**
 * IRIS Ingestion — Text Cleaning & Normalisation Utilities
 *
 * Pure string-processing helpers. No external dependencies — regex and
 * built-in string methods only. Safe to call with any untrusted feed content.
 */

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Common English stopwords used by inferLanguage. */
const EN_STOPWORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
  'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this',
  'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or',
  'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'is', 'are',
  'was', 'were', 'been', 'has', 'had', 'its',
];

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Remove all HTML tags from `html` using regex, collapse internal whitespace,
 * and return a trimmed plain-text string.
 *
 * Note: This is a best-effort stripping approach. It handles the common RSS
 * feed shapes (escaped or CDATA-wrapped HTML snippets). For a full DOM parse
 * an external library would be required; none is available in this project.
 *
 * @param html - String that may contain HTML markup.
 * @returns Plain text with tags removed and whitespace normalised.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode common HTML entities into their corresponding characters.
 *
 * Handles named entities: `&amp;` `&lt;` `&gt;` `&quot;` `&#39;` `&nbsp;` `&apos;`
 * Handles decimal numeric entities: `&#NNN;`
 * Handles hex numeric entities: `&#xHH;`
 *
 * @param text - Text that may contain HTML entities.
 * @returns Text with entities decoded.
 */
export function decodeEntities(text: string): string {
  return text
    // Named entities
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    // Hex numeric entities: &#xHH; or &#XHH;
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    // Decimal numeric entities: &#NNN;
    .replace(/&#([0-9]+);/gi, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
}

/**
 * Full text cleaning pipeline: strip HTML → decode entities → normalise
 * whitespace → trim → cap at 2 000 characters.
 *
 * @param text - Raw text or HTML string.
 * @returns Clean plain text, at most 2 000 characters.
 */
export function cleanText(text: string): string {
  const cleaned = decodeEntities(stripHtml(text))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 2000);
}

/**
 * Truncate `text` to at most `maxChars` characters at a word boundary, then
 * append `suffix`. If the text is already short enough the original string is
 * returned unchanged.
 *
 * @param text     - Text to truncate.
 * @param maxChars - Maximum character length of the result *before* the suffix.
 * @param suffix   - String appended when truncation occurs (default: `…`).
 * @returns Truncated string.
 */
export function truncate(text: string, maxChars: number, suffix = '…'): string {
  if (text.length <= maxChars) return text;

  // Walk back from maxChars to find a word boundary (space or start).
  let cutAt = maxChars;
  while (cutAt > 0 && text[cutAt] !== ' ') {
    cutAt--;
  }
  // If no space was found at all, hard-cut at maxChars.
  if (cutAt === 0) cutAt = maxChars;

  return text.slice(0, cutAt).trimEnd() + suffix;
}

/**
 * Extract the first `count` sentences from `text`.
 *
 * Sentence boundaries are detected after `. `, `! `, or `? ` (i.e. the
 * terminator must be followed by a space so abbreviations like "U.S. forces"
 * are less likely to split incorrectly).
 *
 * @param text  - Plain text to extract from.
 * @param count - Number of sentences to return.
 * @returns The first `count` sentences joined with a single space.
 */
export function extractFirstSentences(text: string, count: number): string {
  if (count <= 0) return '';

  // Split on sentence-ending punctuation followed by a space.
  // We keep the terminator by using a lookbehind.
  const sentences = text.split(/(?<=[.!?]) /).slice(0, count);
  return sentences.join(' ');
}

/**
 * Normalise a news article title:
 *   1. Run through `cleanText`
 *   2. Collapse internal whitespace
 *   3. Strip common source suffixes: ` | Source`, ` - Source`, ` — Source`
 *      at the end of the string.
 *
 * @param title - Raw title string (may contain entities or light markup).
 * @returns Clean, source-attribution-free title.
 */
export function normalizeTitle(title: string): string {
  const cleaned = cleanText(title).replace(/\s+/g, ' ').trim();
  // Remove trailing " | Anything", " - Anything", " — Anything"
  return cleaned.replace(/\s+[|\-—]\s+[^|\-—]+$/, '').trim();
}

/**
 * Heuristic language detection. Checks the first 100 words for common English
 * stopwords. If at least 3 are found the text is classified as English.
 *
 * This is intentionally lightweight — it avoids any heavy n-gram model while
 * still correctly identifying the vast majority of English-language feeds.
 *
 * @param text - Plain text to classify.
 * @returns `'en'` if the text appears to be English, `'unknown'` otherwise.
 */
export function inferLanguage(text: string): 'en' | 'unknown' {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 100);

  const wordSet = new Set(words);
  let hits = 0;
  for (const stopword of EN_STOPWORDS) {
    if (wordSet.has(stopword)) {
      hits++;
      if (hits >= 3) return 'en';
    }
  }
  return 'unknown';
}
