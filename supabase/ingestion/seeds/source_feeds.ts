/**
 * IRIS Ingestion — Source Feed Seeds
 *
 * Upserts the canonical set of source feeds into the source_feeds table.
 * Safe to re-run: uses slug as the conflict target.
 *
 * Usage:
 *   npx tsx supabase/ingestion/seeds/source_feeds.ts
 */

import { fileURLToPath } from 'url';
import { createIngestionClient } from '../client';

// ── Feed definitions ──────────────────────────────────────────────────────────

const FEEDS = [
  {
    slug: 'reuters-world',
    name: 'Reuters World News',
    feed_url: 'https://feeds.reuters.com/reuters/worldnews',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 85,
    poll_interval_seconds: 600,   // 10 min
  },
  {
    slug: 'bbc-world',
    name: 'BBC World News',
    feed_url: 'http://feeds.bbci.co.uk/news/world/rss.xml',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 85,
    poll_interval_seconds: 600,
  },
  {
    slug: 'aljazeera-english',
    name: 'Al Jazeera English',
    feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'medium',
    credibility_score: 72,
    poll_interval_seconds: 900,   // 15 min
  },
  {
    slug: 'ap-world',
    name: 'Associated Press World',
    feed_url: 'https://rsshub.app/apnews/topics/world-news',
    source_type: 'media_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 88,
    poll_interval_seconds: 600,
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
  },
  {
    slug: 'who-news',
    name: 'WHO News Releases',
    feed_url: 'https://www.who.int/rss-feeds/news-releases-en.xml',
    source_type: 'official_rss',
    parser_type: 'rss2',
    reliability_tier: 'official',
    credibility_score: 95,
    poll_interval_seconds: 3600,  // 1 hour
  },
  {
    slug: 'usgs-earthquakes',
    name: 'USGS Earthquakes M4.5+',
    feed_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom',
    source_type: 'official_rss',
    parser_type: 'atom',
    reliability_tier: 'official',
    credibility_score: 95,
    poll_interval_seconds: 300,   // 5 min — earthquakes need fast polling
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
  },
  {
    slug: 'reliefweb-updates',
    name: 'ReliefWeb Humanitarian Updates',
    feed_url: 'https://reliefweb.int/updates/rss.xml',
    source_type: 'official_rss',
    parser_type: 'rss2',
    reliability_tier: 'high',
    credibility_score: 82,
    poll_interval_seconds: 1800,  // 30 min
  },
] as const;

// ── Seed runner ───────────────────────────────────────────────────────────────

async function seedSourceFeeds(): Promise<void> {
  const client = createIngestionClient();

  console.log(`[seed] Upserting ${FEEDS.length} source feed(s)...`);

  for (const feed of FEEDS) {
    const { error } = await client
      .from('source_feeds')
      .upsert(
        {
          ...feed,
          is_active: true,
          health_score: 100,
        },
        { onConflict: 'slug' },
      );

    if (error) {
      console.error(`[seed] Failed to upsert ${feed.slug}: ${error.message}`);
    } else {
      console.log(`[seed] ok: ${feed.name} (${feed.reliability_tier}, score=${feed.credibility_score})`);
    }
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
