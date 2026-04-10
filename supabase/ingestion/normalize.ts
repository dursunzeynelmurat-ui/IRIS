/**
 * IRIS Ingestion — Normalization Layer
 *
 * Converts a RawSourceItem (adapter output) into a NormalizedEvent (IRIS
 * ingest_event shape). This layer enforces data quality before the write gate.
 *
 * Normalization decisions:
 *
 *   TITLE:
 *     Source: raw.headline, trimmed of leading/trailing whitespace.
 *     Case:   preserved (dedup comparison is case-insensitive in ingest_event
 *             via lower(title) — migration 014).
 *
 *   STATUS:
 *     Source: raw.status, taken directly from the adapter.
 *     Adapters are responsible for assigning a meaningful status.
 *     'emerging' is the safe default when the adapter is uncertain.
 *     Allowed values: emerging | developing | verified | disputed.
 *     Normalization rejects any other value with NormalizationError.
 *
 *   UPDATES:
 *     updates[0]: primary source — { content, source_name, source_url? }
 *     updates[1..]: raw.additional_updates, in order.
 *     Each update's content and source_name are trimmed.
 *     At least one update is always produced (from the primary source).
 *
 * What counts as one event vs. one update:
 *   An event = a distinct real-world situation (one headline, one status).
 *   An update = one source's coverage of that event.
 *   Multiple news agencies reporting the same event → one event, N updates.
 *   A follow-on development (e.g., rescue operation after a flood) → separate
 *   event or additional update depending on whether the situation changed.
 *   V1 adapters make this judgment. There is no automated clustering.
 *
 * The DB function ingest_event performs its own input validation
 * (migrations 011–012), so normalization is a pre-flight safety layer,
 * not the sole authoritative validator.
 */

import type { RawSourceItem, NormalizedEvent, NormalizedUpdate } from './types';

const VALID_STATUSES = new Set(['emerging', 'developing', 'verified', 'disputed']);

export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
  }
}

export function normalizeSourceItem(raw: RawSourceItem): NormalizedEvent {
  // ── Title ──────────────────────────────────────────────────────────────
  const title = raw.headline?.trim();
  if (!title) {
    throw new NormalizationError('headline is empty or missing');
  }

  // ── Status ─────────────────────────────────────────────────────────────
  if (!VALID_STATUSES.has(raw.status)) {
    throw new NormalizationError(
      `invalid status "${raw.status}". Valid: emerging, developing, verified, disputed`,
    );
  }

  // ── Primary update ─────────────────────────────────────────────────────
  const primaryContent = raw.content?.trim();
  const primarySourceName = raw.source_name?.trim();

  if (!primaryContent) {
    throw new NormalizationError('content is empty or missing');
  }
  if (!primarySourceName) {
    throw new NormalizationError('source_name is empty or missing');
  }

  const updates: NormalizedUpdate[] = [
    {
      content: primaryContent,
      source_name: primarySourceName,
      ...(raw.source_url ? { source_url: raw.source_url } : {}),
    },
  ];

  // ── Additional updates ─────────────────────────────────────────────────
  if (raw.additional_updates) {
    for (let i = 0; i < raw.additional_updates.length; i++) {
      const u = raw.additional_updates[i];
      const content = u.content?.trim();
      const source_name = u.source_name?.trim();

      if (!content) {
        throw new NormalizationError(
          `additional_updates[${i}].content is empty or missing`,
        );
      }
      if (!source_name) {
        throw new NormalizationError(
          `additional_updates[${i}].source_name is empty or missing`,
        );
      }

      updates.push({
        content,
        source_name,
        ...(u.source_url ? { source_url: u.source_url } : {}),
      });
    }
  }

  return {
    title,
    status: raw.status,
    updates,
  };
}
