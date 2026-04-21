import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const MAX_LENGTH       = 140;
const COOLDOWN_SECONDS = 300; // 5 minutes between submissions

export interface UseSignalSubmissionResult {
  submitting: boolean;
  success: boolean;
  error: string | null;
  /** Seconds remaining in the cooldown period; 0 when submissions are allowed. */
  cooldownRemaining: number;
  submit: (content: string, eventId?: string) => Promise<void>;
  reset: () => void;
}

export function useSignalSubmission(userId: string | null): UseSignalSubmissionResult {
  const [submitting, setSubmitting]             = useState(false);
  const [success, setSuccess]                   = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const lastSubmitRef  = useRef<number>(0);
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startCooldown() {
    lastSubmitRef.current = Date.now();
    setCooldownRemaining(COOLDOWN_SECONDS);

    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      const elapsed   = Math.floor((Date.now() - lastSubmitRef.current) / 1000);
      const remaining = Math.max(0, COOLDOWN_SECONDS - elapsed);
      setCooldownRemaining(remaining);
      if (remaining === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1000);
  }

  const submit = useCallback(async (content: string, eventId?: string) => {
    if (!userId) {
      setError('You must be signed in to submit a signal.');
      return;
    }
    if (cooldownRemaining > 0) {
      setError(`Please wait ${cooldownRemaining}s before submitting another signal.`);
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) { setError('Signal cannot be empty.'); return; }
    if (trimmed.length > MAX_LENGTH) {
      setError(`Signal must be ${MAX_LENGTH} characters or fewer.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: { user_id: string; content: string; event_id?: string } = {
      user_id: userId,
      content: trimmed,
    };
    if (eventId) payload.event_id = eventId;

    const { error: dbError } = await supabase
      .from('signal_submissions')
      .insert(payload);

    if (dbError) {
      if (__DEV__) console.error('[useSignalSubmission]', dbError);
      setError('Could not submit signal. Please try again.');
    } else {
      setSuccess(true);
      startCooldown();
    }

    setSubmitting(false);
  }, [userId, cooldownRemaining]);

  const reset = useCallback(() => {
    setSuccess(false);
    setError(null);
  }, []);

  return { submitting, success, error, cooldownRemaining, submit, reset };
}
