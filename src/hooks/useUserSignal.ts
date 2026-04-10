import { useEffect, useState } from 'react';
import { castSignal } from '../services/signalService';
import { supabase } from '../lib/supabase';
import { SignalType } from '../types';

interface UseUserSignalResult {
  currentSignal: SignalType | null;
  /** True while the initial signal fetch is in-flight. */
  fetchLoading: boolean;
  submitting: boolean;
  error: string | null;
  submitSignal: (type: SignalType) => Promise<void>;
}

export function useUserSignal(
  eventId: string,
  userId: string | null,
): UseUserSignalResult {
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(null);
  // Start loading immediately if we have a userId — no fetch needed otherwise.
  const [fetchLoading, setFetchLoading] = useState(!!userId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the user's existing signal when userId is known
  useEffect(() => {
    if (!userId) {
      setCurrentSignal(null);
      setFetchLoading(false);
      return;
    }

    setFetchLoading(true);
    let mounted = true;

    supabase
      .from('signals')
      .select('type')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: dbError }) => {
        if (!mounted) return;
        if (dbError) {
          console.error('[useUserSignal] fetch:', dbError);
        } else {
          setCurrentSignal((data?.type as SignalType) ?? null);
        }
        setFetchLoading(false);
      });

    return () => { mounted = false; };
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

  return { currentSignal, fetchLoading, submitting, error, submitSignal };
}
