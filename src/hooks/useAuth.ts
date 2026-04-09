import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseAuthResult {
  userId: string | null;
  loading: boolean;
}

export function useAuth(): UseAuthResult {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { userId, loading };
}
