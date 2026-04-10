/**
 * IRIS Ingestion — Normalization Test Runner
 *
 * Exercises normalizeSourceItem() against a suite of known-good and known-bad
 * inputs. No external test framework required — runs standalone with npx tsx.
 *
 * Usage:
 *   npx tsx supabase/ingestion/test_normalize.ts
 *
 * Exit codes:
 *   0 — all cases passed
 *   1 — one or more failures
 *
 * When to run:
 *   - After modifying normalize.ts
 *   - After changing EventStatus values or validation rules
 *   - Before adding a new adapter (confirms normalization handles expected shapes)
 */

import { normalizeSourceItem, NormalizationError } from './normalize';
import type { RawSourceItem } from './types';

// ── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string): void {
  console.log(`  PASS  ${label}${detail ? `  ← ${detail}` : ''}`);
  passed++;
}

function fail(label: string, reason: string): void {
  console.error(`  FAIL  ${label}  ← ${reason}`);
  failed++;
}

/** Asserts that normalizeSourceItem(input) throws NormalizationError. */
function expectError(label: string, input: RawSourceItem, expectFragment?: string): void {
  try {
    normalizeSourceItem(input);
    fail(label, 'Expected NormalizationError but no error was thrown');
  } catch (err) {
    if (!(err instanceof NormalizationError)) {
      fail(label, `Expected NormalizationError, got ${err instanceof Error ? err.constructor.name : typeof err}: ${err}`);
      return;
    }
    if (expectFragment && !err.message.includes(expectFragment)) {
      fail(label, `Error message "${err.message}" does not contain "${expectFragment}"`);
      return;
    }
    pass(label, err.message);
  }
}

