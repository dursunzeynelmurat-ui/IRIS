import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { EventCard } from '../components/EventCard';
import { useAuth } from '../hooks/useAuth';
import { useEvents } from '../hooks/useEvents';
import { useUserSignals } from '../hooks/useUserSignals';
import { STATUS_COLOR } from '../lib/eventUtils';
import { supabase } from '../lib/supabase';
import { EventStatus } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

type FilterOption = 'all' | EventStatus;

const FILTERS: { key: FilterOption; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'emerging',   label: 'Emerging' },
  { key: 'developing', label: 'Developing' },
  { key: 'verified',   label: 'Verified' },
  { key: 'disputed',   label: 'Disputed' },
];

export function EventListScreen({ navigation }: Props) {
  const { events, loading, refreshing, error, refetch } = useEvents();
  const { userId } = useAuth();
  // One bulk fetch instead of per-card queries (eliminates N+1)
  const { signalMap, setSignal } = useUserSignals(userId);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');

  useEffect(() => {
    if (!userId) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => supabase.auth.signOut()}
          style={styles.signOutBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, userId]);

  const filtered = activeFilter === 'all'
    ? events
    : events.filter((e) => e.status === activeFilter);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Unable to load events.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={refetch}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading events"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
        accessibilityRole="tablist"
      >
        {FILTERS.map(({ key, label }) => {
          const isActive = activeFilter === key;
          const accentColor = key === 'all' ? '#f2f2f2' : STATUS_COLOR[key as EventStatus];
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterChip,
                isActive && { borderColor: accentColor, backgroundColor: accentColor + '22' },
              ]}
              onPress={() => setActiveFilter(key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={key === 'all' ? 'All events' : `${label} events`}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[
                styles.filterChipText,
                isActive && { color: accentColor },
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
            tintColor="#8e8e93"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {activeFilter === 'all' ? 'No events yet.' : `No ${activeFilter} events.`}
            </Text>
            <Text style={styles.emptyHint}>Pull down to refresh.</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  filterBar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  filterBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
  },
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
    backgroundColor: '#0d0d0d',
    padding: 24,
  },
  separator: {
    height: 10,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f2f2f2',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f2f2f2',
  },
  emptyContainer: {
    alignItems: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8e8e93',
  },
  emptyHint: {
    fontSize: 13,
    color: '#636366',
  },
  signOutBtn: {
    marginRight: 4,
  },
  signOutText: {
    fontSize: 14,
    color: '#ff453a',
  },
});
