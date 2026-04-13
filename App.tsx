import { DefaultTheme, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuth } from './src/hooks/useAuth';
import { useUserPreferences } from './src/hooks/useUserPreferences';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * AppContent renders the auth-gated navigation tree.
 * It consumes auth state from AuthContext and theme from ThemeContext.
 *
 * The navigation theme is derived directly from ThemeContext color tokens —
 * there is a single source of truth for color values. No static duplicate
 * constants; changes to ThemeContext propagate automatically.
 */
function AppContent() {
  const { userId, loading } = useAuth();
  const { resolved, colors } = useTheme();

  // Navigation theme derived from ThemeContext — single source of truth.
  // 'card' maps to the navigation header background:
  //   dark  → colors.bg (#0d0d0d) — header blends with the screen background
  //   light → colors.bgElevated (#ffffff) — white header over #f2f2f7 screen
  const navTheme = useMemo(() => {
    const base = resolved === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary:    colors.iris,
        background: colors.bg,
        card:       resolved === 'dark' ? colors.bg : colors.bgElevated,
        text:       colors.textPrimary,
        border:     colors.border,
      },
    };
  }, [resolved, colors]);

  const statusStyle = resolved === 'dark' ? 'light' : 'dark';

  if (loading) {
    return (
      <>
        <StatusBar style="light" />
        <View style={styles.splash}>
          <Text style={styles.splashWordmark}>IRIS</Text>
          <ActivityIndicator size="small" color="#636366" style={styles.splashSpinner} />
        </View>
      </>
    );
  }

  if (!userId) {
    return (
      <>
        <StatusBar style="light" />
        <SignInScreen />
      </>
    );
  }

  return (
    <ErrorBoundary>
      <NavigationContainer theme={navTheme}>
        {/* Single StatusBar for the entire authenticated navigation tree. */}
        <StatusBar style={statusStyle} />
        <Stack.Navigator>
          {/* ── Tab-level screens (custom BottomTabBar rendered inside each) ── */}
          <Stack.Screen
            name="EventList"
            component={EventListScreen}
            options={{
              title: 'IRIS',
              headerTitleStyle: styles.navTitle,
              headerShadowVisible: false,
              animation: 'none',
            }}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{
              headerShown: false,
              animation: 'none',
            }}
          />

          {/* ── Deep screens (standard stack push/pop navigation) ── */}
          <Stack.Screen
            name="EventDetail"
            component={EventDetailScreen}
            options={{
              title: 'Event Detail',
              headerBackTitle: '',       // iOS: suppress "IRIS" back-title text
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              title: 'Appearance',
              headerBackTitle: '',
              headerShadowVisible: false,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

/**
 * ThemedApp sits inside AuthProvider so it can read userId, then wraps
 * ThemeProvider with backend-backed preference props.
 *
 * Flow:
 *   1. useUserPreferences fetches the stored preference from user_preferences
 *      once userId is known.
 *   2. ThemeProvider receives it as savedPreference and syncs immediately.
 *   3. When the user changes their theme in Settings, ThemeProvider applies
 *      the change optimistically and calls updateTheme to persist it. If the
 *      write fails, ThemeProvider reverts the local preference automatically.
 */
function ThemedApp() {
  const { userId } = useAuth();
  const { theme, updateTheme } = useUserPreferences(userId);

  return (
    <ThemeProvider
      savedPreference={theme}
      onSavePreference={updateTheme}
    >
      <AppContent />
    </ThemeProvider>
  );
}

/**
 * App is the true root. AuthProvider covers the entire tree so both
 * ThemedApp (preference fetch) and AppContent (auth gating) share one
 * auth subscription.
 */
export default function App() {
  return (
    <AuthProvider>
      <ThemedApp />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  // ── Splash ──
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
  },
  splashWordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: '#e5193e',
    letterSpacing: 8,
  },
  splashSpinner: {
    marginTop: 28,
  },

  // ── Navigation header title ──
  navTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 5,
  },
});
