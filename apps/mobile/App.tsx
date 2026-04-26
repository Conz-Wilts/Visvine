import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/contexts/AuthContext';
import { CommunityProvider } from './src/contexts/CommunityContext';
import { ThemeProvider } from './src/contexts/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <CommunityProvider>
            <AppNavigator />
            <StatusBar style="auto" />
          </CommunityProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}