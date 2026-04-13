import { DefaultTheme, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuth } from './src/hooks/useAuth';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * AppContent renders the authenticated navigation stack.
 * It is always inside ThemeProvider (mounted by AuthedApp below), so
 * useTheme() is safe here.
 *
 * The navigation theme is derived directly from ThemeContext color tokens —
 * one source of truth for color values; no static duplicate constants.
 */
function AppContent() {
  const { resolved, colors } = useTheme();

  const navTheme = useMemo(() => {
    const base = resolved === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary:    colors.iris,
        background: colors.bg,
        // dark: header blends with screen bg; light: white header over #f2f2f7 body
        card:       resolved === 'dark' ? colors.bg : colors.bgElevated,
        text:       colors.textPrimary,
        border:     colors.border,
      },
    };
  }, [resolved, colors]);

  const statusStyle = resolved === 'dark' ? 'light' : 'dark';

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
              headerBackTitle: '',
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
 * AuthedApp gates on authentication state.
 *
 * ThemeProvider is mounted only when the user is authenticated, because:
 *   1. user_preferences is per-user — no valid row exists for unauthenticated
 *   2. Splash and sign-in screens use hardcoded dark colors; no token system needed
 *
 * Once userId is known, ThemeProvider(userId) fetches the stored preference
 * and provides the full color token system to AppContent and all its descendants.
 */
function AuthedApp() {
  const { userId, loading } = useAuth();

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
    <ThemeProvider userId={userId}>
      <AppContent />
    </ThemeProvider>
  );
}

/**
 * App is the true root. AuthProvider covers the entire tree so both
 * AuthedApp (preference fetch) and AppContent (auth gating) share one
 * auth subscription.
 */
export default function App() {
  return (
    <AuthProvider>
      <AuthedApp />
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
