import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useRef, useState } from 'react';
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
import { useEvents } from '../hooks/useEvents';
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

// ── Tab filtering logic ───────────────────────────────────────

function filterByTab(events: Event[], tab: FeedTab): Event[] {
  switch (tab) {
    case 'new':
      return [...events].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'verified':
      return events.filter((e) => e.status === 'verified');
    case 'rising':
      // Developing stories gaining credibility — not yet verified.
      return events
        .filter((e) => e.status === 'emerging' || e.status === 'developing')
        .sort((a, b) => (b.trust_score ?? 0) - (a.trust_score ?? 0));
  }
}

// ── Client-side search ────────────────────────────────────────
// Case-insensitive substring match on title.
// Covers the common "I remember seeing something about X" retrieval pattern.
// When backend search lands (migration 021) this can swap to an RPC call.

function searchEvents(events: Event[], query: string): Event[] {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter((e) => e.title.toLowerCase().includes(q));
}

// ── Empty state messages ──────────────────────────────────────

function emptyMessage(tab: FeedTab, isSearching: boolean, query: string): string {
  if (isSearching) {
    return `No events match "${query.trim()}".`;
  }
  switch (tab) {
    case 'new':      return 'No events yet.';
    case 'verified': return 'No verified events yet.';
    case 'rising':   return 'Nothing developing yet.';
  }
}

function emptyHint(tab: FeedTab, isSearching: boolean): string {
  if (isSearching) return 'Try a different keyword.';
  switch (tab) {
    case 'new':      return 'Pull down to refresh.';
    case 'verified': return 'Verified events appear here once confirmed.';
    case 'rising':   return 'Emerging and developing stories appear here.';
  }
}

// ── Screen ────────────────────────────────────────────────────

export function EventListScreen({ navigation }: Props) {
  const { events, loading, refreshing, error, refetch } = useEvents();
  const { userId } = useAuth();
  const { signalMap, setSignal } = useUserSignals(userId);
  const { colors, resolved } = useTheme();

  const [activeTab, setActiveTab]   = useState<FeedTab>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const isSearching = searchQuery.trim().length > 0;

  // When searching, show matching events from the entire corpus, newest first.
  // When not searching, apply the active tab's filter.
  const displayed = useMemo(() => {
    if (isSearching) {
      const matched = searchEvents(events, searchQuery);
      return [...matched].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return filterByTab(events, activeTab);
  }, [events, activeTab, searchQuery, isSearching]);

  function clearSearch() {
    setSearchQuery('');
    Keyboard.dismiss();
  }

  function handleTabPress(key: FeedTab) {
    if (isSearching) {
      // Tapping a tab while searching clears the search and switches tab.
      clearSearch();
    }
    setActiveTab(key);
  }

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
  // Subtle appearance: same bg as the screen, border for definition.
  // Active: border brightens to borderStrong; tint changes to iris.
  const inputBg     = resolved === 'dark' ? colors.bgElevated : colors.bgInput;
  const inputBorder = isSearching ? colors.iris + '60' : colors.border;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>

      {/* ── Search bar ────────────────────────────────────────── */}
      <View style={[styles.searchRow, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.searchInputWrapper,
            {
              backgroundColor: inputBg,
              borderColor: inputBorder,
            },
          ]}
        >
          {/* Lens icon — Unicode, no native dependency */}
          <Text style={[styles.searchIcon, { color: colors.textTertiary }]}>⌕</Text>
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInput, { color: colors.textPrimary }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search events…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            clearButtonMode="never"   // we draw our own clear button
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search events"
            accessibilityHint="Filters the event list by keyword"
          />
          {isSearching && (
            <TouchableOpacity
              onPress={clearSearch}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text style={[styles.clearIcon, { color: colors.textTertiary }]}>✕</Text>
            </TouchableOpacity>
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
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {emptyMessage(activeTab, isSearching, searchQuery)}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              {emptyHint(activeTab, isSearching)}
            </Text>
          </View>
        }
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
    // Slight vertical nudge so the lens glyph sits centered
    marginTop: -1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    // Nullify default RN text input padding on Android
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

  // ── Empty state ──
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
  },

  // ── Error state ──
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
