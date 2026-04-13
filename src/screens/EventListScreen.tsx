import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
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
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { MIN_QUERY_LEN, useEventSearch } from '../hooks/useEventSearch';
import { useEvents } from '../hooks/useEvents';
import { useRisingEvents } from '../hooks/useRisingEvents';
import { useUserSignals } from '../hooks/useUserSignals';
import { Event } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

// ── Feed tab types ────────────────────────────────────────────

type FeedTab = 'new' | 'verified' | 'rising';

interface Tab {
  key: FeedTab;
  label: string;
}

const TABS: Tab[] = [
  { key: 'new',      label: 'New'      },
  { key: 'verified', label: 'Verified' },
  { key: 'rising',   label: 'Rising'   },
];

// ── Tab filtering — New and Verified only ─────────────────────
// Rising is backend-driven (useRisingEvents). New/Verified derive
// from the live events feed without an extra network call.

function filterByTab(events: Event[], tab: Exclude<FeedTab, 'rising'>): Event[] {
  switch (tab) {
    case 'new':
      return [...events].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'verified':
      return events.filter((e) => e.status === 'verified');
  }
}

// ── Screen ────────────────────────────────────────────────────

export function EventListScreen({ navigation }: Props) {
  const { events, loading, refreshing, error, refetch }                        = useEvents();
  const { userId }                                                               = useAuth();
  const { signalMap, setSignal }                                                 = useUserSignals(userId);
  const { colors }                                                               = useTheme();

  const [activeTab, setActiveTab] = useState<FeedTab>('new');

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isSearching,
    loading: searchLoading,
    error: searchError,
    clearQuery: clearSearch,
  } = useEventSearch();

  const {
    events: risingEvents,
    loading: risingLoading,
    refreshing: risingRefreshing,
    error: risingError,
    refetch: refetchRising,
  } = useRisingEvents();

  // ── Displayed data ────────────────────────────────────────────
  // Search overrides tabs. Rising is served by the backend hook.
  // New/Verified derive from the live feed.
  const displayed: Event[] = isSearching
    ? searchResults
    : activeTab === 'rising'
      ? risingEvents
      : filterByTab(events, activeTab);

  function handleClearSearch() {
    clearSearch();
    Keyboard.dismiss();
  }

  function handleTabPress(key: FeedTab) {
    if (isSearching) {
      // Tapping a tab while searching clears search and switches tab.
      handleClearSearch();
    }
    setActiveTab(key);
  }

  // ── Full-screen states ────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>
          Unable to load events.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { borderColor: colors.borderStrong }]}
          onPress={refetch}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading events"
        >
          <Text style={[styles.retryText, { color: colors.textPrimary }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Search bar color tokens ────────────────────────────────────
  // bgInput is bgElevated in dark and white in light — correct for both themes.
  const inputBorder = isSearching ? colors.iris + '60' : colors.border;

  // ── Empty / loading state for the list area ───────────────────
  function renderEmpty() {
    if (isSearching) {
      // Loading: first search, results not yet arrived.
      if (searchLoading) {
        return (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        );
      }
      // Backend error.
      if (searchError) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Search unavailable.
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Check your connection and try again.
            </Text>
          </View>
        );
      }
      // Query too short — hasn't been sent yet.
      if (searchQuery.trim().length < MIN_QUERY_LEN) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Type at least 2 characters to search.
            </Text>
          </View>
        );
      }
      // Sent and returned empty.
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No events match "{searchQuery.trim()}".
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
            Try a different keyword.
          </Text>
        </View>
      );
    }

    if (activeTab === 'rising') {
      if (risingLoading) {
        return (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        );
      }
      if (risingError) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Unable to load rising events.
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { borderColor: colors.borderStrong, marginTop: 12 }]}
              onPress={refetchRising}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry loading rising events"
            >
              <Text style={[styles.retryText, { color: colors.textPrimary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Nothing developing yet.
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
            Stories gain momentum from source coverage, trust signals, and engagement.
          </Text>
        </View>
      );
    }

    // New / Verified tabs.
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {activeTab === 'new' ? 'No events yet.' : 'No verified events yet.'}
        </Text>
        <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
          {activeTab === 'new'
            ? 'Pull down to refresh.'
            : 'Verified events appear here once confirmed.'}
        </Text>
      </View>
    );
  }

  // RefreshControl: for the Rising tab, pull-to-refresh re-fetches rising data.
  const isRisingActive = activeTab === 'rising' && !isSearching;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>

      {/* ── Search bar ────────────────────────────────────────── */}
      <View style={[styles.searchRow, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.searchInputWrapper,
            {
              backgroundColor: colors.bgInput,
              borderColor: inputBorder,
            },
          ]}
        >
          {/* Lens icon — Unicode, no native dependency */}
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
          {/* Loading spinner replaces clear button while a search request is in-flight. */}
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

      {/* ── Feed tabs ─────────────────────────────────────────── */}
      <View
        style={[
          styles.tabBar,
          {
            borderBottomColor: colors.border,
            backgroundColor: colors.bg,
            opacity: isSearching ? 0.45 : 1,
          },
        ]}
        accessibilityRole="tablist"
        accessibilityLabel="Feed tabs — tap to switch view or clear search"
      >
        {TABS.map(({ key, label }) => {
          const isActive = !isSearching && activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => handleTabPress(key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={`${label} events`}
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isActive ? colors.iris : colors.textTertiary,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {label}
              </Text>
              {isActive && (
                <View style={[styles.tabIndicator, { backgroundColor: colors.iris }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Event list ────────────────────────────────────────── */}
      <FlatList
        style={styles.list}
        data={displayed}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            userId={userId!}
            initialSignal={signalMap.get(item.id) ?? null}
            onSignalCast={(type) => setSignal(item.id, type)}
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
            refreshing={isRisingActive ? risingRefreshing : refreshing}
            onRefresh={isRisingActive ? refetchRising : refetch}
            tintColor={colors.textSecondary}
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

  // ── Search bar ──
  searchRow: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    gap: 6,
  },
  searchIcon: {
    fontSize: 16,
    lineHeight: 18,
    marginTop: -1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearIcon: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 14,
  },

  // ── Feed tabs ──
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 13,
    letterSpacing: 0.1,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 2,
    borderRadius: 1,
  },

  // ── List ──
  list: {
    flex: 1,
  },
  listContent: {
    padding: 14,
  },
  centeredFlex: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  separator: {
    height: 10,
  },

  // ── Empty / inline error ──
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
  },

  // ── Full-screen error / inline retry ──
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
