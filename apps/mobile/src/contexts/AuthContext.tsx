import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import type { User, AuthState } from '../types';
import api from '../services/api';

const TOKEN_KEY = 'auth_token';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null, token?: string) => void;
  handleDeepLink: (url: string) => Promise<void>;
  pendingRoute: string | null;
  clearPendingRoute: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const handledUrls = useRef<Set<string>>(new Set());

  const handleDeepLink = useCallback(async (url: string) => {
    if (handledUrls.current.has(url)) return;

    // Match our OAuth callback path
    const parsed = Linking.parse(url);
    const path = parsed.path ?? '';
    if (!path.includes('auth/callback')) return;

    handledUrls.current.add(url);

    const token = parsed.queryParams?.token as string | undefined;
    const callbackUrl = parsed.queryParams?.callbackUrl as string | undefined;

    if (!token) return;

    setState(prev => ({ ...prev, isLoading: true }));
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      api.setAuthToken(token);

      const response = await api.getSession();
      if (response.data) {
        // Decode callbackUrl and map to a tab name
        const decoded = callbackUrl ? decodeURIComponent(callbackUrl) : '/directory';
        const route = decoded.replace(/^\//, ''); // strip leading slash
        // Capitalise first letter to match tab name (e.g. "directory" → "Directory")
        const tabName = route.charAt(0).toUpperCase() + route.slice(1);
        setPendingRoute(tabName || 'Directory');

        setState({
          user: response.data,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        api.setAuthToken(null);
        setState({ user: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    checkSession();

    // Handle deep links while the app is already open
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    // Handle the deep link that launched the app (cold start)
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink(url);
    });

    return () => subscription.remove();
  }, [handleDeepLink]);

  const checkSession = async () => {
    try {
      // Restore token from secure storage on app start
      const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (storedToken) {
        api.setAuthToken(storedToken);
      }

      const response = await api.getSession();
      if (response.data) {
        setState({
          user: response.data,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        // Token is invalid or expired — clear it
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        api.setAuthToken(null);
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    } catch {
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  };

  const login = useCallback(async (_email: string, _password: string) => {
    // Email/password login not supported — use Google OAuth via LoginScreen
    throw new Error('Use Google OAuth to sign in');
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/api/auth/signout`, {
        method: 'POST',
      });
    } catch {
      // Ignore logout errors
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    api.setAuthToken(null);
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  const setUser = useCallback((user: User | null, token?: string) => {
    if (token) {
      // Fire-and-forget — token persisted for next app start
      SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
      api.setAuthToken(token);
    }
    setState(prev => ({
      ...prev,
      user,
      isAuthenticated: !!user,
    }));
  }, []);

  const clearPendingRoute = useCallback(() => setPendingRoute(null), []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setUser, handleDeepLink, pendingRoute, clearPendingRoute }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
