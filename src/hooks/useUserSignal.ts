import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SignalType } from '../types';

interface UseUserSignalResult {
  currentSignal: SignalType | null;
  submitting: boolean;
  error: string | null;
  submitSignal: (type: SignalType) => Promise<void>;
}

export function useUserSignal(
  eventId: string,
  userId: string | null,
): UseUserSignalResult {
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the user's existing signal when userId is known
  useEffect(() => {
    if (!userId) {
      setCurrentSignal(null);
      return;
    }

    supabase
      .from('signals')
      .select('type')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: dbError }) => {
        if (dbError) {
          console.error('[useUserSignal] fetch:', dbError);
          return; // non-critical; buttons still render, signal just defaults to null
        }
        setCurrentSignal((data?.type as SignalType) ?? null);
      });
  }, [eventId, userId]);

  async function submitSignal(type: SignalType) {
    if (!userId) return;
    // No-op: user tapped the already-active button
    if (type === currentSignal) return;

    const previous = currentSignal;
    setCurrentSignal(type); // optimistic update
    setSubmitting(true);
    setError(null);

    const { error: upsertError } = await supabase
      .from('signals')
      .upsert(
        { user_id: userId, event_id: eventId, type },
        { onConflict: 'user_id,event_id' },
      );

    if (upsertError) {
      console.error('[useUserSignal] upsert:', upsertError);
      setCurrentSignal(previous); // revert optimistic update
      setError('Could not save signal. Please try again.');
      setSubmitting(false);
      return;
    }

    // Recalculate trust score server-side.
    // The realtime channel in useEventDetail will pick up the resulting
    // events.trust_score UPDATE automatically — no manual refetch needed.
    const { error: rpcError } = await supabase.rpc('recalculate_trust_score', {
      p_event_id: eventId,
    });

    if (rpcError) {
      // Signal saved; only score recalc failed — non-fatal, log it
      console.error('[useUserSignal] recalculate_trust_score:', rpcError);
    }

    setSubmitting(false);
  }

  return { currentSignal, submitting, error, submitSignal };
}
