import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface CommunityAvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function CommunityAvatar({ name, imageUrl, size = 28 }: CommunityAvatarProps) {
  const { colors } = useTheme();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [imageUrl]);

  const fontSize = Math.max(10, Math.round(size * 0.4));
  const showFallback = !imageUrl || errored;

  if (showFallback) {
    return (
      <View style={[styles.fallback, dimensions, { backgroundColor: colors.accent }]}>
        <Text style={[styles.initials, { fontSize }]}>{getInitials(name)}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: imageUrl! }}
      style={dimensions}
      onError={() => setErrored(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
