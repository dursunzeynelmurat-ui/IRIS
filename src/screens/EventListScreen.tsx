import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../hooks/useAuth';
import { Event, EventStatus } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

const STATUS_LABEL: Record<EventStatus, string> = {
  emerging:   'Emerging',
  developing: 'Developing',
  verified:   'Verified',
  disputed:   'Disputed',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status as EventStatus] ?? status;
}

function EventItem({ event, onPress }: { event: Event; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <Text style={styles.title}>{event.title}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{statusLabel(event.status)}</Text>
        <Text style={styles.metaText}>Trust: {event.trust_score}/100</Text>
      </View>
    </TouchableOpacity>
  );
}

export function EventListScreen({ navigation }: Props) {
  const { events, loading, error, refetch } = useEvents();
  const { userId } = useAuth();

  // Add Sign Out button to the native header when signed in
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Unable to load events.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EventItem
          event={item}
          onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
        />
      )}
      contentContainerStyle={events.length === 0 ? styles.centered : styles.list}
      ListHeaderComponent={<Text style={styles.header}>Events</Text>}
      ListEmptyComponent={
        <Text style={styles.emptyText}>No events yet.</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  list: {
    padding: 16,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
  },
  metaText: {
    fontSize: 13,
    color: '#555',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
  },
  retryText: {
    fontSize: 14,
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
  },
  signOutBtn: {
    marginRight: 12,
  },
  signOutText: {
    fontSize: 14,
    color: '#c00',
  },
});
