import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, COLOR_THEMES } from '../../contexts/ThemeContext';

export default function SettingsScreen() {
  const { theme, setTheme, isDark, toggleDark, colors } = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgSecondary }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Appearance</Text>

        {/* Dark mode */}
        <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
          <View style={styles.rowLeft}>
            <Ionicons
              name={isDark ? 'moon' : 'sunny-outline'}
              size={20}
              color={colors.accent}
              style={styles.rowIcon}
            />
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Dark Mode</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleDark}
            trackColor={{ false: colors.borderDefault, true: colors.accent }}
            thumbColor="#ffffff"
          />
        </View>

        {/* Theme colour */}
        <View style={styles.colourSection}>
          <View style={styles.colourHeader}>
            <Ionicons name="color-palette-outline" size={20} color={colors.accent} style={styles.rowIcon} />
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Theme Colour</Text>
            <Text style={[styles.themeName, { color: colors.textMuted }]}>{theme.name}</Text>
          </View>
          <View style={styles.swatchGrid}>
            {COLOR_THEMES.map((t) => {
              const active = theme.id === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTheme(t.id)}
                  accessibilityLabel={`Select ${t.name} theme`}
                  style={styles.swatchWrapper}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: t.accent },
                      active && {
                        shadowColor: t.accent,
                        shadowOpacity: 0.7,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 0 },
                        elevation: 6,
                        transform: [{ scale: 1.15 }],
                      },
                    ]}
                  />
                  {active && (
                    <View style={[styles.checkRing, { borderColor: t.accent }]}>
                      <Ionicons name="checkmark" size={10} color={t.accentDark} />
                    </View>
                  )}
                  <Text style={[styles.swatchName, { color: colors.textMuted }]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rowIcon: {
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16,
    flex: 1,
  },
  colourSection: {
    paddingTop: 14,
  },
  colourHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  themeName: {
    fontSize: 14,
    marginLeft: 'auto',
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingLeft: 32,
  },
  swatchWrapper: {
    alignItems: 'center',
    width: 44,
    position: 'relative',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  checkRing: {
    position: 'absolute',
    bottom: 16,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'white',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchName: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
