import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from './src/hooks/useAuth';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { userId, loading } = useAuth();

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
          component={EventListScreen}
          options={{ title: 'Events' }}
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
