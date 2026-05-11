import React, { useRef, useEffect } from 'react';
import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import TabNavigator from './TabNavigator';
import LoginScreen from '../screens/Auth/LoginScreen';
import DevLoginScreen from '../screens/Auth/DevLoginScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import EditProfileScreen from '../screens/Profile/EditProfileScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import Loading from '../components/Loading';

export type AppStackParamList = {
  Main: undefined;
  Login: undefined;
  DevLogin: undefined;
  Profile: undefined;
  EditProfile: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<AppStackParamList>();

export default function AppNavigator() {
  const { isAuthenticated, isLoading, pendingRoute, clearPendingRoute } = useAuth();
  const { colors } = useTheme();
  const navRef = useRef<NavigationContainerRef<AppStackParamList>>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated && pendingRoute && navRef.current?.isReady()) {
      navRef.current.navigate('Main');
      setTimeout(() => {
        const state = navRef.current?.getState();
        const mainRoute = state?.routes.find(r => r.name === 'Main');
        if (mainRoute) {
          navRef.current?.dispatch({
            type: 'NAVIGATE',
            payload: { name: pendingRoute },
          });
        }
        clearPendingRoute();
      }, 0);
    }
  }, [isLoading, isAuthenticated, pendingRoute, clearPendingRoute]);

  if (isLoading) {
    return <Loading fullScreen message="Signing you in…" />;
  }

  const modalHeaderOptions = {
    presentation: 'modal' as const,
    headerShown: true,
    headerStyle: { backgroundColor: colors.bgPrimary },
    headerTitleStyle: { fontWeight: '600' as const, color: colors.textPrimary },
    headerShadowVisible: false,
    headerTintColor: colors.accent,
  };

  return (
    <NavigationContainer ref={navRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ ...modalHeaderOptions, title: 'Profile' }}
            />
            <Stack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{ ...modalHeaderOptions, title: 'Edit Profile' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ ...modalHeaderOptions, title: 'Settings' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="DevLogin" component={DevLoginScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
