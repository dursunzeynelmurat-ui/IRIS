/**
 * IRIS Ingestion — Write Gate
 *
 * Single point of contact between the ingestion pipeline and the database.
 * All event writes go through the ingest_event RPC (migrations 011–014).
 * This function never writes directly to the events or event_updates tables.
 *
 * What ingest_event guarantees (DB-side):
 *   - Advisory-lock TOCTOU-safe dedup: case-insensitive title match within
 *     last 10 minutes (pg_advisory_xact_lock on hashtext(lower(title)))
 *   - Atomic insert: event row + all update rows in one transaction;
 *     no orphaned events on partial failure
 *   - Input validation: non-empty title, valid status, non-empty updates array,
 *     required fields on each update object (migrations 011–012)
 *   - Returns NULL for duplicates, event UUID for new events
 *
 * This function accepts only NormalizedEvent (post-normalization shape).
 * Raw adapter output must pass through normalize.ts first.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedEvent, IngestionResult } from './types';

export async function ingestEvent(
  client: SupabaseClient,
  payload: NormalizedEvent,
): Promise<IngestionResult> {
  const { title, status, updates } = payload;

  const { data: eventId, error } = await client.rpc('ingest_event', {
    p_title: title,
    p_status: status,
    p_updates: updates.map((u) => ({
      content: u.content,
      source_name: u.source_name,
      source_url: u.source_url ?? null,
    })),
  });

  if (error) {
    return { status: 'error', title, message: error.message };
  }

  if (eventId === null) {
    return { status: 'skipped', title, message: 'duplicate within 10 min' };
  }

  return { status: 'ok', title, eventId: eventId as string };
}
