import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const MAX_LENGTH    = 140;
const COOLDOWN_SECS = 30;

export interface UseSignalSubmissionResult {
  submitting: boolean;
  success: boolean;
  error: string | null;
  cooldownRemaining: number;
  submit: (content: string, eventId?: string) => Promise<void>;
  reset: () => void;
}

export function useSignalSubmission(userId: string | null): UseSignalSubmissionResult {
  const [submitting, setSubmitting]               = useState(false);
  const [success, setSuccess]                     = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const mountedRef       = useRef(true);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const submit = useCallback(async (content: string, eventId?: string) => {
    if (!userId) {
      setError('You must be signed in to submit a signal.');
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

    const { data, error: rpcError } = await supabase.rpc('submit_signal_lead', {
      p_content:          trimmed,
      p_context_event_id: eventId ?? null,
    });

    if (!mountedRef.current) return;

    if (rpcError) {
      if (__DEV__) console.error('[useSignalSubmission]', rpcError);
      setError(rpcError.message ?? 'Could not submit signal. Please try again.');
    } else {
      const result = data as { status?: string; message?: string } | null;
      if (result?.status === 'rate_limited' || result?.status === 'blocked') {
        setError(result.message ?? 'Submission not accepted. Please try again later.');
      } else {
        setSuccess(true);
        // Client-side cooldown prevents rapid re-submission before the server
        // rate-limit window resets.
        if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
        let remaining = COOLDOWN_SECS;
        setCooldownRemaining(remaining);
        cooldownTimerRef.current = setInterval(() => {
          remaining -= 1;
          if (mountedRef.current) setCooldownRemaining(remaining);
          if (remaining <= 0) {
            clearInterval(cooldownTimerRef.current!);
            cooldownTimerRef.current = null;
          }
        }, 1000);
      }
    }

    setSubmitting(false);
  }, [userId]);

  const reset = useCallback(() => {
    setSuccess(false);
    setError(null);
    // Cooldown persists across resets — user must wait before submitting again.
  }, []);

  return { submitting, success, error, cooldownRemaining, submit, reset };
}
