import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuth } from './src/hooks/useAuth';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * ThemedApp renders the navigation stack using the resolved theme from
 * ThemeContext. Separate from AppContent so useTheme() can be called inside
 * the ThemeProvider that wraps it.
 */
function ThemedApp() {
  const { navTheme, resolvedScheme } = useTheme();
  return (
    <ErrorBoundary>
      <NavigationContainer theme={navTheme}>
        <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
        <Stack.Navigator>
          <Stack.Screen
            name="EventList"
            component={EventListScreen}
            options={{
              title: 'IRIS',
              headerTitleStyle: styles.navTitle,
            }}
          />
          <Stack.Screen
            name="EventDetail"
            component={EventDetailScreen}
            options={{ title: 'Event Detail' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

/**
 * AppContent gates on auth state, then provides ThemeContext to the stack.
 * ThemeProvider is only mounted when authenticated — preferences are per-user.
 */
function AppContent() {
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
      <ThemedApp />
    </ThemeProvider>
  );
}

/**
 * App is the true root. AuthProvider lives here so the single
 * onAuthStateChange subscription covers the entire component tree.
 */
export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  // ── Splash / auth loading ──
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
  },
  splashWordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: '#f2f2f2',
    letterSpacing: 6,
  },
  splashSpinner: {
    marginTop: 24,
  },

  // ── Navigation header ──
  navTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 4,
  },
});
