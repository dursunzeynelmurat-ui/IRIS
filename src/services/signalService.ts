import { supabase } from '../lib/supabase';
import type { SignalType } from '../types';

/**
 * Upserts a user signal for an event, then recalculates the trust score
 * server-side via RPC. The Realtime channel in useEvents picks up the
 * resulting trust_score UPDATE automatically — no manual refresh needed.
 *
 * RLS requires the authenticated user's real ID; a mock/hardcoded ID
 * would be rejected by the `auth.uid() = user_id` policy.
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

  const { error: rpcError } = await supabase.rpc('recalculate_trust_score', {
    p_event_id: eventId,
  });

  if (rpcError) {
    // Non-fatal: signal saved. Score corrects on next fetch.
    console.error('[castSignal] recalculate_trust_score:', rpcError);
  }
}
