/**
 * IRIS — Event Ingestion Script (MVP)
 *
 * Usage:
 *   npx tsx supabase/seed/ingest.ts
 *
 * Requires in .env:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY   ← service role key bypasses RLS
 *
 * Duplicate guard: if an event with the same title was inserted
 * within the last 10 minutes, it is skipped.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { EventStatus } from '../../src/types';

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing env vars. Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in .env',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

// ── Types ──────────────────────────────────────────────────────

interface UpdatePayload {
  content: string;
  source_name: string;
  source_url?: string;
}

interface EventPayload {
  title: string;
  status: EventStatus;
  updates: UpdatePayload[];
}

// ── Core ingestion function ────────────────────────────────────

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function ingestEvent(payload: EventPayload): Promise<void> {
  const { title, status, updates } = payload;

  // Duplicate check: same title within the last 10 minutes
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('title', title)
    .gte('created_at', since)
    .maybeSingle();

  if (existing) {
    console.log(`[SKIP] Duplicate within 10 min: "${title}"`);
    return;
  }

  // Insert event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .insert({ title, status })
    .select('id')
    .single();

  if (eventError || !event) {
    console.error(`[ERROR] Failed to insert event "${title}":`, eventError?.message);
    return;
  }

  // Insert all updates for this event
  const updateRows = updates.map((u) => ({
    event_id: event.id,
    content: u.content,
    source_name: u.source_name,
    source_url: u.source_url ?? null,
  }));

  const { error: updatesError } = await supabase.from('event_updates').insert(updateRows);

  if (updatesError) {
    console.error(`[ERROR] Failed to insert updates for "${title}":`, updatesError.message);
    return;
  }

  console.log(`[OK] Ingested "${title}" (${updates.length} update(s)) — id: ${event.id}`);
}

// ── Seed data (Steps 8 + 9): 15 realistic events ──────────────

const SEED_EVENTS: EventPayload[] = [
  {
    title: 'Flooding reported in northern districts',
    status: 'emerging',
    updates: [
      { content: 'Heavy rainfall causing road closures in 3 districts.', source_name: 'Reuters' },
      { content: 'Local emergency services deployed to affected areas.', source_name: 'BBC', source_url: 'https://bbc.com' },
    ],
  },
  {
    title: 'Power grid outage — eastern region',
    status: 'developing',
    updates: [
      { content: 'Large-scale blackout affecting 200,000 homes reported.', source_name: 'AP News' },
      { content: 'Utility company confirms transformer failure as cause.', source_name: 'Local Grid Authority' },
      { content: 'Restoration estimated within 6 hours.', source_name: 'Reuters' },
    ],
  },
  {
    title: 'Wildfire spreading near coastal forest',
    status: 'developing',
    updates: [
      { content: 'Fire spotted at 14:00 local time, wind conditions worsening.', source_name: 'National Fire Service' },
      { content: 'Evacuation orders issued for 3 villages.', source_name: 'Government Press Office' },
    ],
  },
  {
    title: 'Earthquake — magnitude 5.4, depth 12km',
    status: 'verified',
    updates: [
      { content: 'USGS confirms 5.4 magnitude event near capital region.', source_name: 'USGS', source_url: 'https://usgs.gov' },
      { content: 'No structural damage reported in city center.', source_name: 'Civil Protection Agency' },
      { content: 'Aftershock of 3.1 recorded 2 hours later.', source_name: 'Seismology Institute' },
    ],
  },
  {
    title: 'Chemical spill on Highway 7 — hazmat response active',
    status: 'developing',
    updates: [
      { content: 'Truck overturned, unknown substance leaking onto road.', source_name: 'Police Scanner' },
      { content: 'Hazmat team arrived, 2km exclusion zone established.', source_name: 'Fire Department' },
    ],
  },
  {
    title: 'Bridge closure — structural inspection triggered',
    status: 'verified',
    updates: [
      { content: 'Engineers detected cracks in main support beam during routine check.', source_name: 'Transport Ministry' },
      { content: 'Bridge closed to all traffic indefinitely pending full assessment.', source_name: 'City Council' },
      { content: 'Alternative routes identified; congestion expected.', source_name: 'Traffic Authority' },
    ],
  },
  {
    title: 'Hospital cyberattack — systems partially offline',
    status: 'emerging',
    updates: [
      { content: 'Regional hospital reports IT systems compromised.', source_name: 'Anonymous Source' },
      { content: 'Patient records system restored; surgery schedule delayed.', source_name: 'Hospital PR' },
    ],
  },
  {
    title: 'Protest blocks city center — police deployed',
    status: 'developing',
    updates: [
      { content: 'Estimated 3,000 demonstrators blocking main avenue.', source_name: 'Al Jazeera' },
      { content: 'Riot police deployed; no clashes reported yet.', source_name: 'Reuters' },
      { content: 'Organizers claim peaceful intent, demand talks with government.', source_name: 'Protest Spokesperson' },
    ],
  },
  {
    title: 'Water contamination advisory — district 4',
    status: 'verified',
    updates: [
      { content: 'Elevated coliform bacteria levels detected in tap water samples.', source_name: 'Water Authority' },
      { content: 'Boil water notice issued for 80,000 residents.', source_name: 'Public Health Department' },
    ],
  },
  {
    title: 'Aircraft emergency landing — airport closed',
    status: 'developing',
    updates: [
      { content: 'Commercial flight declared emergency due to engine fault.', source_name: 'Air Traffic Control' },
      { content: 'Aircraft landed safely; all 187 passengers evacuated.', source_name: 'Airport Authority' },
      { content: 'Runway 2 closed pending inspection; delays expected.', source_name: 'Aviation Authority' },
    ],
  },
  {
    title: 'Gas explosion — residential building',
    status: 'disputed',
    updates: [
      { content: 'Explosion reported on 4th floor, cause unknown.', source_name: 'Emergency Services' },
      { content: 'Gas company denies pipeline fault; investigation ongoing.', source_name: 'Gas Company PR' },
      { content: 'Independent expert suspects faulty appliance, not main line.', source_name: 'Safety Inspector' },
    ],
  },
  {
    title: 'Cargo ship grounded — port access disrupted',
    status: 'verified',
    updates: [
      { content: 'Large container vessel ran aground at port entrance.', source_name: 'Coast Guard' },
      { content: 'Tugboats mobilized; refloating attempt scheduled for high tide.', source_name: 'Port Authority' },
    ],
  },
  {
    title: 'Drone swarm sighted near airport — airspace restricted',
    status: 'emerging',
    updates: [
      { content: 'Multiple unauthorized drones detected within 5km of runway.', source_name: 'Air Traffic Control' },
      { content: 'Police and counter-drone units deployed; origin unknown.', source_name: 'Police Statement' },
    ],
  },
  {
    title: 'Train derailment — two carriages off track',
    status: 'developing',
    updates: [
      { content: 'Passenger train derailed at 07:42; no fatalities confirmed.', source_name: 'Rail Authority' },
      { content: '23 passengers treated for minor injuries at scene.', source_name: 'Ambulance Service' },
      { content: 'Investigation focuses on signal fault or track defect.', source_name: 'Transport Safety Board' },
    ],
  },
  {
    title: 'Telecom outage — mobile services down nationwide',
    status: 'developing',
    updates: [
      { content: 'Major carrier reports loss of service for 4M subscribers.', source_name: 'Telecom Regulator' },
      { content: 'Core routing issue identified; estimated 4-hour repair window.', source_name: 'Carrier Engineering Team' },
    ],
  },
];

// ── Entry point ────────────────────────────────────────────────

async function main() {
  console.log(`Starting ingestion of ${SEED_EVENTS.length} events...\n`);

  for (const payload of SEED_EVENTS) {
    await ingestEvent(payload);
  }

  console.log('\nIngestion complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
