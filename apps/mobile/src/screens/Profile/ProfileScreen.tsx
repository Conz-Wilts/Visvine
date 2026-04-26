import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useCommunity } from '../../contexts/CommunityContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { DirectoryMember } from '../../types';
import api from '../../services/api';

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { user, logout } = useAuth();
  const { communities, currentCommunity } = useCommunity();
  const { colors } = useTheme();

  const [profile, setProfile] = useState<DirectoryMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const response = await api.getProfile(user.nodeId || user.id);
      if (response.data) {
        setProfile(response.data);
      }
      setIsLoading(false);
    };

    fetchProfile();
  }, [user]);

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  const handleEditProfile = () => {
    (navigation as any).navigate('EditProfile');
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgSecondary }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const displayName = profile?.name || user?.name || '';
  const initials = displayName
    ? displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgSecondary }}
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.bgPrimary, borderBottomColor: colors.borderLight }]}>
        <View style={styles.avatarContainer}>
          {(profile?.image_url || (profile as any)?.imageUrl || user?.image) ? (
            <Image source={{ uri: profile?.image_url || (profile as any)?.imageUrl || user?.image! }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.accentLight }]}>
              <Text style={[styles.avatarText, { color: colors.accentDark }]}>{initials}</Text>
            </View>
          )}
          <TouchableOpacity style={[styles.editButton, { backgroundColor: colors.bgPrimary }]} onPress={handleEditProfile}>
            <Ionicons name="pencil" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.name, { color: colors.textPrimary }]}>{profile?.name || user?.name || 'Unknown'}</Text>
        {profile?.title && (
          <Text style={[styles.title, { color: colors.textMuted }]}>{profile.title}</Text>
        )}
        {profile?.company && (
          <Text style={[styles.company, { color: colors.textMuted }]}>{profile.company}</Text>
        )}
      </View>

      {/* Contact */}
      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Contact Information</Text>

        {user?.email && (
          <View style={styles.infoRow}>
            <Ionicons name="mail" size={20} color={colors.textMuted} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Email</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{user.email}</Text>
            </View>
          </View>
        )}

        {profile?.location && (
          <View style={styles.infoRow}>
            <Ionicons name="location" size={20} color={colors.textMuted} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Location</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{profile.location}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Communities */}
      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Communities</Text>
        {communities.map((community) => (
          <View
            key={community.id}
            style={[
              styles.communityItem,
              currentCommunity?.id === community.id && { backgroundColor: colors.accentLight, marginHorizontal: -16, paddingHorizontal: 16 },
            ]}
          >
            <View style={[styles.communityDot, { backgroundColor: colors.accent }]} />
            <Text
              style={[
                styles.communityName,
                { color: colors.textSecondary },
                currentCommunity?.id === community.id && { color: colors.accent, fontWeight: '500' },
              ]}
            >
              {community.name}
            </Text>
            {currentCommunity?.id === community.id && (
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
            )}
          </View>
        ))}
      </View>

      {/* Menu */}
      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <TouchableOpacity style={styles.menuItem} onPress={handleEditProfile}>
          <Ionicons name="person-outline" size={24} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={() => (navigation as any).navigate('Settings')}>
          <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Settings</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Ionicons name="notifications-outline" size={24} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Ionicons name="help-circle-outline" size={24} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Help & Support</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.version, { color: colors.textMuted }]}>Version 0.1.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 0,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '600',
  },
  editButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    marginBottom: 2,
  },
  company: {
    fontSize: 14,
  },
  section: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
  },
  communityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  communityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  communityName: {
    flex: 1,
    fontSize: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '500',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 24,
    marginBottom: 16,
  },
});
