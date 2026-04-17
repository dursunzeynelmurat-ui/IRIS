/**
 * IRIS Ingestion — Feed Poller Service
 *
 * Manages polling state for source_feeds: job creation/completion,
 * health score tracking, and raw item insertion with dedup logic.
 *
 * All functions accept an explicit SupabaseClient so they can be used in
 * workers that create their own client instance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface SourceFeed {
  id: string;
  name: string;
  slug: string;
  feed_url: string;
  source_type: string;
  parser_type: string;
  reliability_tier: string;
  credibility_score: number;
  poll_interval_seconds: number;
  is_active: boolean;
  health_score: number;
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
}

export interface PollResult {
  feedId: string;
  feedName: string;
  jobId: string;
  itemsFound: number;
  itemsInserted: number;
  itemsSkipped: number;
  error?: string;
}

export interface RawItemInsert {
  sourceFeedId: string;
  externalId: string | null;
  sourceUrl: string | null;
  rawTitle: string | null;
  rawSummary: string | null;
  rawContent: string | null;
  rawAuthor: string | null;
  rawPublishedAt: Date | null;
  rawPayloadJson: Record<string, unknown>;
  contentHash: string;
}

// ── Feed queries ─────────────────────────────────────────────────────────────

/**
 * Return active feeds that are due to be polled.
 *
 * A feed is due when:
 *   - last_fetched_at IS NULL (never fetched), OR
 *   - last_fetched_at < NOW() - poll_interval_seconds
 *
 * Feeds with health_score < 30 are skipped (too many recent failures).
 */
export async function getActiveFeeds(client: SupabaseClient): Promise<SourceFeed[]> {
  // Supabase does not support interval arithmetic in the JS client, so we
  // fetch all active healthy feeds and filter due ones in JavaScript.
  const { data, error } = await client
    .from('source_feeds')
    .select('*')
    .eq('is_active', true)
    .gte('health_score', 30)
    .order('last_fetched_at', { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`[feedPoller] getActiveFeeds: ${error.message}`);
  }

  const now = Date.now();
  return (data as SourceFeed[]).filter((feed) => {
    if (!feed.last_fetched_at) return true;
    const lastFetched = new Date(feed.last_fetched_at).getTime();
    const intervalMs = feed.poll_interval_seconds * 1000;
    return now - lastFetched >= intervalMs;
  });
}

// ── Job management ───────────────────────────────────────────────────────────

/**
 * Create an ingestion_job row with status='running' and return its id.
 */
export async function startJob(
  client: SupabaseClient,
  feedId: string | null,
  jobType: 'feed_poll' | 'normalize' | 'process' | 'full_pipeline',
): Promise<string> {
  const { data, error } = await client
    .from('ingestion_jobs')
    .insert({
      job_type: jobType,
      source_feed_id: feedId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`[feedPoller] startJob: ${error?.message ?? 'no id returned'}`);
  }

  return (data as { id: string }).id;
}

/**
 * Mark an ingestion_job as done (or failed) with result counts.
 */
export async function finishJob(
  client: SupabaseClient,
  jobId: string,
  result: {
    itemsFound: number;
    itemsInserted: number;
    itemsSkipped: number;
    error?: string;
  },
): Promise<void> {
  const { error } = await client
    .from('ingestion_jobs')
    .update({
      status: result.error ? 'failed' : 'done',
      finished_at: new Date().toISOString(),
      items_found: result.itemsFound,
      items_inserted: result.itemsInserted,
      items_skipped: result.itemsSkipped,
      error_message: result.error ?? null,
    })
    .eq('id', jobId);

  if (error) {
    // Non-fatal: log but don't throw — the job itself may have succeeded.
    console.error(`[feedPoller] finishJob ${jobId}: ${error.message}`);
  }
}

// ── Feed health tracking ─────────────────────────────────────────────────────

/**
 * Update health score and fetch timestamps for a feed.
 *
 * Success: health += 10 (capped at 100), last_fetched_at + last_success_at = NOW().
 * Failure: health -= 20 (floored at 0), last_fetched_at + last_error_at = NOW(),
 *          last_error_message set.
 */
export async function updateFeedHealth(
  client: SupabaseClient,
  feedId: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  // Use a single RPC call to atomically update health_score on the DB side,
  // avoiding the read-then-write race when two workers run concurrently.
  const now = new Date().toISOString();

  const { error } = await client.rpc('update_feed_health', {
    p_feed_id: feedId,
    p_success: success,
    p_error_message: errorMessage ?? null,
    p_now: now,
  });

  if (error) {
    // update_feed_health RPC may not exist yet (migration 035 adds it).
    // Fall back to a simple non-atomic update so older DB versions still work.
    const updates: Record<string, unknown> = {
      last_fetched_at: now,
    };
    if (success) {
      updates.last_success_at = now;
    } else {
      updates.last_error_at = now;
      updates.last_error_message = errorMessage ?? 'unknown error';
    }
    // Clamp within DB: LEAST/GREATEST not available in JS client, use raw SQL via rpc fallback.
    const { error: fallbackErr } = await client
      .from('source_feeds')
      .update(updates)
      .eq('id', feedId);

    if (fallbackErr) {
      console.error(`[feedPoller] updateFeedHealth ${feedId}: ${fallbackErr.message}`);
    }
  }
}

// ── Raw item insertion ────────────────────────────────────────────────────────

/**
 * Insert a single raw item, handling dedup at two levels:
 *   1. (source_feed_id, external_id) unique constraint — same guid from same feed
 *   2. content_hash — same story verbatim across any feed
 *
 * Returns `{ inserted: true, id }` on success, `{ inserted: false, id: null }` for
 * any duplicate.
 */
export async function insertRawItem(
  client: SupabaseClient,
  item: RawItemInsert,
): Promise<{ inserted: boolean; id: string | null }> {
  // Fast path: check content_hash dedup before hitting the insert constraint.
  if (item.contentHash) {
    const { data: existing } = await client
      .from('raw_source_items')
      .select('id')
      .eq('content_hash', item.contentHash)
      .maybeSingle();

    if (existing) {
      return { inserted: false, id: null };
    }
  }

  const { data, error } = await client
    .from('raw_source_items')
    .insert({
      source_feed_id: item.sourceFeedId,
      external_id: item.externalId,
      source_url: item.sourceUrl,
      raw_title: item.rawTitle,
      raw_summary: item.rawSummary,
      raw_content: item.rawContent,
      raw_author: item.rawAuthor,
      raw_published_at: item.rawPublishedAt?.toISOString() ?? null,
      raw_payload_json: item.rawPayloadJson,
      content_hash: item.contentHash,
      fetch_status: 'raw',
    })
    .select('id')
    .single();

  if (error) {
    // Unique constraint violation → duplicate
    if (error.code === '23505') {
      return { inserted: false, id: null };
    }
    throw new Error(`[feedPoller] insertRawItem: ${error.message}`);
  }

  return { inserted: true, id: (data as { id: string }).id };
}
