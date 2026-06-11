import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  SignalLeadStatus,
  SignalLeadSubmitResult,
  UserReputation,
  UserSignalLead,
} from '../types';

interface UseSignalLeadResult {
  /** Submit a text lead for the pipeline to evaluate. */
  submitLead: (content: string, contextEventId?: string) => Promise<SignalLeadSubmitResult | null>;
  /** Most-recent lead submissions by this user. */
  leads: UserSignalLead[];
  /** User's current reputation state. */
  reputation: UserReputation | null;
  submitting: boolean;
  loading: boolean;
  error: string | null;
  /** Re-fetch leads + reputation from the server. */
  refetch: () => void;
}

/**
 * Hook for the user signal lead feature.
 *
 * Exposes:
 *   - submitLead: calls submit_signal_lead RPC (auth.uid() resolved server-side).
 *     Returns the JSONB result directly so the UI can show rate-limit messages,
 *     block notices, and success confirmation. Returns null on network error.
 *   - leads: recent submissions from get_my_signal_leads RPC.
 *   - reputation: from get_my_reputation RPC.
 *
 * After a successful pending submission, the local leads list is prepended
 * optimistically rather than waiting for a refetch.
 *
 * Pass userId=null (unauthenticated) → all state is empty, submitLead is a no-op.
 */
export function useSignalLead(userId: string | null): UseSignalLeadResult {
  const [leads, setLeads]           = useState<UserSignalLead[]>([]);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading]       = useState(userId !== null);
  const [error, setError]           = useState<string | null>(null);
  const [tick, setTick]             = useState(0);
  const mountedRef                  = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setLeads([]);
      setReputation(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      supabase.rpc('get_my_signal_leads', { p_limit: 20, p_offset: 0 }),
      supabase.rpc('get_my_reputation'),
    ]).then(([leadsResult, repResult]) => {
      if (cancelled) return;

      if (leadsResult.error) {
        if (__DEV__) console.error('[useSignalLead] leads fetch:', leadsResult.error.message);
        setError('Unable to load your leads');
      } else {
        setLeads((leadsResult.data as UserSignalLead[]) ?? []);
      }

      if (repResult.error) {
        if (__DEV__) console.error('[useSignalLead] reputation fetch:', repResult.error.message);
      } else {
        const rows = repResult.data as UserReputation[];
        setReputation(rows?.[0] ?? null);
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId, tick]);

  const submitLead = useCallback(
    async (content: string, contextEventId?: string): Promise<SignalLeadSubmitResult | null> => {
      if (!userId) return null;

      setSubmitting(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('submit_signal_lead', {
        p_content:           content,
        p_context_event_id:  contextEventId ?? null,
      });

      if (!mountedRef.current) return null;
      setSubmitting(false);

      if (rpcError) {
        // Surface Postgres validation errors (min length, max length, auth) directly.
        const message = rpcError.message ?? 'Failed to submit lead';
        setError(message);
        return null;
      }

      const result = data as SignalLeadSubmitResult;

      // Optimistically prepend the new lead to the local list if it was accepted.
      // rate_limited and blocked submissions are still added for visibility.
      const optimisticLead: UserSignalLead = {
        id:               result.lead_id,
        content:          content.trim(),
        status:           result.status as SignalLeadStatus,
        context_event_id: contextEventId ?? null,
        matched_event_id: null,
        rejection_reason: null,
        reputation_impact: 0,
        created_at:       new Date().toISOString(),
        processed_at:     null,
      };

      setLeads(prev => [optimisticLead, ...prev]);

      return result;
    },
    [userId],
  );

  const refetch = useCallback(() => setTick(t => t + 1), []);

  return { submitLead, leads, reputation, submitting, loading, error, refetch };
}
