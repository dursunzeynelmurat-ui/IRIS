/**
 * IRIS Ingestion — SampleAdapter
 *
 * Returns hardcoded mock events for development and testing.
 *
 * Use this adapter to:
 *   - Verify the full ingestion pipeline (fetch → normalize → write) without
 *     a real external source
 *   - Populate a local or development Supabase instance with realistic events
 *   - Run dry-run checks to confirm normalization behavior
 *
 * Items are expressed as RawSourceItem (adapter output shape), not as
 * NormalizedEvent. They pass through the full normalize → write pipeline,
 * exercising the same code path a real adapter would.
 *
 * Adding new adapters:
 *   1. Create adapters/<name>.ts implementing SourceAdapter
 *   2. Add it to the ADAPTERS registry in run.ts
 *   3. Use --adapter=<name> to select it
 */

import type { SourceAdapter, RawSourceItem } from '../types';

const SAMPLE_ITEMS: RawSourceItem[] = [
  {
    headline: 'Flooding reported in northern districts',
    status: 'emerging',
    content: 'Heavy rainfall causing road closures in 3 districts.',
    source_name: 'Reuters',
    additional_updates: [
      {
        content: 'Local emergency services deployed to affected areas.',
        source_name: 'BBC',
        source_url: 'https://bbc.com',
      },
    ],
  },
  {
    headline: 'Power grid outage — eastern region',
    status: 'developing',
    content: 'Large-scale blackout affecting 200,000 homes reported.',
    source_name: 'AP News',
    additional_updates: [
      { content: 'Utility company confirms transformer failure as cause.', source_name: 'Local Grid Authority' },
      { content: 'Restoration estimated within 6 hours.', source_name: 'Reuters' },
    ],
  },
  {
    headline: 'Wildfire spreading near coastal forest',
    status: 'developing',
    content: 'Fire spotted at 14:00 local time, wind conditions worsening.',
    source_name: 'National Fire Service',
    additional_updates: [
      { content: 'Evacuation orders issued for 3 villages.', source_name: 'Government Press Office' },
    ],
  },
  {
    headline: 'Earthquake — magnitude 5.4, depth 12km',
    status: 'verified',
    content: 'USGS confirms 5.4 magnitude event near capital region.',
    source_name: 'USGS',
    source_url: 'https://usgs.gov',
    additional_updates: [
      { content: 'No structural damage reported in city center.', source_name: 'Civil Protection Agency' },
      { content: 'Aftershock of 3.1 recorded 2 hours later.', source_name: 'Seismology Institute' },
    ],
  },
  {
    headline: 'Chemical spill on Highway 7 — hazmat response active',
    status: 'developing',
    content: 'Truck overturned, unknown substance leaking onto road.',
    source_name: 'Police Scanner',
    additional_updates: [
      { content: 'Hazmat team arrived, 2km exclusion zone established.', source_name: 'Fire Department' },
    ],
  },
  {
    headline: 'Bridge closure — structural inspection triggered',
    status: 'verified',
    content: 'Engineers detected cracks in main support beam during routine check.',
    source_name: 'Transport Ministry',
    additional_updates: [
      { content: 'Bridge closed to all traffic indefinitely pending full assessment.', source_name: 'City Council' },
      { content: 'Alternative routes identified; congestion expected.', source_name: 'Traffic Authority' },
    ],
  },
  {
    headline: 'Hospital cyberattack — systems partially offline',
    status: 'emerging',
    content: 'Regional hospital reports IT systems compromised.',
    source_name: 'Anonymous Source',
    additional_updates: [
      { content: 'Patient records system restored; surgery schedule delayed.', source_name: 'Hospital PR' },
    ],
  },
  {
    headline: 'Protest blocks city center — police deployed',
    status: 'developing',
    content: 'Estimated 3,000 demonstrators blocking main avenue.',
    source_name: 'Al Jazeera',
    additional_updates: [
      { content: 'Riot police deployed; no clashes reported yet.', source_name: 'Reuters' },
      { content: 'Organizers claim peaceful intent, demand talks with government.', source_name: 'Protest Spokesperson' },
    ],
  },
  {
    headline: 'Water contamination advisory — district 4',
    status: 'verified',
    content: 'Elevated coliform bacteria levels detected in tap water samples.',
    source_name: 'Water Authority',
    additional_updates: [
      { content: 'Boil water notice issued for 80,000 residents.', source_name: 'Public Health Department' },
    ],
  },
  {
    headline: 'Aircraft emergency landing — airport closed',
    status: 'developing',
    content: 'Commercial flight declared emergency due to engine fault.',
    source_name: 'Air Traffic Control',
    additional_updates: [
      { content: 'Aircraft landed safely; all 187 passengers evacuated.', source_name: 'Airport Authority' },
      { content: 'Runway 2 closed pending inspection; delays expected.', source_name: 'Aviation Authority' },
    ],
  },
  {
    headline: 'Gas explosion — residential building',
    status: 'disputed',
    content: 'Explosion reported on 4th floor, cause unknown.',
    source_name: 'Emergency Services',
    additional_updates: [
      { content: 'Gas company denies pipeline fault; investigation ongoing.', source_name: 'Gas Company PR' },
      { content: 'Independent expert suspects faulty appliance, not main line.', source_name: 'Safety Inspector' },
    ],
  },
  {
    headline: 'Cargo ship grounded — port access disrupted',
    status: 'verified',
    content: 'Large container vessel ran aground at port entrance.',
    source_name: 'Coast Guard',
    additional_updates: [
      { content: 'Tugboats mobilized; refloating attempt scheduled for high tide.', source_name: 'Port Authority' },
    ],
  },
  {
    headline: 'Drone swarm sighted near airport — airspace restricted',
    status: 'emerging',
    content: 'Multiple unauthorized drones detected within 5km of runway.',
    source_name: 'Air Traffic Control',
    additional_updates: [
      { content: 'Police and counter-drone units deployed; origin unknown.', source_name: 'Police Statement' },
    ],
  },
  {
    headline: 'Train derailment — two carriages off track',
    status: 'developing',
    content: 'Passenger train derailed at 07:42; no fatalities confirmed.',
    source_name: 'Rail Authority',
    additional_updates: [
      { content: '23 passengers treated for minor injuries at scene.', source_name: 'Ambulance Service' },
      { content: 'Investigation focuses on signal fault or track defect.', source_name: 'Transport Safety Board' },
    ],
  },
  {
    headline: 'Telecom outage — mobile services down nationwide',
    status: 'developing',
    content: 'Major carrier reports loss of service for 4M subscribers.',
    source_name: 'Telecom Regulator',
    additional_updates: [
      { content: 'Core routing issue identified; estimated 4-hour repair window.', source_name: 'Carrier Engineering Team' },
    ],
  },
];

export class SampleAdapter implements SourceAdapter {
  readonly name = 'sample';

  async fetchItems(): Promise<RawSourceItem[]> {
    return SAMPLE_ITEMS;
  }
}
