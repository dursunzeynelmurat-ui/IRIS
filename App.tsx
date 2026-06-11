import { DefaultTheme, DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { FeedPreferenceProvider } from './src/context/FeedPreferenceContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useAuth } from './src/hooks/useAuth';
import { useUserPreferences } from './src/hooks/useUserPreferences';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { MySignalsScreen } from './src/screens/MySignalsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SendSignalScreen } from './src/screens/SendSignalScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
        <StatusBar style={statusStyle} />
        <Stack.Navigator>
          {/* ── Tab-level screens ── */}
          <Stack.Screen
            name="EventList"
            component={EventListScreen}
            options={{ headerShown: false, animation: 'none' }}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ headerShown: false, animation: 'none' }}
          />

          {/* ── Deep screens ── */}
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
              title: 'Preferences',
              headerBackTitle: '',
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="SendSignal"
            component={SendSignalScreen}
            options={{
              title: 'Send a Signal',
              headerBackTitle: '',
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen
            name="MySignals"
            component={MySignalsScreen}
            options={{
              title: 'My Signals',
              headerBackTitle: '',
              headerShadowVisible: false,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

function AuthedApp() {
  const { userId, loading } = useAuth();
  const { theme, defaultFeed, updateTheme, updateDefaultFeed } = useUserPreferences(userId);

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
    <ThemeProvider savedPreference={theme} onSavePreference={updateTheme}>
      <FeedPreferenceProvider savedFeed={defaultFeed} onSaveFeed={updateDefaultFeed}>
        <AppContent />
      </FeedPreferenceProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthedApp />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashWordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 8,
  },
  splashSpinner: {
    marginTop: 28,
  },
});
