import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
  { key: 'new',      label: 'New' },
  { key: 'verified', label: 'Verified' },
  { key: 'rising',   label: 'Rising' },
];

// ── Tab filtering logic ───────────────────────────────────────

function filterEvents(events: Event[], tab: FeedTab): Event[] {
  switch (tab) {
    case 'new':
      // All events, most recent first
      return [...events].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'verified':
      return events.filter((e) => e.status === 'verified');
    case 'rising':
      // Gaining credibility: emerging + developing, highest trust first
      return events
        .filter((e) => e.status === 'emerging' || e.status === 'developing')
        .sort((a, b) => (b.trust_score ?? 0) - (a.trust_score ?? 0));
  }
}

// ── Empty message per tab ─────────────────────────────────────

function emptyMessage(tab: FeedTab): string {
  switch (tab) {
    case 'new':      return 'No events yet.';
    case 'verified': return 'No verified events yet.';
    case 'rising':   return 'No rising events yet.';
  }
}

// ── Screen ───────────────────────────────────────────────────

export function EventListScreen({ navigation }: Props) {
  const { events, loading, refreshing, error, refetch } = useEvents();
  const { userId } = useAuth();
  const { signalMap, setSignal } = useUserSignals(userId);
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<FeedTab>('new');

  const filtered = useMemo(() => filterEvents(events, activeTab), [events, activeTab]);

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

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Feed tabs */}
      <View
        style={[
          styles.tabBar,
          { borderBottomColor: colors.border, backgroundColor: colors.bg },
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map(({ key, label }) => {
          const isActive = activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => setActiveTab(key)}
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

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            userId={userId!}
            initialSignal={signalMap.get(item.id) ?? null}
            onSignalCast={(type) => setSignal(item.id, type)}
            onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
          />
        )}
        contentContainerStyle={
          filtered.length === 0 ? styles.centeredFlex : styles.listContent
        }
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
              {emptyMessage(activeTab)}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Pull down to refresh.
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator]} />
        )}
      />

      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── Feed tabs ──
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 14,
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
  },
  emptyHint: {
    fontSize: 13,
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
