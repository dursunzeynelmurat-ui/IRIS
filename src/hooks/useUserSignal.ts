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
  onScoreUpdated: () => void,
): UseUserSignalResult {
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the user's existing signal for this event
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
      .then(({ data }) => {
        setCurrentSignal((data?.type as SignalType) ?? null);
      });
  }, [eventId, userId]);

  async function submitSignal(type: SignalType) {
    if (!userId) return;

    const previous = currentSignal;
    setCurrentSignal(type); // optimistic update
    setSubmitting(true);
    setError(null);

    // Upsert: INSERT on first signal, UPDATE on subsequent ones.
    // onConflict matches the UNIQUE(user_id, event_id) constraint.
    const { error: upsertError } = await supabase
      .from('signals')
      .upsert(
        { user_id: userId, event_id: eventId, type },
        { onConflict: 'user_id,event_id' },
      );

    if (upsertError) {
      setCurrentSignal(previous); // revert optimistic update
      setError(upsertError.message);
      setSubmitting(false);
      return;
    }

    // Recalculate trust score server-side (Step 6)
    const { error: rpcError } = await supabase.rpc('recalculate_trust_score', {
      p_event_id: eventId,
    });

    if (rpcError) {
      // Signal was saved correctly; only score update failed — non-critical
      setError(`Signal saved, but score update failed: ${rpcError.message}`);
    }

    onScoreUpdated(); // tell the caller to refresh the event header
    setSubmitting(false);
  }

  return { currentSignal, submitting, error, submitSignal };
}
