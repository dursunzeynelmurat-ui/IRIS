import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SignalButton } from '../components/SignalButton';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useEventDetail } from '../hooks/useEventDetail';
import { useUserSignal } from '../hooks/useUserSignal';
import { statusColors, scoreColor, STATUS_LABEL } from '../lib/eventUtils';
import { formatRelativeTime, formatTimelineTimestamp } from '../lib/formatRelativeTime';
import { Event, EventUpdate } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;
type DetailTab = 'updates' | 'sources';

// ── Helpers ───────────────────────────────────────────────────

function openURL(url: string | null) {
  if (!url) return;
  try { Linking.openURL(url); } catch { /* ignore malformed URL */ }
}

// ── Live update banner ────────────────────────────────────────

function LiveUpdateBanner({ count, onView }: { count: number; onView: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.border,
          shadowColor: colors.textPrimary,
        },
      ]}
    >
      <View style={[styles.bannerDot, { backgroundColor: colors.iris }]} />
      <Text style={[styles.bannerText, { color: colors.textPrimary }]}>
        {count === 1 ? 'New update available' : `${count} new updates available`}
      </Text>
      <TouchableOpacity
        onPress={onView}
        style={[styles.bannerBtn, { backgroundColor: colors.iris }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="View new update"
      >
        <Text style={styles.bannerBtnText}>View</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Timeline update item ──────────────────────────────────────

function TimelineItem({ update, isLast }: { update: EventUpdate; isLast: boolean }) {
  const { colors, resolved } = useTheme();
  const hasLink  = !!update.source_url;
  const linkColor = resolved === 'dark' ? '#58A6FF' : '#1A73E8';

  return (
    <View style={styles.timelineItem}>
      {/* Gutter */}
      <View style={styles.timelineGutter}>
        <View style={[styles.timelineDot, { backgroundColor: colors.borderStrong }]} />
        {!isLast && (
          <View style={[styles.timelineConnector, { backgroundColor: colors.border }]} />
        )}
      </View>

      {/* Body */}
      <View style={styles.timelineBody}>
        {/* Source + timestamp */}
        <View style={styles.timelineHeader}>
          <View style={styles.timelineSourceWrap}>
            {hasLink ? (
              <TouchableOpacity
                onPress={() => openURL(update.source_url)}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel={`${update.source_name}, opens in browser`}
              >
                <Text style={[styles.timelineSource, { color: linkColor }]}>
                  {update.source_name} ↗
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.timelineSource, { color: colors.textSecondary }]}>
                {update.source_name}
              </Text>
            )}
          </View>
          <Text style={[styles.timelineTs, { color: colors.textTertiary }]}>
            {formatTimelineTimestamp(update.created_at)}
          </Text>
        </View>

        {/* Content */}
        <Text style={[styles.timelineContent, { color: colors.textPrimary }]}>
          {update.content}
        </Text>
      </View>
    </View>
  );
}

// ── Sources list ──────────────────────────────────────────────

function SourceRow({ source, isLast }: { source: EventUpdate; isLast: boolean }) {
  const { colors, resolved } = useTheme();
  const hasLink  = !!source.source_url;
  const linkColor = resolved === 'dark' ? '#58A6FF' : '#1A73E8';

  return (
    <View
      style={[
        styles.sourceRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <View style={[styles.sourceDot, { backgroundColor: colors.borderStrong }]} />
      <View style={styles.sourceInfo}>
        {hasLink ? (
          <TouchableOpacity
            onPress={() => openURL(source.source_url)}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`${source.source_name}, opens in browser`}
          >
            <Text style={[styles.sourceName, { color: linkColor }]}>
              {source.source_name} ↗
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.sourceName, { color: colors.textSecondary }]}>
            {source.source_name}
          </Text>
        )}
        <Text style={[styles.sourceTime, { color: colors.textTertiary }]}>
          {formatRelativeTime(source.created_at)}
        </Text>
      </View>
    </View>
  );
}

// ── Signal footer (at very bottom, after scrolling through updates) ────────

