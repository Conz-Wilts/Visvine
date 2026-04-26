import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSearch } from '../contexts/SearchContext';
import { useTheme } from '../contexts/ThemeContext';

const BAR_HEIGHT = 64;
const BAR_MARGIN_H = 16;
const BAR_MARGIN_B = 20;

function GlassBg({ isDark, radius }: { isDark: boolean; radius: number }) {
  return (
    <>
      <BlurView
        intensity={Platform.OS === 'ios' ? 60 : 90}
        tint={isDark ? 'dark' : 'light'}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            overflow: 'hidden',
            backgroundColor:
              Platform.OS === 'android'
                ? isDark
                  ? 'rgba(30,30,34,0.82)'
                  : 'rgba(255,255,255,0.82)'
                : isDark
                ? 'rgba(30,30,34,0.5)'
                : 'rgba(255,255,255,0.5)',
          },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          },
        ]}
      />
    </>
  );
}

export default function SearchOverlay() {
  const { isOpen, query, setQuery, close, placeholder } = useSearch();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!isOpen) return null;

  const bottomOffset = keyboardVisible ? 6 : Math.max(insets.bottom, BAR_MARGIN_B);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.wrap}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.barRow,
            {
              paddingLeft: BAR_MARGIN_H,
              paddingRight: BAR_MARGIN_H,
              paddingBottom: bottomOffset,
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.inputBar}>
            <GlassBg isDark={isDark} radius={32} />
            <View style={styles.inputInner} pointerEvents="box-none">
              <MaterialIcons name="search" size={22} color={isDark ? '#ffffff' : '#000000'} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.textPrimary }]}
                returnKeyType="search"
                onSubmitEditing={close}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          </View>

          <Pressable onPress={close} hitSlop={8} style={styles.closeBtn}>
            <GlassBg isDark={isDark} radius={BAR_HEIGHT / 2} />
            <Ionicons name="close" size={26} color={isDark ? '#ffffff' : '#000000'} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputBar: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 20,
  },
  inputInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    height: '100%',
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  closeBtn: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 20,
  },
});
