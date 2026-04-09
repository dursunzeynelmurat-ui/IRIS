/**
 * Thin re-export — all auth state is managed by a single AuthProvider instance.
 * Calling useAuth() anywhere in the tree consumes the shared context and does
 * NOT create a new Supabase subscription.
 */
export { useAuth } from '../context/AuthContext';
