/**
 * IRIS Ingestion — Normalizer Service
 *
 * Reads a raw_source_items row, applies text normalization, location extraction,
 * and category inference, then inserts the result into normalized_source_items.
 * Finally marks the raw item's fetch_status as 'normalized'.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTitle, cleanText, extractFirstSentences, inferLanguage } from '../lib/text';
import { tokenize } from '../lib/similarity';
import { dedupeSignature } from '../lib/hash';

// ── Normalization version ─────────────────────────────────────────────────────

/** Increment when the normalization algorithm changes to enable re-normalization. */
const NORMALIZATION_VERSION = 1;

// ── Country name → ISO 3166-1 alpha-2 map ────────────────────────────────────

const COUNTRY_MAP: Record<string, string> = {
  iraq: 'IQ',
  ukraine: 'UA',
  syria: 'SY',
  afghanistan: 'AF',
  yemen: 'YE',
  gaza: 'PS',
  palestine: 'PS',
  israel: 'IL',
  sudan: 'SD',
  russia: 'RU',
  china: 'CN',
  india: 'IN',
  pakistan: 'PK',
  turkey: 'TR',
  iran: 'IR',
  'united states': 'US',
  usa: 'US',
  'u.s.': 'US',
  us: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  france: 'FR',
  germany: 'DE',
  japan: 'JP',
  brazil: 'BR',
  mexico: 'MX',
  ethiopia: 'ET',
  somalia: 'SO',
  myanmar: 'MM',
  libya: 'LY',
  lebanon: 'LB',
  nigeria: 'NG',
  venezuela: 'VE',
  colombia: 'CO',
  haiti: 'HT',
  bangladesh: 'BD',
  indonesia: 'ID',
  philippines: 'PH',
  egypt: 'EG',
  kenya: 'KE',
  mozambique: 'MZ',
  zimbabwe: 'ZW',
  drc: 'CD',
  congo: 'CD',
};

// ── Category keywords ─────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'disaster',
    keywords: [
      'earthquake', 'flood', 'flooding', 'hurricane', 'tornado', 'wildfire',
      'fire', 'eruption', 'volcano', 'tsunami', 'storm', 'cyclone', 'typhoon',
      'landslide', 'drought', 'avalanche',
    ],
  },
  {
    category: 'conflict',
    keywords: [
      'war', 'attack', 'killed', 'explosion', 'bomb', 'bombing', 'military',
      'troops', 'fighting', 'forces', 'missile', 'airstrike', 'strike',
      'casualties', 'dead', 'wounded', 'offensive', 'siege',
    ],
  },
  {
    category: 'health',
    keywords: [
      'outbreak', 'virus', 'disease', 'epidemic', 'pandemic', 'vaccine',
      'who', 'health', 'hospital', 'infection', 'deaths', 'cases', 'pathogen',
    ],
  },
  {
    category: 'politics',
    keywords: [
      'election', 'president', 'government', 'parliament', 'minister',
      'vote', 'coup', 'protest', 'sanctions', 'diplomatic', 'treaty',
    ],
  },
  {
    category: 'economy',
    keywords: [
      'economy', 'market', 'inflation', 'gdp', 'recession', 'bank',
      'oil', 'trade', 'tariff', 'financial', 'currency', 'debt',
    ],
  },
];

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Try to extract location information from a text string.
 *
 * Looks for patterns like:
 *   "in City, Country"  →  city + country code
 *   "in City"           →  city only
 *   "City, Country"     →  city + country code
 *
 * @param text - Title or summary to scan.
 * @returns Object with locationText, city, and countryCode (all may be null).
 */