/** Asserts that normalizeSourceItem(input) returns without throwing. */
function expectOk(
  label: string,
  input: RawSourceItem,
  check?: (result: ReturnType<typeof normalizeSourceItem>) => string | undefined,
): void {
  try {
    const result = normalizeSourceItem(input);
    if (check) {
      const failure = check(result);
      if (failure) {
        fail(label, failure);
        return;
      }
    }
    pass(label);
  } catch (err) {
    fail(label, `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Shared valid base ───────────────────────────────────────────────────────

const VALID: RawSourceItem = {
  headline: 'Flood in northern district',
  status: 'emerging',
  content: 'Heavy rainfall causing road closures.',
  source_name: 'Reuters',
};

// ── Good inputs ─────────────────────────────────────────────────────────────

console.log('\nGood inputs — must normalize without error:\n');

expectOk('minimal valid item', VALID, (r) => {
  if (r.title !== 'Flood in northern district') return `title mismatch: "${r.title}"`;
  if (r.status !== 'emerging') return `status mismatch: "${r.status}"`;
  if (r.updates.length !== 1) return `expected 1 update, got ${r.updates.length}`;
  if (r.updates[0].content !== 'Heavy rainfall causing road closures.') return 'content mismatch';
  if (r.updates[0].source_name !== 'Reuters') return 'source_name mismatch';
  if ('source_url' in r.updates[0]) return 'source_url should be absent when not provided';
});

expectOk('all four valid statuses', { ...VALID, status: 'developing' });
expectOk('', { ...VALID, status: 'verified' });
expectOk('', { ...VALID, status: 'disputed' });

expectOk('source_url propagates to updates[0]',
  { ...VALID, source_url: 'https://reuters.com/flood' },
  (r) => r.updates[0].source_url !== 'https://reuters.com/flood'
    ? `source_url not propagated: ${r.updates[0].source_url}`
    : undefined,
);

expectOk('additional_updates become updates[1..]',
  {
    ...VALID,
    additional_updates: [
      { content: 'Evacuation ordered.', source_name: 'BBC' },
      { content: 'Relief teams mobilized.', source_name: 'AP News', source_url: 'https://apnews.com' },
    ],
  },
  (r) => {
    if (r.updates.length !== 3) return `expected 3 updates, got ${r.updates.length}`;
    if (r.updates[1].source_name !== 'BBC') return 'updates[1] source_name mismatch';
    if (r.updates[2].source_url !== 'https://apnews.com') return 'updates[2] source_url mismatch';
  },
);

expectOk('additional_update without source_url — source_url absent in result',
  { ...VALID, additional_updates: [{ content: 'Follow-up report.', source_name: 'AP News' }] },
  (r) => 'source_url' in r.updates[1] ? 'source_url should be absent on update without it' : undefined,
);

expectOk('whitespace trimmed from headline',
  { ...VALID, headline: '  Flood in northern district  ' },
  (r) => r.title !== 'Flood in northern district' ? `title not trimmed: "${r.title}"` : undefined,
);

expectOk('whitespace trimmed from content',
  { ...VALID, content: '  Heavy rainfall.  ' },
  (r) => r.updates[0].content !== 'Heavy rainfall.' ? `content not trimmed: "${r.updates[0].content}"` : undefined,
);

expectOk('whitespace trimmed from source_name',
  { ...VALID, source_name: '  Reuters  ' },
  (r) => r.updates[0].source_name !== 'Reuters' ? `source_name not trimmed: "${r.updates[0].source_name}"` : undefined,
);

expectOk('whitespace trimmed from additional_update fields',
  { ...VALID, additional_updates: [{ content: '  Extra report.  ', source_name: '  BBC  ' }] },
  (r) => {
    if (r.updates[1].content !== 'Extra report.') return `additional content not trimmed: "${r.updates[1].content}"`;
    if (r.updates[1].source_name !== 'BBC') return `additional source_name not trimmed: "${r.updates[1].source_name}"`;
  },
);

expectOk('original case preserved in title (not lowercased)',
  { ...VALID, headline: 'FLOOD IN Northern District' },
  (r) => r.title !== 'FLOOD IN Northern District' ? `case changed: "${r.title}"` : undefined,
);

expectOk('empty additional_updates array — 1 update produced',
  { ...VALID, additional_updates: [] },
  (r) => r.updates.length !== 1 ? `expected 1 update, got ${r.updates.length}` : undefined,
);

// ── Bad inputs — headline ───────────────────────────────────────────────────

console.log('\nBad inputs — headline:\n');

expectError('empty headline', { ...VALID, headline: '' }, 'headline');
expectError('whitespace-only headline', { ...VALID, headline: '   ' }, 'headline');
expectError('null headline (cast)', { ...VALID, headline: null as unknown as string }, 'headline');
expectError('undefined headline (cast)', { ...VALID, headline: undefined as unknown as string }, 'headline');

// ── Bad inputs — status ─────────────────────────────────────────────────────

console.log('\nBad inputs — status:\n');

expectError('invalid status "breaking"', { ...VALID, status: 'breaking' as never }, 'status');
expectError('invalid status "unknown"', { ...VALID, status: 'unknown' as never }, 'status');
expectError('invalid status empty string', { ...VALID, status: '' as never }, 'status');
expectError('invalid status "Emerging" (case-sensitive)', { ...VALID, status: 'Emerging' as never }, 'status');

// ── Bad inputs — content ────────────────────────────────────────────────────

console.log('\nBad inputs — content:\n');

expectError('empty content', { ...VALID, content: '' }, 'content');
expectError('whitespace-only content', { ...VALID, content: '   ' }, 'content');
expectError('null content (cast)', { ...VALID, content: null as unknown as string }, 'content');

// ── Bad inputs — source_name ────────────────────────────────────────────────

console.log('\nBad inputs — source_name:\n');

expectError('empty source_name', { ...VALID, source_name: '' }, 'source_name');
expectError('whitespace-only source_name', { ...VALID, source_name: '   ' }, 'source_name');
expectError('null source_name (cast)', { ...VALID, source_name: null as unknown as string }, 'source_name');

// ── Bad inputs — additional_updates ────────────────────────────────────────

console.log('\nBad inputs — additional_updates:\n');

expectError(
  'additional_update with empty content',
  { ...VALID, additional_updates: [{ content: '', source_name: 'BBC' }] },
  'additional_updates[0].content',
);
expectError(
  'additional_update with whitespace-only content',
  { ...VALID, additional_updates: [{ content: '   ', source_name: 'BBC' }] },
  'additional_updates[0].content',
);
expectError(
  'additional_update with empty source_name',
  { ...VALID, additional_updates: [{ content: 'Follow-up.', source_name: '' }] },
  'additional_updates[0].source_name',
);
expectError(
  'additional_update with null content (cast)',
  { ...VALID, additional_updates: [{ content: null as unknown as string, source_name: 'BBC' }] },
  'additional_updates[0].content',
);
expectError(
  'second additional_update with bad content (index 1 in error message)',
  {
    ...VALID,
    additional_updates: [
      { content: 'Valid.', source_name: 'BBC' },
      { content: '', source_name: 'AP News' },
    ],
  },
  'additional_updates[1].content',
);

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
