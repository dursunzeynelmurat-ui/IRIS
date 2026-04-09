import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseAuthResult {
  userId: string | null;
}

export function useAuth(): UseAuthResult {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Read current session synchronously on mount
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });

    // Stay in sync if the user signs in or out elsewhere
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { userId };
}
