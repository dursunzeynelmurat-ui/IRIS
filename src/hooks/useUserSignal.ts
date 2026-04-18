import { useEffect, useState } from 'react';
import { castSignal } from '../services/signalService';
import { supabase } from '../lib/supabase';
import { SignalType } from '../types';

interface UseUserSignalResult {
  currentSignal: SignalType | null;
  fetchLoading: boolean;
  submitting: boolean;
  error: string | null;
  submitSignal: (type: SignalType) => Promise<void>;
}

const VALID_SIGNAL_TYPES = new Set<string>(['confirm', 'dispute']);

export function useUserSignal(
  eventId: string,
  userId: string | null,
): UseUserSignalResult {
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(null);
  const [fetchLoading, setFetchLoading]   = useState(!!userId);
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);

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
          if (__DEV__) console.error('[useUserSignal] fetch:', dbError);
        } else {
          const rawType = data?.type;
          setCurrentSignal(
            rawType && VALID_SIGNAL_TYPES.has(rawType) ? (rawType as SignalType) : null,
          );
        }
        setFetchLoading(false);
      });

    return () => { mounted = false; };
  }, [eventId, userId]);

  async function submitSignal(type: SignalType) {
    if (!userId) return;
    if (type === currentSignal) return;

    const previous = currentSignal;
    setCurrentSignal(type);
    setSubmitting(true);
    setError(null);

    try {
      await castSignal(userId, eventId, type);
    } catch (err) {
      if (__DEV__) console.error('[useUserSignal] castSignal:', err);
      setCurrentSignal(previous);
      setError('Could not save signal. Please try again.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
  }

  return { currentSignal, fetchLoading, submitting, error, submitSignal };
}
