/**
 * IRIS Ingestion — Process Normalized Items Worker
 *
 * Takes normalized items that haven't been matched yet and either:
 *   a) Attaches them to an existing event (attach_item_to_event RPC), or
 *   b) Creates a new event from them (create_event_for_item RPC).
 *
 * Matching uses computeMatchScore from similarity.ts. All DB writes are done
 * inside Postgres RPCs that hold advisory locks for race safety.
 *
 * Usage:
 *   npx tsx supabase/ingestion/workers/processNormalized.ts [--limit=N] [--dry-run]
 */

import { fileURLToPath } from 'url';
import { createIngestionClient } from '../client';
import {
  getRecentCandidates,
  findBestMatch,
  MATCH_THRESHOLD,
} from '../services/matcher';
import { startJob, finishJob } from '../services/feedPoller';

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runProcessNormalized(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<void> {
  const limit = options?.limit ?? 50;
  const dryRun = options?.dryRun ?? false;

  const client = createIngestionClient();

  // Fetch un-matched normalized items (oldest first).
  const { data: items, error } = await client
    .from('normalized_source_items')
    .select('id, normalized_title, normalized_summary, keywords_json, location_text, occurred_at_estimate, raw_source_item_id')
    .is('matched_event_id', null)
    .order('normalized_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[process] fetch normalized items: ${error.message}`);
    return;
  }

  if (!items || items.length === 0) {
    console.log('[process] No normalized items to process.');
    return;
  }

  console.log(
    `[process] Processing ${items.length} item(s)${dryRun ? ' (dry-run)' : ''}`,
  );

  const jobId = await startJob(client, null, 'process');

  // Load candidate events once for the whole batch (avoids N+1 queries).
  const candidates = await getRecentCandidates(client);
  console.log(`[process] Loaded ${candidates.length} candidate events`);

  let matched = 0;
  let created = 0;
  let skipped = 0;
  let errCount = 0;
  let jobError: string | undefined;

  type NormItem = {
    id: string;
    normalized_title: string | null;
    normalized_summary: string | null;
    keywords_json: string[] | null;
    location_text: string | null;
    occurred_at_estimate: string | null;
    raw_source_item_id: string;
  };

  for (const item of items as NormItem[]) {
    if (!item.normalized_title) {
      skipped++;
      continue;
    }

    const title = item.normalized_title;
    const summary = item.normalized_summary ?? null;
    const keywords = item.keywords_json ?? [];
    const occurredAt = item.occurred_at_estimate
      ? new Date(item.occurred_at_estimate)
      : null;

    // Determine source_feed_id by joining through raw_source_items.
    const { data: rawRow } = await client
      .from('raw_source_items')
      .select('source_feed_id')
      .eq('id', item.raw_source_item_id)
      .single();

    const sourceFeedId = (rawRow as { source_feed_id: string } | null)?.source_feed_id ?? null;

    if (dryRun) {
      const match = findBestMatch(title, summary, keywords, item.location_text, occurredAt, candidates);
      if (match) {
        console.log(
          `[process] dry-run match: "${title.slice(0, 50)}" → event ${match.eventId.slice(0, 8)} (score=${match.score})`,
        );
        matched++;
      } else {
        console.log(`[process] dry-run new-event: "${title.slice(0, 50)}"`);
        created++;
      }
      continue;
    }

    try {
      const match = findBestMatch(
        title,
        summary,
        keywords,
        item.location_text,
        occurredAt,
        candidates,
      );

      if (match && match.score >= MATCH_THRESHOLD) {
        // Attach to existing event.
        const { error: attachErr } = await client.rpc('attach_item_to_event', {
          p_normalized_item_id: item.id,
          p_event_id: match.eventId,
          p_match_score: match.score,
          p_source_feed_id: sourceFeedId,
        });

        if (attachErr) {
          console.error(`[error] attach_item_to_event ${item.id}: ${attachErr.message}`);
          errCount++;
        } else {
          console.log(
            `[match] "${title.slice(0, 50)}" → event ${match.eventId.slice(0, 8)} (score=${match.score})`,
          );
          matched++;
        }
      } else {
        // Create a new event.
        const { data: newEventId, error: createErr } = await client.rpc(
          'create_event_for_item',
          {
            p_normalized_item_id: item.id,
            p_source_feed_id: sourceFeedId,
          },
        );

        if (createErr) {
          console.error(`[error] create_event_for_item ${item.id}: ${createErr.message}`);
          errCount++;
        } else {
          console.log(
            `[new-event] "${title.slice(0, 50)}" → event ${String(newEventId).slice(0, 8)}`,
          );
          created++;
        }
      }
    } catch (err) {
      errCount++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[error] process item ${item.id}: ${msg}`);
      if (errCount >= 5) {
        jobError = `Aborted after ${errCount} errors. Last: ${msg}`;
        break;
      }
    }
  }

  await finishJob(client, jobId, {
    itemsFound: items.length,
    itemsInserted: matched + created,
    itemsSkipped: skipped,
    error: jobError,
  });

  console.log(
    `[process] Done: matched=${matched} created=${created} skipped=${skipped} errors=${errCount}`,
  );
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  runProcessNormalized({
    limit: limitArg ? parseInt(limitArg, 10) : undefined,
    dryRun,
  }).catch((err) => {
    console.error('[process] Fatal:', err);
    process.exit(1);
  });
}
