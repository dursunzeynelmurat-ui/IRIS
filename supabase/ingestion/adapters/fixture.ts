/**
 * IRIS Ingestion — FixtureAdapter
 *
 * Reads RawSourceItem[] from a JSON file. Use this adapter to:
 *   - Test the normalization pipeline against arbitrary real-world data
 *     shapes before writing a full source adapter
 *   - Validate that a specific set of events normalizes and deduplicates
 *     correctly before running a live ingest
 *   - Prototype ingestion of data from a one-off source without code changes
 *
 * Fixture file format: JSON array of RawSourceItem objects.
 * See supabase/ingestion/fixtures/example.json for the expected shape.
 *
 * Usage:
 *   # Dry-run against the default fixture file
 *   npx tsx supabase/ingestion/run.ts --adapter=fixture --dry-run
 *
 *   # Live ingest from a custom fixture file
 *   FIXTURE_PATH=./my_events.json npx tsx supabase/ingestion/run.ts --adapter=fixture
 *
 * Default fixture path: supabase/ingestion/fixtures/example.json
 * Override: set FIXTURE_PATH env var to an absolute or relative path.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceAdapter, RawSourceItem } from '../types';

const DEFAULT_FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/example.json',
);

export class FixtureAdapter implements SourceAdapter {
  readonly name = 'fixture';
  private readonly fixturePath: string;

  constructor(fixturePath?: string) {
    this.fixturePath = fixturePath ?? process.env['FIXTURE_PATH'] ?? DEFAULT_FIXTURE_PATH;
  }

  async fetchItems(): Promise<RawSourceItem[]> {
    const resolved = path.resolve(this.fixturePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(
        `FixtureAdapter: file not found: ${resolved}\n` +
        `Use --fixture=<path> or set FIXTURE_PATH env var, or create fixtures/example.json`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } catch (err) {
      throw new Error(`FixtureAdapter: failed to parse JSON from ${resolved}: ${err}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `FixtureAdapter: fixture must be a JSON array of RawSourceItem objects, got ${typeof parsed}`,
      );
    }

    console.log(`[fixture] Loaded ${parsed.length} item(s) from ${resolved}`);
    return parsed as RawSourceItem[];
  }
}
