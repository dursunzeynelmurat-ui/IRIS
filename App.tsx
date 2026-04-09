import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { EventListScreen } from './src/screens/EventListScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
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
