/**
 * IRIS Ingestion — Pipeline Scheduler
 *
 * Runs the full three-stage pipeline or any subset of stages:
 *   1. fetch    — poll RSS feeds → raw_source_items
 *   2. normalize — raw_source_items → normalized_source_items
 *   3. process  — normalized_source_items → events (match or create)
 *
 * Stages are run sequentially. A failure in one stage is logged but does not
 * prevent the next stage from running (partial pipeline > total failure).
 *
 * Usage:
 *   npx tsx supabase/ingestion/scheduler.ts [options]
 *
 * Options:
 *   --feed=<slug>    Only fetch a specific feed (fetch stage only)
 *   --steps=fetch,normalize,process  Which stages to run (default: all three)
 *   --dry-run        Log what would happen without writing to DB
 *   --limit=N        Max items per normalize/process stage (default: 100/50)
 */

import { fileURLToPath } from 'url';
import { runFetchFeeds } from './workers/fetchFeeds';
import { runNormalizeItems } from './workers/normalizeItems';
import { runProcessNormalized } from './workers/processNormalized';

// ── Stage definitions ─────────────────────────────────────────────────────────

type Stage = 'fetch' | 'normalize' | 'process';

const ALL_STAGES: Stage[] = ['fetch', 'normalize', 'process'];

// ── Main pipeline runner ──────────────────────────────────────────────────────

export async function runPipeline(options?: {
  feedSlug?: string;
  steps?: Stage[];
  dryRun?: boolean;
  limit?: number;
}): Promise<void> {
  const steps = options?.steps ?? ALL_STAGES;
  const dryRun = options?.dryRun ?? false;
  const limit = options?.limit ?? 100;
  const feedSlug = options?.feedSlug;

  console.log(`[pipeline] Starting stages: ${steps.join(', ')}${dryRun ? ' (dry-run)' : ''}`);
  const pipelineStart = Date.now();

  for (const stage of steps) {
    const stageStart = Date.now();
    console.log(`[pipeline] ── stage: ${stage} ──`);

    try {
      if (stage === 'fetch') {
        await runFetchFeeds({ feedSlug, dryRun });
      } else if (stage === 'normalize') {
        await runNormalizeItems({ limit, dryRun });
      } else if (stage === 'process') {
        await runProcessNormalized({ limit: Math.min(limit, 50), dryRun });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] stage ${stage} failed: ${msg}`);
      // Continue to the next stage rather than aborting.
    }

    const stageDurationMs = Date.now() - stageStart;
    console.log(`[pipeline] stage ${stage} done in ${stageDurationMs}ms`);
  }

  const totalMs = Date.now() - pipelineStart;
  console.log(`[pipeline] Complete in ${totalMs}ms`);
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  const feedSlug = args.find((a) => a.startsWith('--feed='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  const stepsArg = args.find((a) => a.startsWith('--steps='))?.split('=')[1];
  const steps = stepsArg
    ? (stepsArg.split(',').map((s) => s.trim()) as Stage[])
    : undefined;

  runPipeline({ feedSlug, steps, dryRun, limit }).catch((err) => {
    console.error('[pipeline] Fatal:', err);
    process.exit(1);
  });
}
