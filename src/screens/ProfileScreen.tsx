import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar } from '../components/BottomTabBar';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

// Derive initials from email: "jane@example.com" → "J"
function emailInitial(email: string | null): string {
  if (!email) return '?';
  return email.charAt(0).toUpperCase();
}

// Abbreviate user ID for display: "abc1234567890" → "···4567890"
function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `···${id.slice(-8)}` : id;
}

// ── Row components ────────────────────────────────────────────

function SectionHeader({ label, textColor }: { label: string; textColor: string }) {
  return (
    <Text style={[styles.sectionHeader, { color: textColor }]}>{label}</Text>
  );
}

interface RowProps {
  label: string;
  detail?: string;
  onPress?: () => void;
  destructive?: boolean;
  textColor: string;
  borderColor: string;
  detailColor: string;
}

function SettingsRow({
  label,
  detail,
  onPress,
  destructive = false,
  textColor,
  borderColor,
  detailColor,
}: RowProps) {
  const labelColor = destructive ? '#e5193e' : textColor;

  if (!onPress) {
    return (
      <View style={[styles.row, { borderBottomColor: borderColor }]}>
        <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
        {detail !== undefined && (
          <Text style={[styles.rowDetail, { color: detailColor }]}>{detail}</Text>
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: borderColor }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={destructive ? 'button' : 'menuitem'}
      accessibilityLabel={label}
    >
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      {detail !== undefined ? (
        <Text style={[styles.rowDetail, { color: detailColor }]}>{detail}</Text>
      ) : (
        !destructive && (
          <Text style={[styles.chevron, { color: detailColor }]}>›</Text>
        )
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function ProfileScreen({ navigation }: Props) {
  const { colors, resolved } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail]   = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function handleSignOut() {
    setLoading(true);
    await supabase.auth.signOut();
    // onAuthStateChange in AuthContext fires → App.tsx re-renders to SignInScreen.
  }

  const initial = emailInitial(email);

  const sectionBg = [styles.section, { backgroundColor: colors.bgElevated }];

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />

      {/* Custom header — no stack header for this screen */}
      <View
        style={[
          styles.headerBar,
          {
            paddingTop: insets.top,
            backgroundColor: colors.bgElevated,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Profile</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + identity */}
        <View style={[styles.identity, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.iris }]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={[styles.emailText, { color: colors.textPrimary }]} numberOfLines={1}>
              {email ?? '—'}
            </Text>
            <Text style={[styles.userIdText, { color: colors.textTertiary }]}>
              ID {shortId(userId)}
            </Text>
          </View>
        </View>

        {/* Settings section */}
        <SectionHeader label="SETTINGS" textColor={colors.textTertiary} />
        <View style={sectionBg}>
          <SettingsRow
            label="Appearance"
            onPress={() => navigation.navigate('Settings')}
            textColor={colors.textPrimary}
            borderColor={colors.border}
            detailColor={colors.textTertiary}
          />
        </View>

        {/* Account section */}
        <SectionHeader label="ACCOUNT" textColor={colors.textTertiary} />
        <View style={sectionBg}>
          <SettingsRow
            label={loading ? '' : 'Sign Out'}
            onPress={loading ? undefined : handleSignOut}
            destructive
            textColor={colors.textPrimary}
            borderColor={colors.border}
            detailColor={colors.textTertiary}
            detail={loading ? '' : undefined}
          />
          {loading && (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <ActivityIndicator size="small" color={colors.iris} />
            </View>
          )}
        </View>

        <Text style={[styles.appVersion, { color: colors.textTertiary }]}>
          IRIS · Intelligence Feed
        </Text>
      </ScrollView>

      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  // ── Custom header ──
  headerBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 12,
  },

  // ── Scroll ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },

  // ── Avatar / identity block ──
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    marginBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  identityText: {
    flex: 1,
    gap: 4,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '600',
  },
  userIdText: {
    fontSize: 12,
    fontFamily: undefined, // uses system monospace via letterSpacing
    letterSpacing: 0.5,
  },

  // ── Section grouping ──
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 6,
    marginTop: 8,
  },
  section: {
    marginBottom: 28,
  },

  // ── Rows ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 50,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
  },
  rowDetail: {
    fontSize: 14,
    marginLeft: 8,
  },
  chevron: {
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },

  // ── App version ──
  appVersion: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
});
