import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useEventDetail } from '../hooks/useEventDetail';
import { useUserSignal } from '../hooks/useUserSignal';
import { EventUpdate, SignalType } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

// ── Helpers ───────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// ── Sub-components ────────────────────────────────────────────

function UpdateItem({ update }: { update: EventUpdate }) {
  return (
    <View style={styles.updateItem}>
      <Text style={styles.updateSource}>{update.source_name}</Text>
      <Text style={styles.updateContent}>{update.content}</Text>
      <Text style={styles.updateDate}>{formatDate(update.created_at)}</Text>
    </View>
  );
}

interface SignalButtonProps {
  label: string;
  type: SignalType;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}

function SignalButton({ label, active, disabled, onPress }: SignalButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.signalBtn, !!active && styles.signalBtnActive]}
      onPress={onPress}
      disabled={!!disabled}
    >
      <Text style={[styles.signalBtnText, active && styles.signalBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface SignalSectionProps {
  eventId: string;
  userId: string | null;
  authLoading: boolean;
}

function SignalSection({ eventId, userId, authLoading }: SignalSectionProps) {
  const { currentSignal, submitting, error, submitSignal } = useUserSignal(
    eventId,
    userId,
  );

  // Don't flash "Sign in" while the session is still being read
  if (authLoading) return null;

  if (!userId) {
    return (
      <View style={styles.signalSection}>
        <Text style={styles.signalGate}>Sign in to send a signal.</Text>
      </View>
    );
  }

  return (
    <View style={styles.signalSection}>
      <View style={styles.signalButtons}>
        <SignalButton
          label="Confirm"
          type="confirm"
          active={!!(currentSignal === 'confirm')}
          disabled={!!submitting}
          onPress={() => submitSignal('confirm')}
        />
        <SignalButton
          label="Dispute"
          type="dispute"
          active={!!(currentSignal === 'dispute')}
          disabled={!!submitting}
          onPress={() => submitSignal('dispute')}
        />
      </View>
      {error && <Text style={styles.signalError}>{error}</Text>}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function EventDetailScreen({ route }: Props) {
  const { eventId } = route.params;
  const { event, updates, loading, error, refetch } = useEventDetail(eventId);
  const { userId, loading: authLoading } = useAuth();

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
        <Text style={styles.errorText}>Unable to load event.</Text>
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

          <SignalSection
            eventId={event.id}
            userId={userId}
            authLoading={authLoading}
          />

          <Text style={styles.sectionLabel}>Timeline</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No updates yet.</Text>
      }
    />
  );
}

// ── Styles ────────────────────────────────────────────────────

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
    marginBottom: 16,
  },
  metaText: {
    fontSize: 14,
    color: '#555',
  },
  signalSection: {
    marginBottom: 20,
  },
  signalGate: {
    fontSize: 13,
    color: '#888',
  },
  signalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
  },
  signalBtnActive: {
    backgroundColor: '#333',
  },
  signalBtnText: {
    fontSize: 14,
    color: '#333',
  },
  signalBtnTextActive: {
    color: '#fff',
  },
  signalError: {
    marginTop: 6,
    fontSize: 12,
    color: '#c00',
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
});
