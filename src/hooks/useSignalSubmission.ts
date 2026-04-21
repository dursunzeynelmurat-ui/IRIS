import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const MAX_LENGTH = 140;

export interface UseSignalSubmissionResult {
  submitting: boolean;
  success: boolean;
  error: string | null;
  submit: (content: string, eventId?: string) => Promise<void>;
  reset: () => void;
}

export function useSignalSubmission(userId: string | null): UseSignalSubmissionResult {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const mountedRef                  = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
      }
    }

    setSubmitting(false);
  }, [userId]);

  const reset = useCallback(() => {
    setSuccess(false);
    setError(null);
  }, []);

  return { submitting, success, error, submit, reset };
}
