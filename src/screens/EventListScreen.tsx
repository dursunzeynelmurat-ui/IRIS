import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';
import { useFeedPreference } from '../context/FeedPreferenceContext';
import { useTheme } from '../context/ThemeContext';
import { MIN_QUERY_LEN, useEventSearch } from '../hooks/useEventSearch';
import { useEvents } from '../hooks/useEvents';
import { useRisingEvents } from '../hooks/useRisingEvents';
import { useVerifiedEvents } from '../hooks/useVerifiedEvents';
import { Event, FeedTab } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

// ── Feed tab types ────────────────────────────────────────────

interface Tab {
  key: FeedTab;
  label: string;
}

const TABS: Tab[] = [
  { key: 'new',      label: 'New'      },
  { key: 'verified', label: 'Verified' },
  { key: 'rising',   label: 'Rising'   },
];

// ── Screen ────────────────────────────────────────────────────

export function EventListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { defaultFeed } = useFeedPreference();

  // Initialize from the user's stored preference.
  // A one-time sync handles the edge case where the preference loads
  // from the DB after this component first mounts.
  const [activeTab, setActiveTab] = useState<FeedTab>(defaultFeed);
  const tabInitializedRef = useRef(false);

  useEffect(() => {
    if (!tabInitializedRef.current) {
      tabInitializedRef.current = true;
      setActiveTab(defaultFeed);
    }
  }, [defaultFeed]);

  // New: all events ordered by latest activity (backend-ordered)
  const { events, loading, refreshing, error, refetch } = useEvents();

  // Verified: backend-filtered to status='verified', no local slice
  const {
    events: verifiedEvents,
    loading: verifiedLoading,
    refreshing: verifiedRefreshing,
    error: verifiedError,
    refetch: refetchVerified,
  } = useVerifiedEvents();

  // Rising: backend RPC
  const {
    events: risingEvents,
    loading: risingLoading,
    refreshing: risingRefreshing,
    error: risingError,
    refetch: refetchRising,
  } = useRisingEvents();

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isSearching,
    loading: searchLoading,
    error: searchError,
    clearQuery: clearSearch,
  } = useEventSearch();

  // ── Displayed data ────────────────────────────────────────────

  const displayed: Event[] = isSearching
    ? searchResults
    : activeTab === 'rising'
      ? risingEvents
      : activeTab === 'verified'
        ? verifiedEvents
        : events;

  function handleClearSearch() {
    clearSearch();
    Keyboard.dismiss();
  }

  function handleTabPress(key: FeedTab) {
    if (isSearching) handleClearSearch();
    setActiveTab(key);
  }

  // ── Full-screen states ────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.fullCentered, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.iris} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.fullCentered, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>
          Unable to load events.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { borderColor: colors.iris }]}
          onPress={refetch}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading events"
        >
          <Text style={[styles.retryText, { color: colors.iris }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Search border ──────────────────────────────────────────────
  const searchBorder = isSearching ? colors.iris : colors.border;

  // ── Active event count ────────────────────────────────────────
  const eventCount = events.length;

  // ── Per-tab refresh state ──────────────────────────────────────
  const isRisingActive   = activeTab === 'rising'   && !isSearching;
  const isVerifiedActive = activeTab === 'verified' && !isSearching;

  const activeRefreshing = isRisingActive
    ? risingRefreshing
    : isVerifiedActive
      ? verifiedRefreshing
      : refreshing;

  const activeRefetch = isRisingActive
    ? refetchRising
    : isVerifiedActive
      ? refetchVerified
      : refetch;

  // ── Empty state renderer ──────────────────────────────────────
  function renderEmpty() {
    if (isSearching) {
      if (searchLoading) return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={colors.iris} />
        </View>
      );
      if (searchError) return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Search unavailable.</Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Check your connection and try again.</Text>
        </View>
      );
      if (searchQuery.trim().length < MIN_QUERY_LEN) return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Type at least 2 characters to search.</Text>
        </View>
      );
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No events match "{searchQuery.trim()}".</Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Try a different keyword.</Text>
        </View>
      );
    }

    if (activeTab === 'rising') {
      if (risingLoading) return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={colors.iris} />
        </View>
      );
      if (risingError) return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Unable to load rising events.</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.iris, marginTop: 12 }]}
            onPress={refetchRising}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading rising events"
          >
            <Text style={[styles.retryText, { color: colors.iris }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Nothing rising yet.</Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Stories gain momentum from source coverage and engagement.</Text>
        </View>
      );
    }

    if (activeTab === 'verified') {
      if (verifiedLoading) return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={colors.iris} />
        </View>
      );
      if (verifiedError) return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Unable to load verified events.</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.iris, marginTop: 12 }]}
            onPress={refetchVerified}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading verified events"
          >
            <Text style={[styles.retryText, { color: colors.iris }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No verified events yet.</Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Verified events are confirmed by multiple independent sources.</Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No events yet.</Text>
        <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Pull down to refresh.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>

      {/* ── Custom header ─────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.bgElevated,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Wordmark */}
        <Text style={[styles.wordmark, { color: colors.iris }]}>IRIS</Text>

        {/* Menu icon — three horizontal lines */}
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation.navigate('Profile')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <View style={[styles.menuLine, { backgroundColor: colors.textSecondary }]} />
          <View style={[styles.menuLine, { backgroundColor: colors.textSecondary }]} />
          <View style={[styles.menuLine, { backgroundColor: colors.textSecondary }]} />
        </TouchableOpacity>
      </View>

      {/* ── Search bar ────────────────────────────────────────── */}
      <View style={[styles.searchRow, { backgroundColor: colors.bgElevated }]}>
        <View
          style={[
            styles.searchInputWrapper,
            { backgroundColor: colors.bgInput, borderColor: searchBorder },
          ]}
        >
          <Text style={[styles.searchIcon, { color: colors.textTertiary }]}>⌕</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search events…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            clearButtonMode="never"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search events"
            accessibilityHint="Searches events via backend"
          />
          {isSearching && (
            searchLoading ? (
              <ActivityIndicator size="small" color={colors.textTertiary} />
            ) : (
              <TouchableOpacity
                onPress={handleClearSearch}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Text style={[styles.clearIcon, { color: colors.textTertiary }]}>✕</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>

      {/* ── Segmented tab selector ────────────────────────────── */}
      <View
        style={[
          styles.tabRow,
          { backgroundColor: colors.bgElevated, borderBottomColor: colors.border },
        ]}
        accessibilityRole="tablist"
        accessibilityLabel="Feed tabs"
      >
        {TABS.map(({ key, label }) => {
          const isActive = !isSearching && activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.tab,
                isActive && [styles.tabActive, { backgroundColor: colors.iris }],
              ]}
              onPress={() => handleTabPress(key)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityLabel={`${label} events`}
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isActive ? '#FFFFFF' : colors.textTertiary,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Context row: event count ──────────────────────────── */}
      {!isSearching && activeTab === 'new' && eventCount > 0 && (
        <View style={[styles.contextRow, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <Text style={[styles.contextText, { color: colors.textTertiary }]}>
            {eventCount} active {eventCount === 1 ? 'event' : 'events'}
          </Text>
        </View>
      )}

      {/* ── Event list ────────────────────────────────────────── */}
      <FlatList
        style={styles.list}
        data={displayed}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            onPress={() => {
              Keyboard.dismiss();
              navigation.navigate('EventDetail', { eventId: item.id });
            }}
          />
        )}
        contentContainerStyle={
          displayed.length === 0 ? styles.centeredFlex : styles.listContent
        }
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={activeRefreshing}
            onRefresh={activeRefetch}
            tintColor={colors.iris}
          />
        }
        ListEmptyComponent={renderEmpty()}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <BottomTabBar />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── Custom header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wordmark: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
  },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  menuLine: {
    width: 20,
    height: 1.5,
    borderRadius: 1,
  },

  // ── Search bar ──
  searchRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchIcon: {
    fontSize: 17,
    lineHeight: 19,
    marginTop: -1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearIcon: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Tab selector ──
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
  },
  tabActive: {
    // backgroundColor set dynamically
  },
  tabLabel: {
    fontSize: 14,
    letterSpacing: 0.1,
  },

  // ── Context row ──
  contextRow: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contextText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  // ── List ──
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 12,
  },
  centeredFlex: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  fullCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // ── Empty states ──
  emptyContainer: {
    alignItems: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },

  // ── Error / retry ──
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
