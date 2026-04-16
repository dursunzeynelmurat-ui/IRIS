/**
 * IRIS Ingestion — Event Matcher Service
 *
 * Pure read-only logic for finding whether a normalized item matches an
 * existing event. No DB writes happen here — callers (processNormalized worker)
 * do all writing via the create_event_for_item / attach_item_to_event RPCs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { tokenize, computeMatchScore } from '../lib/similarity';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum score to attach a normalized item to an existing event. */
export const MATCH_THRESHOLD = 45;

/** Score above which we treat the match as definitive (high confidence). */
export const STRONG_MATCH_THRESHOLD = 70;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CandidateEvent {
  id: string;
  title: string;
  summary: string | null;
  /** Derived from title + summary tokenization — built in-memory, not stored. */
  keywords: string[];
  category: string | null;
  city: string | null;
  country_codes: string[];
  latest_update_at: string | null;
  created_at: string;
}

export interface MatchResult {
  eventId: string;
  score: number;
  reason: string;
}

// ── Candidate loading ─────────────────────────────────────────────────────────

/**
 * Load events created within the last `hoursBack` hours that are still active
 * (visible and not archived/resolved). Used as the candidate pool for matching.
 *
 * @param client     - Service-role Supabase client.
 * @param hoursBack  - How far back to look for existing events (default 48 h).
 * @returns Array of candidates with in-memory keyword sets.
 */
export async function getRecentCandidates(
  client: SupabaseClient,
  hoursBack = 48,
): Promise<CandidateEvent[]> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from('events')
    .select('id, title, summary, category, city, country_codes, latest_update_at, created_at')
    .eq('visibility', 'visible')
    .not('status', 'in', '("archived","resolved")')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`[matcher] getRecentCandidates: ${error.message}`);
  }

  return ((data as Array<{
    id: string;
    title: string;
    summary: string | null;
    category: string | null;
    city: string | null;
    country_codes: string[];
    latest_update_at: string | null;
    created_at: string;
  }>) ?? []).map((row) => ({
    ...row,
    keywords: [
      ...tokenize(row.title),
      ...tokenize(row.summary ?? ''),
    ],
  }));
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Find the best-matching existing event for an incoming normalized item.
 *
 * Scores every candidate using the `computeMatchScore` function from
 * similarity.ts (title×0.40, summary×0.20, keywords×0.20, location×0.10,
 * time×0.10). Returns the top-scoring candidate if it meets MATCH_THRESHOLD;
 * otherwise returns null.
 *
 * @param normalizedTitle   - Cleaned item title.
 * @param normalizedSummary - Cleaned item summary (may be null).
 * @param keywords          - Item keyword list.
 * @param locationText      - Item location string (city/country, may be null).
 * @param occurredAt        - Estimated event time (may be null).
 * @param candidates        - Pool of existing events to compare against.
 * @returns Best match above threshold, or null.
 */
export function findBestMatch(
  normalizedTitle: string,
  normalizedSummary: string | null,
  keywords: string[],
  locationText: string | null,
  occurredAt: Date | null,
  candidates: CandidateEvent[],
): MatchResult | null {
  if (candidates.length === 0) return null;

  const scored: Array<{ eventId: string; score: number; reason: string }> = [];

  for (const candidate of candidates) {
    // Hours between candidate's last activity and the incoming item.
    const refTime = candidate.latest_update_at ?? candidate.created_at;
    const refMs = new Date(refTime).getTime();
    const itemMs = occurredAt?.getTime() ?? Date.now();
    const hoursApart = Math.abs(itemMs - refMs) / (1000 * 60 * 60);

    const score = computeMatchScore({
      titleA: normalizedTitle,
      titleB: candidate.title,
      summaryA: normalizedSummary ?? undefined,
      summaryB: candidate.summary ?? undefined,
      keywordsA: keywords,
      keywordsB: candidate.keywords,
      locationA: locationText,
      locationB: candidate.city,
      hoursApart,
    });

    // Build a human-readable reason string for logging.
    const reason = `event=${candidate.id.slice(0, 8)} score=${score} hours=${hoursApart.toFixed(1)}`;
    scored.push({ eventId: candidate.id, score, reason });
  }

  // Sort descending by score.
  scored.sort((a, b) => b.score - a.score);

  // Log top-3 for debugging.
  const top3 = scored.slice(0, 3);
  if (top3[0] && top3[0].score >= MATCH_THRESHOLD) {
    console.log(`[matcher] top matches for "${normalizedTitle.slice(0, 50)}": ` +
      top3.map((r) => r.reason).join(' | '));
  }

  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return null;

  return { eventId: best.eventId, score: best.score, reason: best.reason };
}
