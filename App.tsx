import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from './src/lib/supabase';
import { useAuth } from './src/hooks/useAuth';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Runs once on startup. Logs Supabase connection status to the console. */
async function probeConnection() {
  console.log('[IRIS] Probing Supabase connection…');
  const { data, error } = await supabase
    .from('events')
    .select('id, title, trust_score')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[IRIS] Connection probe FAILED:', error.message);
    return;
  }

  if (data) {
    console.log('[IRIS] Connection OK — sample event:', data);
  } else {
    console.log('[IRIS] Connection OK — events table is empty.');
  }
}

export default function App() {
  const { userId, loading } = useAuth();

  // Connection probe — runs once, logs to console only
  useEffect(() => { probeConnection(); }, []);

  // Resolving session — show nothing rather than flash a wrong screen
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Not authenticated — show sign-in outside the navigator (no back button)
  if (!userId) {
    return (
      <>
        <StatusBar style="auto" />
        <SignInScreen />
      </>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator>
        <Stack.Screen
          name="EventList"
          component={HomeScreen}        // Phase 2 test — swap back to EventListScreen when done
          options={{ title: 'IRIS — Connection Test' }}
        />
        <Stack.Screen
          name="EventDetail"
          component={EventDetailScreen}
          options={{ title: 'Event Detail' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
