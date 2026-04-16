/**
 * IRIS Ingestion — Shared Types
 *
 * Three distinct type layers, kept separate intentionally:
 *
 *   RawSourceItem   — what a source adapter produces (per-source shape)
 *   NormalizedEvent — the IRIS DB shape (what ingest_event expects)
 *   IngestionResult — outcome of a single write attempt
 *
 * Adapters own RawSourceItem. The normalization layer converts it to
 * NormalizedEvent. The write gate accepts only NormalizedEvent.
 * This separation means adapters can have different raw shapes without
 * bleeding source-specific logic into the write path.
 */

import type { EventStatus, UpdateType } from '../../src/types';

// ── Source layer ────────────────────────────────────────────────────────────
//
// RawSourceItem represents a single event as seen from ONE primary source,
// with optional additional coverage from other sources about the same event.
//
// Adapter responsibilities:
//   - Fetch or construct items from their source
//   - Provide headline, primary coverage (content + source_name), and status
//   - Optionally bundle coverage from additional sources
//   - Assign a status that reflects the event's confidence level;
//     'emerging' is the safe default when uncertain
//
// Adapters are NOT responsible for:
//   - Deduplication (ingest_event: advisory lock + 10-min window, migration 014)
//   - DB validation (ingest_event: full validation, migrations 011–012)
//   - Writing to the database (write gate: ingestEvent() in ingest.ts)

export interface RawSourceUpdate {
  content: string;
  source_name: string;
  source_url?: string;
  /** Optional UUID of a structured source in public.sources. */
  source_id?: string;
  /** Update classification for timeline rendering. Defaults to 'report'. */
  update_type?: UpdateType;
  /** Short bold headline for the update. */
  headline?: string;
}

export interface RawSourceItem {
  /** Main event title. Stored with trimmed original case. Dedup is case-insensitive. */
  headline: string;
  /** Event confidence level. 'emerging' is the safe default when uncertain. */
  status: EventStatus;
  /** Primary source content / summary. Becomes updates[0] after normalization. */
  content: string;
  /** Primary source name (e.g. "Reuters", "USGS"). Required. */
  source_name: string;
  /** Primary source URL. Optional. */
  source_url?: string;
  /** Optional UUID of a structured source in public.sources for the primary update. */
  source_id?: string;
  /** Classification for the primary update. Defaults to 'report'. */
  update_type?: UpdateType;
  /** Hero image URL for the event. */
  image_url?: string;
  /** Short contextual summary (1-3 sentences) for the event card. */
  summary?: string;
  /** Additional coverage from other sources. Become updates[1..] after normalization. */
  additional_updates?: RawSourceUpdate[];
}

// ── Normalized layer ────────────────────────────────────────────────────────
//
// NormalizedEvent is the IRIS event shape, matching the ingest_event RPC
// signature (migrations 011–014) exactly. This is the canonical form that
// exits the normalization layer and enters the write gate.
//
// Normalization decisions (see normalize.ts for details):
//   title   = headline, trimmed
//   status  = taken from adapter, validated against allowed set
//   updates = primary source → updates[0]; additional_updates → updates[1..]

export interface NormalizedUpdate {
  content: string;
  source_name: string;
  source_url?: string;
  /** Optional UUID of a structured source in public.sources. */
  source_id?: string;
  /** Update classification for timeline rendering. */
  update_type?: UpdateType;
  /** Short bold headline rendered above content in the timeline. */
  headline?: string;
}

export interface NormalizedEvent {
  title: string;
  status: EventStatus;
  updates: NormalizedUpdate[];
  /** Hero image URL for the event card and detail page. */
  image_url?: string;
  /** Short contextual summary (1-3 sentences). */
  summary?: string;
}

// ── Adapter interface ───────────────────────────────────────────────────────
//
// Any ingestion source adapter implements SourceAdapter.
// The runner calls fetchItems(), normalizes the results, and writes them.
//
// V1 adapters:
//   SampleAdapter  — hardcoded mock events for development / testing
//
// Future adapters (not yet implemented):
//   RSSAdapter     — fetches from an RSS/Atom feed URL
//   APIAdapter     — fetches from a JSON REST API
//   WebhookAdapter — receives pushes rather than polling

export interface SourceAdapter {
  /** Human-readable adapter name. Used in log output and --adapter= CLI flag. */
  readonly name: string;
  /** Fetch raw items from the source. May be async (HTTP, file I/O, etc.). */
  fetchItems(): Promise<RawSourceItem[]>;
}

// ── Ingestion result ────────────────────────────────────────────────────────

export type IngestionStatus = 'ok' | 'skipped' | 'error';

export interface IngestionResult {
  status: IngestionStatus;
  title: string;
  /** Present when status = 'ok'. The newly created event UUID. */
  eventId?: string;
  /** Present when status = 'skipped' or 'error'. Human-readable reason. */
  message?: string;
}
