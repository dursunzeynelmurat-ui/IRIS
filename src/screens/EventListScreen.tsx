import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useEvents } from '../hooks/useEvents';
import { Event, EventStatus } from '../types';

const STATUS_LABEL: Record<EventStatus, string> = {
  emerging:   'Emerging',
  developing: 'Developing',
  verified:   'Verified',
  disputed:   'Disputed',
};

function EventItem({ event }: { event: Event }) {
  return (
    <View style={styles.item}>
      <Text style={styles.title}>{event.title}</Text>
      <View style={styles.meta}>
        <Text style={styles.status}>{STATUS_LABEL[event.status]}</Text>
        <Text style={styles.trust}>Trust: {event.trust_score}/100</Text>
      </View>
    </View>
  );
}

export function EventListScreen() {
  const { events, loading, error, refetch } = useEvents();

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
        <Text style={styles.errorText}>Failed to load events.</Text>
        <Text style={styles.errorDetail}>{error}</Text>
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
      renderItem={({ item }) => <EventItem event={item} />}
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
  status: {
    fontSize: 13,
    color: '#555',
  },
  trust: {
    fontSize: 13,
    color: '#555',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  errorDetail: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
    textAlign: 'center',
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
});
