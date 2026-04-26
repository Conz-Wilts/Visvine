import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ConversationsListScreen from '../screens/Messaging/ConversationsListScreen';
import ConversationScreen from '../screens/Messaging/ConversationScreen';
import { colors } from '../theme';

export type MessagesStackParamList = {
  ConversationsList: undefined;
  Conversation: { conversationId: string; conversationName?: string };
};

const Stack = createNativeStackNavigator<MessagesStackParamList>();

export default function MessagesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ConversationsList"
        component={ConversationsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Conversation"
        component={ConversationScreen}
        options={({ route }) => ({
          title: route.params.conversationName || 'Chat',
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
