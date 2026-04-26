import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DirectoryScreen from '../screens/Directory/DirectoryScreen';
import FullProfileScreen from '../screens/Profile/FullProfileScreen';

export type DirectoryStackParamList = {
  DirectoryList: undefined;
  FullProfile: { personId: string; initialName?: string };
};

const Stack = createNativeStackNavigator<DirectoryStackParamList>();

export default function DirectoryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DirectoryList" component={DirectoryScreen} />
      <Stack.Screen
        name="FullProfile"
        component={FullProfileScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
