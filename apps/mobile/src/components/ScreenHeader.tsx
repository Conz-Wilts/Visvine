import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Image,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCommunity } from '../contexts/CommunityContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import CommunityAvatar from './CommunityAvatar';

interface ScreenHeaderProps {
  showCommunitySelector?: boolean;
}

export default function ScreenHeader({ showCommunitySelector = true }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { communities, currentCommunity, setCurrentCommunity } = useCommunity();
  const { user } = useAuth();
  const { colors } = useTheme();

  const [pickerVisible, setPickerVisible] = useState(false);

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const handleProfilePress = () => {
    (navigation as any).navigate('Profile');
  };

  return (
    <>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.bgPrimary, borderBottomColor: colors.borderLight }]}>
        <View style={styles.inner}>
          {showCommunitySelector ? (
            <TouchableOpacity
              style={styles.communityBtn}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.7}
              accessibilityLabel="Switch community"
            >
              <CommunityAvatar
                name={currentCommunity?.name ?? ''}
                imageUrl={currentCommunity?.image}
                size={36}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.logoWrap}>
              <Ionicons name="git-network" size={22} color={colors.accent} />
              <Text style={[styles.logoText, { color: colors.textPrimary }]}>Visvine</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={handleProfilePress}
            activeOpacity={0.7}
          >
            {user?.image ? (
              <Image source={{ uri: user.image }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.avatarInitials, { color: colors.accentDark }]}>{initials}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerVisible(false)}>
          <View style={[styles.picker, { backgroundColor: colors.bgPrimary }]}>
            <View style={[styles.pickerHandle, { backgroundColor: colors.borderDefault }]} />
            <Text style={[styles.pickerTitle, { color: colors.textMuted, borderBottomColor: colors.borderLight }]}>
              Community
            </Text>
            <FlatList
              data={communities}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const active = currentCommunity?.id === item.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerRow,
                      { borderBottomColor: colors.borderLight },
                      active && { backgroundColor: colors.accentLight },
                    ]}
                    onPress={() => {
                      setCurrentCommunity(item);
                      setPickerVisible(false);
                    }}
                  >
                    <CommunityAvatar name={item.name} imageUrl={item.image} size={28} />
                    <Text style={[
                      styles.pickerRowText,
                      { color: colors.textSecondary },
                      active && { color: colors.accentDark, fontWeight: '600' },
                    ]}>
                      {item.name}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.pickerEmpty, { color: colors.textMuted }]}>No communities found</Text>
              }
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  inner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  communityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
  },
  avatarBtn: {
    marginLeft: 8,
  },
  avatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 15,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  picker: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    maxHeight: '60%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  pickerRowText: {
    flex: 1,
    fontSize: 16,
  },
  pickerEmpty: {
    textAlign: 'center',
    padding: 24,
    fontSize: 15,
  },
});
