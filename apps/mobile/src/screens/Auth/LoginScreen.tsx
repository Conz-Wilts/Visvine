import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import type { AppStackParamList } from '../../navigation/AppNavigator';

// Required: tells the in-app browser to close itself when the deep link fires
WebBrowser.maybeCompleteAuthSession();

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
const DEV_AUTH_ENABLED = process.env.EXPO_PUBLIC_DEV_AUTH === 'true';

export default function LoginScreen() {
  const { handleDeepLink } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [isSigningIn, setIsSigningIn] = React.useState(false);

  // Generate a random state for CSRF protection
  const [oauthState] = React.useState(() => Math.random().toString(36).substring(2));

  // Deep link URI that Google redirects back to via our server
  const redirectUri = makeRedirectUri({
    scheme: 'visvine',
    path: 'auth/callback',
  });

  const googleAuthUrl = useCallback(() => {
    const params = new URLSearchParams({
      client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '',
      redirect_uri: `${API_URL}/api/auth/callback/google-mobile`,
      response_type: 'code',
      scope: 'openid email profile',
      state: encodeURIComponent(JSON.stringify({
        state: oauthState,
        redirectUri,
        callbackUrl: '/directory',
      })),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }, [oauthState, redirectUri]);

  const handleGoogleSignIn = async () => {
    try {
      setIsSigningIn(true);

      // openAuthSessionAsync monitors for the visvine:// redirect and auto-closes
      // the browser — no white screen, no manual X press needed.
      const result = await WebBrowser.openAuthSessionAsync(
        googleAuthUrl(),
        redirectUri,
      );

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return;
      }

      if (result.type === 'success' && result.url) {
        // openAuthSessionAsync intercepts the redirect before the OS Linking
        // event fires, so we must manually pass the URL to the auth handler.
        await handleDeepLink(result.url);
      }

    } catch (error) {
      console.error('Google sign in error:', error);
      Alert.alert('Sign in failed', 'Please try again');
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Ionicons name="git-network" size={64} color={colors.brand.green} />
          </View>
          <Text style={styles.title}>Visvine</Text>
          <Text style={styles.subtitle}>Connect with your community</Text>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.googleButton, isSigningIn && styles.googleButtonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? (
              <ActivityIndicator color={colors.background.primary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={24} color={colors.background.primary} />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {DEV_AUTH_ENABLED && (
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => navigation.navigate('DevLogin')}
            >
              <Ionicons name="construct-outline" size={20} color={colors.brand.darkGreen} />
              <Text style={styles.devButtonText}>Dev login (skip Google)</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          By signing in, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brand.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.brand.lightBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.brand.black,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: colors.text.muted,
    marginTop: 8,
    letterSpacing: 0.2,
  },
  buttons: {
    gap: 12,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.green,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    gap: 12,
    shadowColor: colors.brand.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleButtonText: {
    color: colors.background.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  devButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.lightBg,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.brand.darkGreen,
  },
  devButtonText: {
    color: colors.brand.darkGreen,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    fontSize: 12,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: 32,
    paddingHorizontal: 16,
  },
});
