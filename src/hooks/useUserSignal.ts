import { useEffect, useState } from 'react';
import { castSignal } from '../services/signalService';
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

    try {
      await castSignal(userId, eventId, type);
    } catch (err) {
      console.error('[useUserSignal] castSignal:', err);
      setCurrentSignal(previous); // revert optimistic update
      setError('Could not save signal. Please try again.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
  }

  return { currentSignal, submitting, error, submitSignal };
}
