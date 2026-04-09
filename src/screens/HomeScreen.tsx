/**
 * HomeScreen — Phase 2 connection test.
 * Fetches events from Supabase and renders raw JSON to confirm
 * the client, env vars, RLS, and network are all working.
 * This screen will be replaced by the real EventListScreen.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { DbEvent } from '../types/database.types';

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; events: DbEvent[] };

export function HomeScreen() {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('[HomeScreen] fetch error:', error);
          setState({ status: 'error', message: error.message });
        } else {
setState({ status: 'success', events: data ?? [] });
        }
      });
  }, []);

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.label}>Connecting to Supabase…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Connection failed</Text>
        <Text style={styles.errorDetail}>{state.message}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>
        Connection OK — {state.events.length} event(s)
      </Text>
      {state.events.length === 0 ? (
        <Text style={styles.empty}>No events in database yet.</Text>
      ) : (
        state.events.map((event) => (
          <View key={event.id} style={styles.card}>
            <Text style={styles.cardTitle}>{event.title}</Text>
            <Text style={styles.cardMeta}>
              {event.status} · trust {event.trust_score}/100 · {event.source_count} source(s)
            </Text>
            <Text style={styles.cardJson}>
              {JSON.stringify(event, null, 2)}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#c00',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  container: {
    padding: 16,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  empty: {
    fontSize: 14,
    color: '#888',
  },
  card: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  cardJson: {
    fontSize: 11,
    color: '#999',
    fontFamily: 'monospace',
  },
});
