import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useEventDetail } from '../hooks/useEventDetail';
import { EventUpdate } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

function UpdateItem({ update }: { update: EventUpdate }) {
  return (
    <View style={styles.updateItem}>
      <Text style={styles.updateSource}>{update.source_name}</Text>
      <Text style={styles.updateContent}>{update.content}</Text>
      <Text style={styles.updateDate}>
        {new Date(update.created_at).toLocaleString()}
      </Text>
    </View>
  );
}

export function EventDetailScreen({ route }: Props) {
  const { eventId } = route.params;
  const { event, updates, loading, error, refetch } = useEventDetail(eventId);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load event.</Text>
        {error && <Text style={styles.errorDetail}>{error}</Text>}
        <TouchableOpacity style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={updates}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <UpdateItem update={item} />}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>{event.title}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{event.status}</Text>
            <Text style={styles.metaText}>Trust: {event.trust_score}/100</Text>
          </View>
          <Text style={styles.sectionLabel}>Timeline</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No updates yet.</Text>
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
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  metaText: {
    fontSize: 14,
    color: '#555',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    paddingBottom: 6,
  },
  updateItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  updateSource: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
    marginBottom: 2,
  },
  updateContent: {
    fontSize: 15,
    marginBottom: 4,
  },
  updateDate: {
    fontSize: 11,
    color: '#999',
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    marginTop: 12,
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
});
