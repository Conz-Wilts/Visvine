import React, { useRef } from 'react';
import { LayoutChangeEvent, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MessagesStack from './MessagesStack';
import EventsStack from './EventsStack';
import DirectoryStack from './DirectoryStack';
import { useTheme } from '../contexts/ThemeContext';
import { SearchProvider, useSearch } from '../contexts/SearchContext';
import SearchOverlay from '../components/SearchOverlay';

const Tab = createBottomTabNavigator();

const BAR_HEIGHT = 64;
const BAR_MARGIN_H = 16;
const BAR_MARGIN_B = 20;

const ICONS: Record<string, { focused: keyof typeof Ionicons.glyphMap; outline: keyof typeof Ionicons.glyphMap; label: string }> = {
  Directory: { focused: 'people', outline: 'people-outline', label: 'Directory' },
  Messages: { focused: 'chatbubbles', outline: 'chatbubbles-outline', label: 'Messages' },
  Events: { focused: 'calendar', outline: 'calendar-outline', label: 'Events' },
};

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

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const search = useSearch();
  const onSearchPress = () => {
    search.open();
  };
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomOffset = Math.max(insets.bottom, BAR_MARGIN_B);

  const pillRoutes = state.routes;

  const pillWidthRef = useRef(0);
  const pillRoutesRef = useRef(pillRoutes);
  pillRoutesRef.current = pillRoutes;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastDragIndex = useRef<number | null>(null);
  const onPillLayout = (e: LayoutChangeEvent) => {
    pillWidthRef.current = e.nativeEvent.layout.width;
  };

  const navigateToPillIndex = (i: number) => {
    const routes = pillRoutesRef.current;
    const clamped = Math.max(0, Math.min(routes.length - 1, i));
    const route = routes[clamped];
    if (!route) return;
    if (lastDragIndex.current === clamped) return;
    lastDragIndex.current = clamped;
    const focused = stateRef.current.routes.indexOf(route) === stateRef.current.index;
    if (!focused) {
      navigation.navigate(route.name);
    }
  };

  const resolveIndex = (x: number) => {
    const w = pillWidthRef.current;
    const routes = pillRoutesRef.current;
    if (w <= 0 || routes.length === 0) return 0;
    const inner = w - 12;
    const itemW = inner / routes.length;
    return Math.floor((x - 6) / itemW);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
      onPanResponderGrant: (e) => {
        lastDragIndex.current = null;
        navigateToPillIndex(resolveIndex(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => {
        navigateToPillIndex(resolveIndex(e.nativeEvent.locationX));
      },
      onPanResponderRelease: () => {
        lastDragIndex.current = null;
      },
      onPanResponderTerminate: () => {
        lastDragIndex.current = null;
      },
    }),
  ).current;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { left: BAR_MARGIN_H, right: BAR_MARGIN_H, bottom: bottomOffset }]}
    >
      <View style={styles.pill} onLayout={onPillLayout} {...panResponder.panHandlers}>
        <GlassBg isDark={isDark} radius={32} />
        <View style={styles.row} pointerEvents="none">
          {pillRoutes.map((route) => {
            const meta = ICONS[route.name];
            if (!meta) return null;
            const index = state.routes.indexOf(route);
            const focused = state.index === index;
            const tint = focused ? colors.accent : (isDark ? '#ffffff' : '#000000');
            return (
              <View key={route.key} style={styles.item}>

                <Ionicons name={focused ? meta.focused : meta.outline} size={22} color={tint} />
                <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
                  {meta.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={onSearchPress}
        style={styles.circle}
        android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: true }}
      >
        <GlassBg isDark={isDark} radius={BAR_HEIGHT / 2} />
        <MaterialIcons name="search" size={30} color={isDark ? '#ffffff' : '#000000'} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pill: {
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
  circle: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 20,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT - 12,
    marginVertical: 6,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});

export default function TabNavigator() {
  return (
    <SearchProvider>
      <Tab.Navigator
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Directory" component={DirectoryStack} />
        <Tab.Screen name="Messages" component={MessagesStack} />
        <Tab.Screen name="Events" component={EventsStack} />
      </Tab.Navigator>
      <SearchOverlay />
    </SearchProvider>
  );
}
