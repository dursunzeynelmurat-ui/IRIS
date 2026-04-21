import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FeedTab } from '../types';

const DEFAULT_FEED: FeedTab = 'new';

interface FeedPreferenceContextValue {
  defaultFeed: FeedTab;
  setDefaultFeed: (tab: FeedTab) => void;
}

const FeedPreferenceContext = createContext<FeedPreferenceContextValue | null>(null);

interface FeedPreferenceProviderProps {
  children: ReactNode;
  /**
   * Backend-persisted preference from useUserPreferences(). When provided,
   * the provider syncs to it once on mount and on subsequent changes.
   */
  savedFeed?: FeedTab;
  /**
   * Called whenever the user selects a new default feed. Optimistic — reverts
   * automatically if this throws.
   */
  onSaveFeed?: (tab: FeedTab) => Promise<void>;
}

export function FeedPreferenceProvider({
  children,
  savedFeed,
  onSaveFeed,
}: FeedPreferenceProviderProps) {
  const [defaultFeed, setDefaultFeedState] = useState<FeedTab>(savedFeed ?? DEFAULT_FEED);
  const hasSyncedRef = useRef(false);

  // Sync once when savedFeed loads from the DB (undefined → actual value).
  // After that, local state is the source of truth (optimistic updates).
  useEffect(() => {
    if (savedFeed !== undefined && !hasSyncedRef.current) {
      hasSyncedRef.current = true;
      setDefaultFeedState(savedFeed);
    }
  }, [savedFeed]);

  const setDefaultFeed = useCallback((tab: FeedTab) => {
    const previous = defaultFeed;
    setDefaultFeedState(tab);
    if (onSaveFeed) {
      onSaveFeed(tab).catch(() => setDefaultFeedState(previous));
    }
  }, [defaultFeed, onSaveFeed]);

  const value = useMemo(
    () => ({ defaultFeed, setDefaultFeed }),
    [defaultFeed, setDefaultFeed],
  );

  return (
    <FeedPreferenceContext.Provider value={value}>
      {children}
    </FeedPreferenceContext.Provider>
  );
}

export function useFeedPreference(): FeedPreferenceContextValue {
  const ctx = useContext(FeedPreferenceContext);
  if (!ctx) throw new Error('useFeedPreference must be used inside FeedPreferenceProvider');
  return ctx;
}
