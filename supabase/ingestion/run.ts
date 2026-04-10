/**
 * IRIS Ingestion Runner
 *
 * Entrypoint for ingestion workers. Orchestrates the full pipeline:
 *   adapter.fetchItems() → normalizeSourceItem() → ingestEvent() → log
 *
 * Usage:
 *   npx tsx supabase/ingestion/run.ts [options]
 *
 * Options:
 *   --adapter=<name>   Adapter to use. Default: sample
 *                      Available: sample, fixture
 *   --fixture=<path>   Path to a JSON fixture file. Implies --adapter=fixture.
 *                      Relative paths are resolved from the current working directory.
 *                      Default (when --adapter=fixture): fixtures/example.json
 *   --dry-run          Normalize items and log what would be ingested.
 *                      Does NOT write to Supabase. Safe to run anytime.
 *   --limit=N          Process only the first N items from the adapter.
 *                      Useful for testing a new adapter with a small batch.
 *
 * Examples:
 *   # Dry run with default sample events — no DB writes
 *   npx tsx supabase/ingestion/run.ts --dry-run
 *
 *   # Dry run against the built-in example fixture
 *   npx tsx supabase/ingestion/run.ts --adapter=fixture --dry-run
 *
 *   # Dry run against a custom fixture file
 *   npx tsx supabase/ingestion/run.ts --fixture=./my_events.json --dry-run
 *
 *   # Ingest first 3 sample events
 *   npx tsx supabase/ingestion/run.ts --adapter=sample --limit=3
 *
 *   # Full live ingest from a custom fixture file
 *   npx tsx supabase/ingestion/run.ts --fixture=/path/to/events.json
 *
 * Requires in .env (not needed for --dry-run):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY   ← service_role key (bypasses RLS, authorized for ingest_event)
 *
 * Exit codes:
 *   0 — all items processed (ok or skipped)
 *   1 — one or more normalization or ingestion errors, or fatal failure
 */

import { createIngestionClient } from './client';
import { normalizeSourceItem, NormalizationError } from './normalize';
import { ingestEvent } from './ingest';
import { SampleAdapter } from './adapters/sample';
import { FixtureAdapter } from './adapters/fixture';
import type { SourceAdapter, IngestionResult } from './types';

// ── Adapter factory ─────────────────────────────────────────────────────────
//
// Creates the adapter for a given name. Called after CLI args are parsed so
// options like fixturePath can be forwarded to the constructor.
//
// Adding a new adapter:
//   1. Create adapters/<name>.ts implementing SourceAdapter
//   2. Add a case here
//   3. Add the name to KNOWN_ADAPTERS for the error message

const KNOWN_ADAPTERS = ['sample', 'fixture'] as const;

function makeAdapter(
  name: string,
  opts: { fixturePath?: string },
): SourceAdapter {
  switch (name) {
    case 'sample':
      return new SampleAdapter();
    case 'fixture':
      return new FixtureAdapter(opts.fixturePath);
    default: {
      console.error(
        `[run] Unknown adapter "${name}". Available: ${KNOWN_ADAPTERS.join(', ')}`,
      );
      process.exit(1);
    }
  }
}

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  adapterName: string;
  fixturePath?: string;
  dryRun: boolean;
  limit?: number;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let adapterName = 'sample';
  let fixturePath: string | undefined;
  let dryRun = false;
  let limit: number | undefined;

  for (const arg of args) {
    if (arg.startsWith('--adapter=')) {
      adapterName = arg.slice('--adapter='.length);
    } else if (arg.startsWith('--fixture=')) {
      fixturePath = arg.slice('--fixture='.length);
      adapterName = 'fixture'; // --fixture implies --adapter=fixture
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.slice('--limit='.length), 10);
      if (!isNaN(n) && n > 0) limit = n;
    }
  }

  return { adapterName, fixturePath, dryRun, limit };
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { adapterName, fixturePath, dryRun, limit } = parseArgs();

  const adapter = makeAdapter(adapterName, { fixturePath });

  // Only create the DB client when actually writing.
  const client = dryRun ? null : createIngestionClient();

  const mode = dryRun ? 'DRY RUN (no DB writes)' : 'LIVE';
  console.log(
    `[run] adapter=${adapter.name}  mode=${mode}${limit !== undefined ? `  limit=${limit}` : ''}\n`,
  );

  // ── Fetch ───────────────────────────────────────────────────────────────

  let rawItems = await adapter.fetchItems();
  if (limit !== undefined) rawItems = rawItems.slice(0, limit);
  console.log(
    `[run] Fetched ${rawItems.length} item(s) from "${adapter.name}"\n`,
  );

  // ── Normalize + Ingest ──────────────────────────────────────────────────

  const results: IngestionResult[] = [];

  for (const raw of rawItems) {
    // Normalization — validate and transform adapter output into IRIS shape.
    let normalized;
    try {
      normalized = normalizeSourceItem(raw);
    } catch (err) {
      const msg = err instanceof NormalizationError ? err.message : String(err);
      const headline = raw.headline ?? '(no headline)';
      console.error(`[NORM_ERR] "${headline}": ${msg}`);
      results.push({ status: 'error', title: headline, message: `normalization: ${msg}` });
      continue;
    }

    if (dryRun) {
      // Log what would be written without touching the DB.
      console.log(
        `[DRY]  "${normalized.title}"  [${normalized.status}]  ${normalized.updates.length} update(s)`,
      );
      for (const u of normalized.updates) {
        const urlPart = u.source_url ? `  <${u.source_url}>` : '';
        const preview = u.content.length > 80
          ? u.content.slice(0, 80) + '…'
          : u.content;
        console.log(`       ↳ [${u.source_name}]${urlPart}: ${preview}`);
      }
      results.push({ status: 'ok', title: normalized.title });
      continue;
    }

    // Live write — calls ingest_event RPC via service_role client.
    const result = await ingestEvent(client!, normalized);
    results.push(result);

    if (result.status === 'ok') {
      console.log(`[OK]      "${result.title}"  id: ${result.eventId}`);
    } else if (result.status === 'skipped') {
      console.log(`[SKIP]    "${result.title}"  — ${result.message}`);
    } else {
      console.error(`[ERROR]   "${result.title}"  — ${result.message}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  const ok      = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors  = results.filter((r) => r.status === 'error').length;

  console.log(`\n[run] Done.  ok=${ok}  skipped=${skipped}  errors=${errors}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[run] Fatal error:', err);
  process.exit(1);
});
