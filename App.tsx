import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuth } from './src/hooks/useAuth';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * AppContent renders the auth-gated navigation tree.
 * It consumes auth state from AuthContext — no new Supabase subscription.
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
    <ErrorBoundary>
      <NavigationContainer theme={DarkTheme}>
        <StatusBar style="light" />
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
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
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
