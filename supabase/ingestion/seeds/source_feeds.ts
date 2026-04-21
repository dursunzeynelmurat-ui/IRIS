/**
 * IRIS Ingestion — Source Feed Seeds
 *
 * Upserts the canonical set of source feeds into the source_feeds table.
 * Safe to re-run: uses slug as the conflict target.
 *
 * ## source_policy values (added in migration 036)
 *
 *   active_allowed    — open or official feed; safe for production polling.
 *   dev_only          — unofficial proxy / scraper; development use only.
 *                       Not appropriate for production (terms of service risk).
 *   licensed_required — commercial license must be confirmed before enabling.
 *                       Seeded as is_active=false regardless of environment.
 *
 * ## is_active defaults
 *
 *   active_allowed    → true (ready to poll immediately)
 *   dev_only          → true only when NODE_ENV !== 'production'
 *   licensed_required → always false (must be manually enabled after licensing)
 *
 * Usage:
 *   npx tsx supabase/ingestion/seeds/source_feeds.ts
 */

import { fileURLToPath } from 'url';
import { createIngestionClient } from '../client';

// ── Policy type ───────────────────────────────────────────────────────────────

type SourcePolicy = 'active_allowed' | 'dev_only' | 'licensed_required';

// ── Feed definitions ──────────────────────────────────────────────────────────

const FEEDS: Array<{
  slug: string;
  name: string;
  feed_url: string;
  source_type: string;
  parser_type: string;
  reliability_tier: string;
  credibility_score: number;
  poll_interval_seconds: number;
  source_policy: SourcePolicy;
  notes?: string;
}> = [
  // ── High-credibility wire services ─────────────────────────────────────────

  {
    slug: 'reuters-world',
    name: 'Reuters World News',
    feed_url: 'https://feeds.reuters.com/reuters/worldnews',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 85,
    poll_interval_seconds: 600,
    source_policy: 'licensed_required',
    notes: 'Reuters restricts commercial aggregation/redistribution. Confirm license before enabling.',
  },
  {
    slug: 'ap-world',
    name: 'AP News World (rsshub proxy)',
    feed_url: 'https://rsshub.app/apnews/topics/world-news',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 88,
    poll_interval_seconds: 600,
    source_policy: 'dev_only',
    notes: 'rsshub.app is an unofficial community proxy scraping AP content. Dev/testing only. Use official AP API in production.',
  },

  // ── Open media feeds (active_allowed) ──────────────────────────────────────

  {
    slug: 'bbc-world',
    name: 'BBC World News',
    feed_url: 'http://feeds.bbci.co.uk/news/world/rss.xml',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 85,
    poll_interval_seconds: 600,
    source_policy: 'active_allowed',
  },
  {
    slug: 'aljazeera-english',
    name: 'Al Jazeera English',
    feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'medium',
    credibility_score: 72,
    poll_interval_seconds: 900,
    source_policy: 'active_allowed',
  },
  {
    slug: 'dw-world',
    name: 'DW World News',
    feed_url: 'https://rss.dw.com/xml/rss-en-world',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'medium',
    credibility_score: 78,
    poll_interval_seconds: 900,
    source_policy: 'active_allowed',
  },
  {
    slug: 'france24-world',
    name: 'France 24 World',
    feed_url: 'https://www.france24.com/en/rss',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'medium',
    credibility_score: 75,
    poll_interval_seconds: 900,
    source_policy: 'active_allowed',
  },

  // ── Official / authoritative sources (active_allowed) ──────────────────────

  {
    slug: 'who-news',
    name: 'WHO News Releases',
    feed_url: 'https://www.who.int/rss-feeds/news-releases-en.xml',
    source_type: 'official_rss',
    parser_type: 'rss2',
    reliability_tier: 'official',
    credibility_score: 95,
    poll_interval_seconds: 3600,
    source_policy: 'active_allowed',
  },
  {
    slug: 'usgs-earthquakes',
    name: 'USGS Earthquakes M4.5+',
    feed_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom',
    source_type: 'official_rss',
    parser_type: 'atom',
    reliability_tier: 'official',
    credibility_score: 95,
    poll_interval_seconds: 300,
    source_policy: 'active_allowed',
  },
  {
    slug: 'gdacs-alerts',
    name: 'GDACS Global Disaster Alerts',
    feed_url: 'https://www.gdacs.org/xml/rss.xml',
    source_type: 'official_rss',
    parser_type: 'rss2',
    reliability_tier: 'official',
    credibility_score: 88,
    poll_interval_seconds: 900,
    source_policy: 'active_allowed',
  },
  {
    slug: 'reliefweb-updates',
    name: 'ReliefWeb Humanitarian Updates',
    feed_url: 'https://reliefweb.int/updates/rss.xml',
    source_type: 'official_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 82,
    poll_interval_seconds: 1800,
    source_policy: 'active_allowed',
  },
];

// ── Policy → default is_active ────────────────────────────────────────────────

function defaultActive(policy: SourcePolicy): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  switch (policy) {
    case 'active_allowed':    return true;
    case 'dev_only':          return !isProduction;
    case 'licensed_required': return false;  // always off; manual activation required
  }
}

// ── Seed runner ───────────────────────────────────────────────────────────────

async function seedSourceFeeds(): Promise<void> {
  const client = createIngestionClient();
  const isProduction = process.env.NODE_ENV === 'production';

  console.log(`[seed] Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`[seed] Upserting ${FEEDS.length} source feed(s)...`);

  for (const { notes: _notes, ...feed } of FEEDS) {
    const isActive = defaultActive(feed.source_policy);

    const { error } = await client
      .from('source_feeds')
      .upsert(
        {
          ...feed,
          is_active: isActive,
          health_score: 100,
        },
        { onConflict: 'slug' },
      );

    if (error) {
      console.error(`[seed] Failed: ${feed.slug}: ${error.message}`);
    } else {
      const flag = feed.source_policy === 'active_allowed'
        ? isActive ? '✓ active' : '✗ inactive'
        : `✗ inactive [${feed.source_policy}]`;
      console.log(`[seed] ${feed.name} (${feed.reliability_tier}) — ${flag}`);
    }
  }

  // Summary by policy
  const byPolicy = FEEDS.reduce((acc, f) => {
    acc[f.source_policy] = (acc[f.source_policy] ?? 0) + 1;
    return acc;
  }, {} as Record<SourcePolicy, number>);

  console.log('\n[seed] Summary:');
  for (const [policy, count] of Object.entries(byPolicy)) {
    console.log(`  ${policy}: ${count} feed(s)`);
  }
  console.log('[seed] Done.');
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedSourceFeeds().catch((err) => {
    console.error('[seed] Fatal:', err);
    process.exit(1);
  });
}
