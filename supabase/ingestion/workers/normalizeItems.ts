/**
 * IRIS Ingestion — Normalize Items Worker
 *
 * Picks up raw_source_items rows with fetch_status='raw', normalizes them,
 * and inserts rows into normalized_source_items. One ingestion_job is created
 * to track the batch.
 *
 * Usage:
 *   npx tsx supabase/ingestion/workers/normalizeItems.ts [--limit=N] [--dry-run]
 */

import { fileURLToPath } from 'url';
import { createIngestionClient } from '../client';
import { normalizeRawItem } from '../services/normalizer';
import { startJob, finishJob } from '../services/feedPoller';

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runNormalizeItems(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<void> {
  const limit = options?.limit ?? 100;
  const dryRun = options?.dryRun ?? false;

  const client = createIngestionClient();

  // Fetch the oldest un-normalized raw items.
  const { data: rawItems, error } = await client
    .from('raw_source_items')
    .select('id, raw_title')
    .eq('fetch_status', 'raw')
    .order('fetched_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[normalize] fetch raw items: ${error.message}`);
    return;
  }

  if (!rawItems || rawItems.length === 0) {
    console.log('[normalize] No raw items to process.');
    return;
  }

  console.log(
    `[normalize] Processing ${rawItems.length} item(s)${dryRun ? ' (dry-run)' : ''}`,
  );

  const jobId = await startJob(client, null, 'normalize');
  let normInserted = 0;
  let normSkipped = 0;
  let normError = 0;
  let jobError: string | undefined;

  for (const raw of rawItems as Array<{ id: string; raw_title: string | null }>) {
    if (dryRun) {
      console.log(`[normalize] dry-run: ${raw.raw_title?.slice(0, 60)}`);
      normSkipped++;
      continue;
    }

    try {
      const result = await normalizeRawItem(client, raw.id);
      if (result) {
        normInserted++;
        console.log(`[normalize] ok: ${raw.raw_title?.slice(0, 60)} → ${result.id.slice(0, 8)}`);
      } else {
        normSkipped++;
      }
    } catch (err) {
      normError++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[error] normalize ${raw.id}: ${msg}`);
      if (normError >= 5) {
        jobError = `Aborted after ${normError} errors. Last: ${msg}`;
        break;
      }
    }
  }

  await finishJob(client, jobId, {
    itemsFound: rawItems.length,
    itemsInserted: normInserted,
    itemsSkipped: normSkipped,
    error: jobError,
  });

  console.log(
    `[normalize] Done: inserted=${normInserted} skipped=${normSkipped} errors=${normError}`,
  );
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  runNormalizeItems({
    limit: limitArg ? parseInt(limitArg, 10) : undefined,
    dryRun,
  }).catch((err) => {
    console.error('[normalize] Fatal:', err);
    process.exit(1);
  });
}