function SignalFooter({ eventId, userId }: { eventId: string; userId: string }) {
  const { colors } = useTheme();
  const { currentSignal, fetchLoading, submitting, error, submitSignal } = useUserSignal(
    eventId,
    userId,
  );

  return (
    <View
      style={[
        styles.signalFooter,
        { borderTopColor: colors.border, backgroundColor: colors.bgElevated },
      ]}
    >
      <Text style={[styles.signalLabel, { color: colors.textTertiary }]}>
        COMMUNITY SIGNAL
      </Text>
      <Text style={[styles.signalSubtitle, { color: colors.textSecondary }]}>
        Signal your read on this event. Community input may influence the trust score by up to ±10 points — trust is primarily source-derived.
      </Text>

      <View style={styles.signalButtons}>
        {fetchLoading ? (
          <>
            <View style={[styles.signalPlaceholder, { borderColor: colors.border }]} />
            <View style={[styles.signalPlaceholder, { borderColor: colors.border }]} />
          </>
        ) : (
          <>
            <SignalButton
              type="confirm"
              active={currentSignal === 'confirm'}
              loading={!!(submitting && currentSignal !== 'dispute')}
              disabled={submitting}
              faded={currentSignal !== null && currentSignal !== 'confirm'}
              onPress={() => submitSignal('confirm')}
            />
            <SignalButton
              type="dispute"
              active={currentSignal === 'dispute'}
              loading={!!(submitting && currentSignal !== 'confirm')}
              disabled={submitting}
              faded={currentSignal !== null && currentSignal !== 'dispute'}
              onPress={() => submitSignal('dispute')}
            />
          </>
        )}
      </View>

      {!fetchLoading && error && (
        <Text style={[styles.signalError, { color: colors.danger }]}>{error}</Text>
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

  const [activeTab, setActiveTab] = useState<DetailTab>('updates');
  const [bannerCount, setBannerCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const initialCountRef = useRef<number | null>(null);

  // Dynamic nav title
  useEffect(() => {
    navigation.setOptions({ title: event?.title ?? 'Event Detail' });
  }, [event?.title, navigation]);

  // Live update detection — fires when updates arrive after initial load
  useEffect(() => {
    if (loading) return;
    if (initialCountRef.current === null) {
      initialCountRef.current = updates.length;
      return;
    }
    const diff = updates.length - initialCountRef.current;
    if (diff > 0) {
      setBannerCount(diff);
      initialCountRef.current = updates.length;
    }
  }, [updates.length, loading]);

  // Unique sources — last occurrence per source gives most recent timestamp
  const uniqueSources = useMemo(() => {
    const map = new Map<string, EventUpdate>();
    for (const u of updates) { map.set(u.source_name, u); }
    return Array.from(map.values());
  }, [updates]);

  function handleViewNewUpdate() {
    setBannerCount(0);
    setActiveTab('updates');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  // ── Error / loading states ────────────────────────────────────

  if (!eventId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>Unable to load event.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.iris} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>Unable to load event.</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { borderColor: colors.iris }]}
          onPress={refetch}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading event"
        >
          <Text style={[styles.retryText, { color: colors.iris }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Derived display values ────────────────────────────────────

  const trustScore   = event.trust_score ?? 50;
  const trustColor   = scoreColor(trustScore, resolved);
  const statusColor  = statusColors(resolved)[event.status];
  const statusLabel  = STATUS_LABEL[event.status] ?? event.status;
  const sourceLabel  = event.source_count === 1 ? '1 source' : `${event.source_count} sources`;

  // Placeholder tint for hero image when image_url is absent
  const heroTint = statusColor + '22';

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>

      {/* ── Live update banner (floats over scroll content) ───── */}
      {bannerCount > 0 && (
        <LiveUpdateBanner count={bannerCount} onView={handleViewNewUpdate} />
      )}

      {/* ── Scrollable content ────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={colors.iris}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ── */}
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityLabel="Event photo"
          />
        ) : (
          <View style={[styles.heroPlaceholder, { backgroundColor: heroTint }]} />
        )}

        {/* ── Title + inline metadata ── */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {event.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaTrust, { color: trustColor }]}>
              Trust {trustScore}
            </Text>
            <Text style={[styles.metaSep, { color: colors.textTertiary }]}> • </Text>
            <Text style={[styles.metaStatus, { color: statusColor }]}>
              {statusLabel}
            </Text>
            <Text style={[styles.metaSep, { color: colors.textTertiary }]}> • </Text>
            <Text style={[styles.metaTime, { color: colors.textTertiary }]}>
              {formatRelativeTime(event.created_at)}
            </Text>
          </View>
          <Text style={[styles.sourceCount, { color: colors.textTertiary }]}>
            {sourceLabel}
          </Text>
        </View>

        {/* ── Tab selector: Updates / Sources ── */}
        <View style={[styles.detailTabs, { borderBottomColor: colors.border }]}>
          {(['updates', 'sources'] as DetailTab[]).map((tab) => {
            const isActive = activeTab === tab;
            const label    = tab === 'updates' ? 'Updates' : 'Sources';
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.detailTab,
                  isActive && [styles.detailTabActive, { borderBottomColor: colors.iris }],
                ]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityLabel={`${label} tab`}
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[
                    styles.detailTabLabel,
                    {
                      color: isActive ? colors.iris : colors.textTertiary,
                      fontWeight: isActive ? '700' : '400',
                    },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Tab content ── */}
        {activeTab === 'updates' ? (
          <View style={styles.tabContent}>
            {updates.length === 0 ? (
              <View style={styles.emptyContent}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No updates yet.</Text>
                <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Pull down to refresh.</Text>
              </View>
            ) : (
              updates.map((u, i) => (
                <TimelineItem key={u.id} update={u} isLast={i === updates.length - 1} />
              ))
            )}
          </View>
        ) : (
          <View style={styles.tabContent}>
            {uniqueSources.length === 0 ? (
              <View style={styles.emptyContent}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No sources listed.</Text>
              </View>
            ) : (
              <View
                style={[
                  styles.sourcesList,
                  { backgroundColor: colors.bgElevated, borderColor: colors.border },
                ]}
              >
                {uniqueSources.map((s, i) => (
                  <SourceRow
                    key={s.source_name}
                    source={s}
                    isLast={i === uniqueSources.length - 1}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Signal footer — always below scroll, after reading ── */}
      {userId && (
        <SignalFooter eventId={event.id} userId={userId} />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // ── Live update banner ──
  banner: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  bannerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bannerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // ── Hero image ──
  heroImage: {
    width: '100%',
    height: 220,
  },
  heroPlaceholder: {
    width: '100%',
    height: 180,
  },

  // ── Title section ──
  titleSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
    gap: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaTrust: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaSep: {
    fontSize: 14,
  },
  metaStatus: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaTime: {
    fontSize: 14,
  },
  sourceCount: {
    fontSize: 13,
    marginTop: 2,
  },

  // ── Detail tabs ──
  detailTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 20,
    marginHorizontal: 20,
  },
  detailTab: {
    paddingBottom: 10,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  detailTabActive: {
    // borderBottomColor set dynamically
  },
  detailTabLabel: {
    fontSize: 15,
    letterSpacing: 0.1,
  },

  // ── Tab content area ──
  tabContent: {
    paddingTop: 16,
    paddingHorizontal: 20,
  },

  // ── Intelligence timeline ──
  timelineItem: {
    flexDirection: 'row',
  },
  timelineGutter: {
    width: 20,
    alignItems: 'center',
    paddingTop: 3,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineConnector: {
    flex: 1,
    width: 1,
    marginTop: 5,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 4,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  timelineSourceWrap: {
    flex: 1,
  },
  timelineSource: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  timelineTs: {
    fontSize: 11,
    flexShrink: 0,
    paddingTop: 1,
  },
  timelineContent: {
    fontSize: 15,
    lineHeight: 22,
  },

  // ── Sources list ──
  sourcesList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  sourceInfo: {
    flex: 1,
    gap: 3,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: '600',
  },
  sourceTime: {
    fontSize: 12,
  },

  // ── Signal footer ──
  signalFooter: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  signalLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  signalSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  signalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signalPlaceholder: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
  },
  signalError: {
    fontSize: 12,
    marginTop: 4,
  },

  // ── Empty / error ──
  emptyContent: {
    paddingVertical: 20,
    gap: 4,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
