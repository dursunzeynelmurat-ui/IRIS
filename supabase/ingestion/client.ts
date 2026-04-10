/**
 * IRIS Ingestion — Service-Role Supabase Client
 *
 * Ingestion workers must use the service_role key. This bypasses RLS and is
 * the only credential authorized to execute ingest_event (REVOKED from PUBLIC,
 * GRANT to service_role — migration 011).
 *
 * This module is server/script-side only. Never import it from the mobile app.
 * The mobile app uses the anon key via src/lib/supabase.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

export function createIngestionClient(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error(
      '[ingestion] Missing env vars: EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env',
    );
    process.exit(1);
  }

  return createClient(url, key);
}
