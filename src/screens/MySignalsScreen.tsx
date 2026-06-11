import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme, type ThemeColors } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useSignalLead } from '../hooks/useSignalLead';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import type { SignalLeadStatus, UserReputation, UserSignalLead } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'MySignals'>;

// ── Lead status display ───────────────────────────────────────

const LEAD_STATUS_LABEL: Record<SignalLeadStatus, string> = {
  pending:                'Pending review',
  matched_existing_event: 'Matched to event',
  created_new_event:      'Surfaced new event',
  rejected:               'Not used',
  rate_limited:           'Rate limited',
  blocked:                'Blocked',
};

function leadStatusColor(status: SignalLeadStatus, colors: ThemeColors): string {
  switch (status) {
    case 'matched_existing_event':
    case 'created_new_event':
      return colors.iris;
    case 'rejected':
    case 'rate_limited':
    case 'blocked':
      return colors.danger;
    default:
      return colors.textTertiary;
  }
}

// ── Reputation summary card ───────────────────────────────────

function ReputationCard({ reputation }: { reputation: UserReputation }) {
  const { colors } = useTheme();
  const isBlocked =
    !!reputation.blocked_until && new Date(reputation.blocked_until) > new Date();

  return (
    <View
      style={[
        styles.repCard,
        { backgroundColor: colors.bgElevated, borderColor: colors.border },
      ]}
    >
      <View style={styles.repScoreRow}>
        <Text style={[styles.repScore, { color: colors.iris }]}>
          {reputation.reputation_score}
        </Text>
        <Text style={[styles.repScoreLabel, { color: colors.textTertiary }]}>
          REPUTATION
        </Text>
      </View>

      <View style={[styles.repStatsRow, { borderTopColor: colors.border }]}>
        <View style={styles.repStat}>
          <Text style={[styles.repStatValue, { color: colors.textPrimary }]}>
            {reputation.total_leads}
          </Text>
          <Text style={[styles.repStatLabel, { color: colors.textTertiary }]}>
            Submitted
          </Text>
        </View>
        <View style={styles.repStat}>
          <Text style={[styles.repStatValue, { color: colors.textPrimary }]}>
            {reputation.accepted_leads}
          </Text>
          <Text style={[styles.repStatLabel, { color: colors.textTertiary }]}>
            Accepted
          </Text>
        </View>
        <View style={styles.repStat}>
          <Text style={[styles.repStatValue, { color: colors.textPrimary }]}>
            {reputation.rejected_leads}
          </Text>
          <Text style={[styles.repStatLabel, { color: colors.textTertiary }]}>
            Not used
          </Text>
        </View>
      </View>

      {isBlocked && (
        <Text style={[styles.repBlocked, { color: colors.danger }]}>
          Submissions paused until{' '}
          {new Date(reputation.blocked_until!).toLocaleString()}
        </Text>
      )}
    </View>
  );
}

// ── Lead row ──────────────────────────────────────────────────

function LeadRow({ lead, isLast }: { lead: UserSignalLead; isLast: boolean }) {
  const { colors } = useTheme();
  const statusColor = leadStatusColor(lead.status, colors);

  return (
    <View
      style={[
        styles.leadRow,
        !isLast && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.leadContent, { color: colors.textPrimary }]}>
        {lead.content}
      </Text>
      <View style={styles.leadMetaRow}>
        <Text style={[styles.leadStatus, { color: statusColor }]}>
          {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
        </Text>
        <Text style={[styles.leadTime, { color: colors.textTertiary }]}>
          {formatRelativeTime(lead.created_at)}
        </Text>
      </View>
      {!!lead.rejection_reason && (
        <Text style={[styles.leadReason, { color: colors.textTertiary }]}>
          {lead.rejection_reason}
        </Text>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────

export function MySignalsScreen(_: Props) {
  const { colors } = useTheme();
  const { userId } = useAuth();
  const { leads, reputation, loading, error, refetch } = useSignalLead(userId);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.iris} />
      </View>
    );
  }

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      data={leads}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <LeadRow lead={item} isLast={index === leads.length - 1} />
      )}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.iris} />
      }
      ListHeaderComponent={
        <>
          {reputation && <ReputationCard reputation={reputation} />}
          {!!error && (
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          )}
          {leads.length > 0 && (
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
              RECENT SIGNALS
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        !error ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No signals submitted yet.
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Signals you send to IRIS appear here with their review status.
            </Text>
          </View>
        ) : null
      }
      showsVerticalScrollIndicator={false}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Reputation card ──
  repCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 18,
    marginBottom: 24,
  },
  repScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 14,
  },
  repScore: {
    fontSize: 34,
    fontWeight: '800',
  },
  repScoreLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  repStatsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
  },
  repStat: {
    flex: 1,
    gap: 2,
  },
  repStatValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  repStatLabel: {
    fontSize: 11,
  },
  repBlocked: {
    fontSize: 12,
    marginTop: 12,
    lineHeight: 17,
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    paddingBottom: 6,
  },

  // ── Lead row ──
  leadRow: {
    paddingVertical: 14,
    gap: 6,
  },
  leadContent: {
    fontSize: 15,
    lineHeight: 21,
  },
  leadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leadStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  leadTime: {
    fontSize: 12,
  },
  leadReason: {
    fontSize: 12,
    lineHeight: 17,
  },

  // ── Empty / error ──
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 6,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 16,
  },
});
