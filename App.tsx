import { DefaultTheme, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
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

// Custom navigation themes with IRIS branding
const IRIS_DARK = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary:    '#e5193e',
    background: '#0d0d0d',
    card:       '#0d0d0d',
    text:       '#f2f2f2',
    border:     '#2c2c2e',
  },
};

const IRIS_LIGHT = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary:    '#c90f2e',
    background: '#f2f2f7',
    card:       '#ffffff',
    text:       '#0d0d0d',
    border:     '#c6c6c8',
  },
};

/**
 * AppContent renders the auth-gated navigation tree.
 * It consumes auth state from AuthContext and theme from ThemeContext.
 */
function AppContent() {
  const { userId, loading } = useAuth();
  const { resolved, colors } = useTheme();

  const navTheme = resolved === 'dark' ? IRIS_DARK : IRIS_LIGHT;
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
        <StatusBar style={statusStyle} />
        <Stack.Navigator>
          {/* ── Tab-level screens (no back button, custom tab bar rendered inside) ── */}
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

          {/* ── Deep screens (standard stack navigation) ── */}
          <Stack.Screen
            name="EventDetail"
            component={EventDetailScreen}
            options={{ title: 'Event Detail' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Appearance' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

/**
 * App is the true root. AuthProvider and ThemeProvider live here so they
 * cover the entire component tree with a single subscription each.
 */
export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
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
    color: '#e5193e',  // IRIS red on splash
    letterSpacing: 8,
  },
  splashSpinner: {
    marginTop: 28,
  },

  // ── Navigation header ──
  navTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 5,
  },
});
