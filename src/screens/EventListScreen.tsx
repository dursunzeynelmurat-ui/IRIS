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
import { EventCard } from '../components/EventCard';
import { useAuth } from '../hooks/useAuth';
import { useEvents } from '../hooks/useEvents';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

export function EventListScreen({ navigation }: Props) {
  const { events, loading, error, refetch } = useEvents();
  const { userId } = useAuth();

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
    <FlatList
      style={styles.list}
      data={events}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EventCard
          event={item}
          userId={userId}
          onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
        />
      )}
      contentContainerStyle={
        events.length === 0 ? styles.centered : styles.listContent
      }
      ListEmptyComponent={<Text style={styles.emptyText}>No events yet.</Text>}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  listContent: {
    padding: 12,
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
