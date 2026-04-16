/**
 * IRIS Ingestion — Content Hashing & Deduplication Signatures
 *
 * Deterministic utilities for detecting duplicate raw items and clustering
 * items that represent the same underlying story. No external dependencies —
 * uses Node's built-in `crypto` module only.
 */

import { createHash } from 'crypto';

// Stopwords excluded when building a deduplication signature.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to',
  'of', 'for', 'and', 'or', 'but', 'with', 'has', 'have', 'had', 'by',
  'from', 'that', 'this', 'which', 'who', 'be', 'been', 'being', 'it', 'its',
]);

/**
 * Generate a short deterministic SHA-256 hash over an ordered list of string
 * parts. Parts are joined with `|`, lowercased, and then hashed; only the
 * first 32 hex characters are returned.
 *
 * Typical usage: `contentHash([url, title])` to detect exact-duplicate items
 * arriving from the same feed.
 *
 * @param parts - Ordered list of strings that together identify the item.
 * @returns 32-character lowercase hex string.
 */
export function contentHash(parts: string[]): string {
  const input = parts.join('|').toLowerCase();
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Normalise a title into a canonical, order-independent signature suitable
 * for fuzzy deduplication clustering.
 *
 * Steps:
 *   1. Lowercase
 *   2. Strip all non-alphanumeric characters (spaces are preserved)
 *   3. Split on whitespace into words
 *   4. Remove stopwords
 *   5. Sort remaining words alphabetically
 *   6. Join with `-`
 *
 * Two titles that differ only in stopwords, word order, or minor punctuation
 * will produce the same signature, making them cluster together as the same
 * story.
 *
 * @param title - Raw title string.
 * @returns Canonical hyphen-joined signature, or empty string for blank input.
 */
export function dedupeSignature(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));

  words.sort();
  return words.join('-');
}
