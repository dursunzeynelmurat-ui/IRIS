import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SignalButton } from '../components/SignalButton';
import { StatusBadge } from '../components/StatusBadge';
import { TrustRing } from '../components/TrustRing';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useEventDetail } from '../hooks/useEventDetail';
import { useUserSignal } from '../hooks/useUserSignal';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { EventUpdate } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

// ── Sub-components ────────────────────────────────────────────

function UpdateItem({ update, isLast, colors, resolved }: {
  update: EventUpdate;
  isLast: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  resolved: ReturnType<typeof useTheme>['resolved'];
}) {
  const hasLink = !!update.source_url;

  function openLink() {
    if (!update.source_url) return;
    try {
      Linking.openURL(update.source_url);
    } catch {
      // ignore malformed URL
    }
  }

  return (
    <View style={styles.updateRow}>
      {/* Timeline gutter: dot + connector (omitted on last item) */}
      <View style={styles.timelineGutter}>
        <View style={[styles.timelineDot, { backgroundColor: colors.borderStrong }]} />
        {!isLast && (
          <View style={[styles.timelineConnector, { backgroundColor: colors.border }]} />
        )}
      </View>

      {/* Update content */}
      <View style={styles.updateBody}>
        {hasLink ? (
          <TouchableOpacity
            onPress={openLink}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`${update.source_name}, opens in browser`}
          >
            <Text style={[styles.updateSource, { color: resolved === 'dark' ? '#0a84ff' : '#0060c7', textDecorationLine: 'underline' }]}>
              {update.source_name} ↗
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.updateSource, { color: colors.textSecondary }]}>
            {update.source_name}
          </Text>
        )}
        <Text style={[styles.updateContent, { color: colors.textPrimary }]}>
          {update.content}
        </Text>
        <Text style={[styles.updateDate, { color: colors.textTertiary }]}>
          {formatRelativeTime(update.created_at)}
        </Text>
      </View>
    </View>
  );
}

interface SignalSectionProps {
  eventId: string;
  userId: string;
  colors: ReturnType<typeof useTheme>['colors'];
  resolved: ReturnType<typeof useTheme>['resolved'];
}

function SignalSection({ eventId, userId, colors, resolved: _resolved }: SignalSectionProps) {
  const { currentSignal, fetchLoading, submitting, error, submitSignal } = useUserSignal(
    eventId,
    userId,
  );

  return (
    <View style={styles.signalSection}>
      <View style={styles.signalButtons}>
        {fetchLoading ? (
          <>
            <View style={[styles.signalBtnPlaceholder, { borderColor: colors.border }]} />
            <View style={[styles.signalBtnPlaceholder, { borderColor: colors.border }]} />
          </>
        ) : (
          <>
            <SignalButton
              type="confirm"
              active={currentSignal === 'confirm'}
              loading={submitting && currentSignal === 'confirm'}
              disabled={submitting}
              faded={currentSignal !== null && currentSignal !== 'confirm'}
              onPress={() => submitSignal('confirm')}
            />
            <SignalButton
              type="dispute"
              active={currentSignal === 'dispute'}
              loading={submitting && currentSignal === 'dispute'}
              disabled={submitting}
              faded={currentSignal !== null && currentSignal !== 'dispute'}
              onPress={() => submitSignal('dispute')}
            />
          </>
        )}
      </View>
      {!fetchLoading && error && (
        <Text style={[styles.signalError, { color: colors.iris }]}>{error}</Text>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function EventDetailScreen({ route, navigation }: Props) {
  const eventId = route.params?.eventId;
  const { event, updates, loading, refreshing, error, refetch } = useEventDetail(eventId ?? '');
  const { userId } = useAuth();
  const { colors, resolved } = useTheme();

  // Dynamic header: event title only (sign out removed — lives in Profile)
  useEffect(() => {
    navigation.setOptions({
      title: event?.title ?? 'Event Detail',
    });
  }, [event?.title, navigation]);

  if (!eventId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>
          Unable to load event.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>
          Unable to load event.
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { borderColor: colors.borderStrong }]}
          onPress={refetch}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading event"
        >
          <Text style={[styles.retryText, { color: colors.textPrimary }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sourceLabel = event.source_count === 1 ? '1 source' : `${event.source_count} sources`;
  const trustScore  = event.trust_score ?? 50;

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: colors.bg }]}
      data={updates}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <UpdateItem
          update={item}
          isLast={index === updates.length - 1}
          colors={colors}
          resolved={resolved}
        />
      )}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refetch}
          tintColor={colors.textSecondary}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{event.title}</Text>

          {/* Status badge + source count + trust ring */}
          <View style={styles.metaRow}>
            <StatusBadge status={event.status} />
            <Text style={[styles.metaDot, { color: colors.borderStrong }]}>·</Text>
            <Text style={[styles.metaDetail, { color: colors.textSecondary }]}>
              {sourceLabel}
            </Text>
            <View style={styles.metaSpacer} />
            <TrustRing score={trustScore} size="md" />
          </View>

          {userId && (
            <SignalSection eventId={event.id} userId={userId} colors={colors} resolved={resolved} />
          )}

          <Text
            style={[styles.sectionLabel, { color: colors.textTertiary }]}
          >
            Timeline
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No updates yet.
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
            Pull down to refresh.
          </Text>
        </View>
      }
    />
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  list: {
    padding: 16,
  },

  // ── Header ──
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 30,
    marginBottom: 12,
  },

  // ── Meta row ──
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  metaDot: {
    fontSize: 13,
  },
  metaDetail: {
    fontSize: 13,
  },
  metaSpacer: {
    flex: 1,
  },

  // ── Signal section ──
  signalSection: {
    marginBottom: 24,
  },
  signalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signalBtnPlaceholder: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  signalError: {
    marginTop: 8,
    fontSize: 12,
    // color set dynamically via colors.iris in JSX
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 16,
  },

  // ── Timeline items ──
  updateRow: {
    flexDirection: 'row',
  },
  timelineGutter: {
    width: 22,
    alignItems: 'center',
    paddingTop: 2,
  },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  timelineConnector: {
    flex: 1,
    width: 1,
    marginTop: 5,
  },
  updateBody: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 2,
  },
  updateSource: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
updateContent: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 6,
  },
  updateDate: {
    fontSize: 11,
  },

  // ── Empty / error ──
  emptyContainer: {
    paddingTop: 12,
  },
  emptyText: {
    fontSize: 14,
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 12,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  retryButton: {
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
