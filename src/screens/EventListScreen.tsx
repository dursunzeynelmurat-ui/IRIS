import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { EventCard } from '../components/EventCard';
import { useAuth } from '../hooks/useAuth';
import { useEvents } from '../hooks/useEvents';
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

const FILTER_COLOR: Record<EventStatus, string> = {
  emerging:   '#ff9f0a',
  developing: '#0a84ff',
  verified:   '#30d158',
  disputed:   '#ff453a',
};

export function EventListScreen({ navigation }: Props) {
  const { events, loading, refreshing, error, refetch } = useEvents();
  const { userId } = useAuth();
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');

  useEffect(() => {
    if (!userId) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => supabase.auth.signOut()}
          style={styles.signOutBtn}
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
        <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
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
      >
        {FILTERS.map(({ key, label }) => {
          const isActive = activeFilter === key;
          const accentColor = key === 'all' ? '#f2f2f2' : FILTER_COLOR[key as EventStatus];
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterChip,
                isActive && { borderColor: accentColor, backgroundColor: accentColor + '22' },
              ]}
              onPress={() => setActiveFilter(key)}
              activeOpacity={0.7}
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
            userId={userId}
            onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
          />
        )}
        contentContainerStyle={
          filtered.length === 0 ? styles.centeredFlex : styles.listContent
        }
        refreshing={!!refreshing}
        onRefresh={refetch}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {activeFilter === 'all' ? 'No events yet.' : `No ${activeFilter} events.`}
          </Text>
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
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8e8e93',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
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
    borderColor: '#555',
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    color: '#f2f2f2',
  },
  emptyText: {
    fontSize: 15,
    color: '#8e8e93',
  },
  signOutBtn: {
    marginRight: 4,
  },
  signOutText: {
    fontSize: 14,
    color: '#ff453a',
  },
});
