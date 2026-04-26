import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface LoadingProps {
  message?: string;
  fullScreen?: boolean;
}

export default function Loading({ message, fullScreen = false }: LoadingProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        fullScreen ? styles.fullScreen : styles.container,
        { backgroundColor: fullScreen ? colors.bgSecondary : undefined },
      ]}
    >
      <ActivityIndicator size="large" color={colors.accent} />
      {message && (
        <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    marginTop: 12,
    fontSize: 16,
  },
});