export function extractLocation(text: string): {
  locationText: string | null;
  city: string | null;
  countryCode: string | null;
} {
  // Pattern: "in [City], [Country]" or "in [City]"
  const inCityCountry = text.match(
    /\bin\s+([A-Z][a-zA-Z\s'-]{1,24}),\s*([A-Z][a-zA-Z\s]{1,20})\b/,
  );
  if (inCityCountry) {
    const city = inCityCountry[1].trim();
    const countryRaw = inCityCountry[2].trim().toLowerCase();
    const countryCode = COUNTRY_MAP[countryRaw] ?? null;
    return {
      locationText: `${city}, ${inCityCountry[2].trim()}`,
      city,
      countryCode,
    };
  }

  // Pattern: "[City], [Country]" (at start of text or after ": ")
  const cityCountry = text.match(
    /(?:^|:\s+)([A-Z][a-zA-Z\s'-]{1,24}),\s*([A-Z][a-zA-Z\s]{1,20})\b/,
  );
  if (cityCountry) {
    const city = cityCountry[1].trim();
    const countryRaw = cityCountry[2].trim().toLowerCase();
    const countryCode = COUNTRY_MAP[countryRaw] ?? null;
    return {
      locationText: `${city}, ${cityCountry[2].trim()}`,
      city,
      countryCode,
    };
  }

  // Pattern: "in [City]" — city without country
  const inCity = text.match(/\bin\s+([A-Z][a-zA-Z\s'-]{2,20})\b/);
  if (inCity) {
    const city = inCity[1].trim();
    // Check if the "city" itself is a known country name.
    const asCountry = COUNTRY_MAP[city.toLowerCase()];
    if (asCountry) {
      return { locationText: city, city: null, countryCode: asCountry };
    }
    return { locationText: city, city, countryCode: null };
  }

  return { locationText: null, city: null, countryCode: null };
}

/**
 * Infer an event category from title and summary using keyword matching.
 *
 * Returns the first matched category or null if no keywords match.
 *
 * @param title   - Normalized event title.
 * @param summary - Normalized event summary (may be empty).
 * @returns Category string or null.
 */
export function inferCategory(title: string, summary: string): string | null {
  const combined = `${title} ${summary}`.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (combined.includes(kw)) return category;
    }
  }
  return null;
}

/**
 * Normalize a raw_source_items row and insert the result into
 * normalized_source_items. Marks the raw item's fetch_status as 'normalized'.
 *
 * @param client    - Service-role Supabase client.
 * @param rawItemId - UUID of the raw_source_items row.
 * @returns `{ id }` of the new normalized_source_items row, or null if the
 *          raw item was already normalized or could not be fetched.
 */
export async function normalizeRawItem(
  client: SupabaseClient,
  rawItemId: string,
): Promise<{ id: string } | null> {
  // Fetch the raw item.
  const { data: raw, error: fetchErr } = await client
    .from('raw_source_items')
    .select('*')
    .eq('id', rawItemId)
    .single();

  if (fetchErr || !raw) {
    console.error(`[normalize] fetchRaw ${rawItemId}: ${fetchErr?.message ?? 'not found'}`);
    return null;
  }

  const typedRaw = raw as {
    id: string;
    source_feed_id: string;
    fetch_status: string;
    raw_title: string | null;
    raw_summary: string | null;
    raw_content: string | null;
    raw_author: string | null;
    raw_published_at: string | null;
  };

  // Skip if already normalized.
  if (typedRaw.fetch_status !== 'raw') {
    return null;
  }

  // ── Text normalization ──────────────────────────────────────────────────────
  const normalizedTitle = normalizeTitle(typedRaw.raw_title ?? '');
  const normalizedSummary = typedRaw.raw_summary
    ? extractFirstSentences(cleanText(typedRaw.raw_summary), 3)
    : null;

  const langInput = `${normalizedTitle} ${normalizedSummary ?? ''}`;
  const languageCode = inferLanguage(langInput);

  // Keywords: deduplicated union of title + summary tokens, capped at 20.
  const keywords: string[] = [
    ...tokenize(normalizedTitle),
    ...tokenize(normalizedSummary ?? ''),
  ].slice(0, 20);

  const sig = dedupeSignature(normalizedTitle);

  const occurredAtEstimate = typedRaw.raw_published_at ?? null;

  // ── Location extraction ─────────────────────────────────────────────────────
  const searchText = `${normalizedTitle} ${normalizedSummary ?? ''}`;
  const { locationText, city, countryCode } = extractLocation(searchText);

  // ── Category inference ──────────────────────────────────────────────────────
  const categoryCandidate = inferCategory(normalizedTitle, normalizedSummary ?? '');

  // ── Insert normalized item ──────────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await client
    .from('normalized_source_items')
    .insert({
      raw_source_item_id: rawItemId,
      normalized_title: normalizedTitle,
      normalized_summary: normalizedSummary,
      language_code: languageCode,
      category_candidate: categoryCandidate,
      country_code: countryCode,
      city,
      location_text: locationText,
      occurred_at_estimate: occurredAtEstimate,
      keywords_json: keywords,
      entities_json: [],
      claims_json: [],
      dedupe_signature: sig,
      normalization_version: NORMALIZATION_VERSION,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    // Unique constraint on raw_source_item_id means it was already normalized
    // concurrently — not an error.
    if (insertErr?.code === '23505') return null;
    console.error(`[normalize] insert ${rawItemId}: ${insertErr?.message ?? 'no data'}`);
    return null;
  }

  // ── Mark raw item as normalized ─────────────────────────────────────────────
  await client
    .from('raw_source_items')
    .update({ fetch_status: 'normalized' })
    .eq('id', rawItemId);

  return { id: (inserted as { id: string }).id };
}
