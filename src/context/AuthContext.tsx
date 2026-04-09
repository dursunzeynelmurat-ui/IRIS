/**
 * AuthContext — single source of truth for authentication state.
 *
 * Only ONE Supabase `onAuthStateChange` subscription is created for the entire
 * app lifetime (inside AuthProvider). Consuming `useAuth()` in any number of
 * screens reads from this shared context and creates no additional subscriptions.
 *
 * Usage:
 *   // Root:
 *   <AuthProvider><App /></AuthProvider>
 *
 *   // Any screen:
 *   const { userId, loading } = useAuth();
 */

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthContextValue {
  userId: string | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ userId: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('[AuthProvider] getSession:', error);
      setUserId(data.session?.user.id ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ userId, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
