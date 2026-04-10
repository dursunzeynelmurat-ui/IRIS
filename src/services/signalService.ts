import { supabase } from '../lib/supabase';
import type { SignalType } from '../types';

/**
 * Upserts a user signal for an event.
 *
 * trust_score is recalculated automatically by the DB trigger
 * `signals_sync_trust_score` (migration 006), which fires after every
 * INSERT or UPDATE on signals. No client-side RPC call is needed.
 *
 * The Realtime channel in useEvents picks up the resulting events UPDATE
 * automatically — no manual refresh needed.
 *
 * RLS requires the authenticated user's real ID; a wrong ID would be
 * rejected by the `auth.uid() = user_id` policy on signals.
 */
export async function castSignal(
  userId: string,
  eventId: string,
  type: SignalType,
): Promise<void> {
  const { error } = await supabase
    .from('signals')
    .upsert(
      { user_id: userId, event_id: eventId, type },
      { onConflict: 'user_id,event_id' },
    );

  if (error) throw error;
  // Trust score is recalculated atomically by the DB trigger on signals.
}
