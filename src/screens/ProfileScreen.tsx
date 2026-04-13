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

// ── Utilities ─────────────────────────────────────────────────

function emailInitial(email: string | null): string {
  if (!email) return '?';
  return email.charAt(0).toUpperCase();
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `···${id.slice(-8)}` : id;
}

function formatMemberSince(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    return `Member since ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
  } catch {
    return '';
  }
}

// ── Row primitives ────────────────────────────────────────────

function SectionLabel({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.sectionLabel, { color }]}>{label}</Text>;
}

interface NavRowProps {
  label: string;
  onPress: () => void;
  textColor: string;
  borderColor: string;
  accentColor: string;
}

function NavRow({ label, onPress, textColor, borderColor, accentColor }: NavRowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: borderColor }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
    >
      <Text style={[styles.rowLabel, { color: textColor }]}>{label}</Text>
      <Text style={[styles.chevron, { color: accentColor }]}>›</Text>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function ProfileScreen({ navigation }: Props) {
  const { colors, resolved } = useTheme();
  const insets = useSafeAreaInsets();

  const [email, setEmail]       = useState<string | null>(null);
  const [userId, setUserId]     = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string>('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      setEmail(user?.email ?? null);
      setUserId(user?.id ?? null);
      setMemberSince(formatMemberSince(user?.created_at));
    });
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    // onAuthStateChange in AuthContext fires → App.tsx re-renders to SignInScreen.
    // No need to reset signingOut — the component will unmount.
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />

      {/* Custom header (headerShown: false in App.tsx, so we draw our own) */}
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
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          Profile
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity block ── */}
        <View
          style={[
            styles.identityBlock,
            { backgroundColor: colors.bgElevated, borderBottomColor: colors.border },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: colors.iris }]}>
            <Text style={styles.avatarInitial}>{emailInitial(email)}</Text>
          </View>
          <View style={styles.identityText}>
            <Text
              style={[styles.emailText, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {email ?? '—'}
            </Text>
            <Text style={[styles.userIdText, { color: colors.textTertiary }]}>
              {shortId(userId)}
            </Text>
            {!!memberSince && (
              <Text style={[styles.memberSince, { color: colors.textTertiary }]}>
                {memberSince}
              </Text>
            )}
          </View>
        </View>

        {/* ── Settings section ── */}
        <SectionLabel label="SETTINGS" color={colors.textTertiary} />
        <View style={[styles.group, { backgroundColor: colors.bgElevated }]}>
          <NavRow
            label="Appearance"
            onPress={() => navigation.navigate('Settings')}
            textColor={colors.textPrimary}
            borderColor={colors.border}
            accentColor={colors.textTertiary}
          />
        </View>

        {/* ── Account section ── */}
        <SectionLabel label="ACCOUNT" color={colors.textTertiary} />
        <View style={[styles.group, { backgroundColor: colors.bgElevated }]}>
          {/* Sign out — single row, inline spinner when in progress */}
          <TouchableOpacity
            style={styles.signOutRow}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ disabled: signingOut }}
          >
            {signingOut ? (
              <ActivityIndicator size="small" color={colors.iris} />
            ) : (
              <Text style={[styles.signOutLabel, { color: colors.iris }]}>
                Sign Out
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          IRIS · Intelligence Feed
        </Text>
      </ScrollView>

      <BottomTabBar />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

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

  // ── Scroll content ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // ── Identity block ──
  identityBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    marginBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '600',
  },
  userIdText: {
    fontSize: 12,
    letterSpacing: 0.4,
  },
  memberSince: {
    fontSize: 11,
    marginTop: 1,
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 6,
    marginTop: 8,
  },

  // ── Row groups ──
  group: {
    marginBottom: 28,
  },

  // ── Nav row (with chevron) ──
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
  },
  chevron: {
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },

  // ── Sign out row ── single row, always exactly one child (text OR spinner)
  signOutRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 50,
    justifyContent: 'center',
  },
  signOutLabel: {
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Footer ──
  footerText: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
});
