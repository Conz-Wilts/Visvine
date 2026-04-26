import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import EventsListScreen from '../screens/Events/EventsListScreen';
import EventDetailScreen from '../screens/Events/EventDetailScreen';
import { colors } from '../theme';

export type EventsStackParamList = {
  EventsList: undefined;
  EventDetail: { eventId: string; eventTitle?: string };
};

const Stack = createNativeStackNavigator<EventsStackParamList>();

export default function EventsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="EventsList"
        component={EventsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EventDetail"
        component={EventDetailScreen}
        options={({ route }) => ({
          title: route.params.eventTitle || 'Event',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: colors.background.primary },
          headerTitleStyle: { fontWeight: '600', color: colors.text.primary },
          headerShadowVisible: false,
          headerTintColor: colors.brand.green,
        })}
      />
    </Stack.Navigator>
  );
}
