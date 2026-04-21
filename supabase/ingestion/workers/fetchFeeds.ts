/**
 * IRIS Ingestion — Fetch Feeds Worker
 *
 * Polls active source feeds, downloads their RSS/Atom XML, and inserts new
 * items into raw_source_items. One ingestion_job row is created per feed.
 *
 * Usage:
 *   npx tsx supabase/ingestion/workers/fetchFeeds.ts [--feed=<slug>] [--dry-run]
 */

import { createIngestionClient } from '../client';
import { parseFeed, fetchFeed } from '../lib/rss';
import { contentHash } from '../lib/hash';
import {
  getActiveFeeds,
  startJob,
  finishJob,
  updateFeedHealth,
  insertRawItem,
  type SourceFeed,
} from '../services/feedPoller';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Per-feed logic ────────────────────────────────────────────────────────────

async function fetchOneFeed(
  client: SupabaseClient,
  feed: SourceFeed,
  dryRun: boolean,
): Promise<{ found: number; inserted: number; skipped: number }> {
  const xml = await fetchFeed(feed.feed_url, 15_000);
  const parsed = parseFeed(xml);

  let found = 0;
  let inserted = 0;
  let skipped = 0;

  for (const item of parsed.items) {
    found++;

    const hash = contentHash([
      feed.feed_url,
      item.link ?? '',
      item.title ?? '',
    ]);

    if (dryRun) {
      console.log(`[fetch] dry-run item: ${item.title?.slice(0, 60)}`);
      skipped++;
      continue;
    }

    const result = await insertRawItem(client, {
      sourceFeedId: feed.id,
      externalId: item.guid ?? item.link ?? null,
      sourceUrl: item.link ?? null,
      rawTitle: item.title || null,
      rawSummary: item.summary || null,
      rawContent: item.content || item.summary || null,
      rawAuthor: item.author ?? null,
      rawPublishedAt: item.publishedAt,
      rawPayloadJson: {
        categories: item.categories,
        imageUrl: item.imageUrl,
      },
      contentHash: hash,
    });

    if (result.inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { found, inserted, skipped };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runFetchFeeds(options?: {
  feedSlug?: string;
  dryRun?: boolean;
}): Promise<void> {
  const dryRun = options?.dryRun ?? false;
  const client = createIngestionClient();

  let feeds: SourceFeed[];

  if (options?.feedSlug) {
    const { data, error } = await client
      .from('source_feeds')
      .select('*')
      .eq('slug', options.feedSlug)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      console.error(`[fetch] Feed not found: ${options.feedSlug}`);
      return;
    }
    feeds = [data as SourceFeed];
  } else {
    feeds = await getActiveFeeds(client);
  }

  if (feeds.length === 0) {
    console.log('[fetch] No feeds due for polling.');
    return;
  }

  console.log(`[fetch] Polling ${feeds.length} feed(s)${dryRun ? ' (dry-run)' : ''}`);

  for (const feed of feeds) {
    const jobId = await startJob(client, feed.id, 'feed_poll');
    let result = { found: 0, inserted: 0, skipped: 0 };
    let errorMessage: string | undefined;

    try {
      result = await fetchOneFeed(client, feed, dryRun);
      console.log(
        `[fetch] ${feed.name}: found=${result.found} inserted=${result.inserted} skipped=${result.skipped}`,
      );
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${feed.name}: ${errorMessage}`);
    }

    await finishJob(client, jobId, {
      itemsFound: result.found,
      itemsInserted: result.inserted,
      itemsSkipped: result.skipped,
      error: errorMessage,
    });
    await updateFeedHealth(client, feed.id, !errorMessage, errorMessage);
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const feedSlug = args.find((a) => a.startsWith('--feed='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  runFetchFeeds({ feedSlug, dryRun }).catch((err) => {
    console.error('[fetch] Fatal:', err);
    process.exit(1);
  });
}
