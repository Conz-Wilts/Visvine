import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Image,
  Dimensions,
  Pressable,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { DirectoryMember } from '../../types';
import api from '../../services/api';
import { useCommunity } from '../../contexts/CommunityContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSearch } from '../../contexts/SearchContext';
import ScreenHeader from '../../components/ScreenHeader';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;
const CARD_HEIGHT = CARD_WIDTH / 0.722;
const IMAGE_HEIGHT = CARD_HEIGHT / 2;

const DEFAULT_TYPE_COLORS: Record<string, string> = {
  person: '#2563eb',
  community: '#78d870',
  resource: '#f59e0b',
  event: '#9333ea',
};
const getTypeColor = (type: string) =>
  DEFAULT_TYPE_COLORS[type.toLowerCase()] ?? '#6b7280';

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Mirrors apps/web/hooks/useDashboardSearch.ts — name-only relevance scoring.
function searchScore(needle: string, name: string): number {
  const n = name.toLowerCase();
  if (n === needle) return 10000;
  const idx = n.indexOf(needle);
  if (idx === -1) return 0;
  if (idx === 0) return 5000 - needle.length;
  return 1000 - idx * 10;
}

type SortOrder = 'az' | 'za';
type DropdownKind = 'type' | 'tag' | null;

export default function DirectoryScreen() {
  const navigation = useNavigation();
  const { currentCommunity } = useCommunity();
  const { colors } = useTheme();
  const { query, setPlaceholder } = useSearch();

  useFocusEffect(
    useCallback(() => {
      setPlaceholder('Search directory');
    }, [setPlaceholder])
  );

  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>('az');
  const [openDropdown, setOpenDropdown] = useState<DropdownKind>(null);

  const fetchMembers = useCallback(async () => {
    if (!currentCommunity) {
      setMembers([]);
      setIsLoading(false);
      return;
    }

    const response = await api.getDirectoryMembers(currentCommunity.id);

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setMembers(response.data.nodes);
      setError(null);
    }
  }, [currentCommunity]);

  useEffect(() => {
    setIsLoading(true);
    fetchMembers().finally(() => setIsLoading(false));
  }, [fetchMembers]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchMembers();
    setIsRefreshing(false);
  }, [fetchMembers]);

  const presentTypes = useMemo(() => {
    const types = new Set<string>();
    members.forEach(m => types.add(m.type));
    return Array.from(types).sort();
  }, [members]);

  const presentTags = useMemo(() => {
    const tags = new Set<string>();
    members.forEach(m => (m.tags ?? []).forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    let result = members;
    if (selectedTypes.size > 0) {
      result = result.filter(m => selectedTypes.has(m.type));
    } else {
      result = result.filter(m => m.type.toLowerCase() === 'person');
    }
    if (selectedTags.size > 0) {
      result = result.filter(m => (m.tags ?? []).some(t => selectedTags.has(t)));
    }

    const needle = query.trim().toLowerCase();
    if (needle) {
      // Web parity: strict name-includes, sorted by relevance score (overrides A–Z/Z–A while searching).
      return result
        .map(m => ({ m, s: searchScore(needle, m.name) }))
        .filter(r => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(r => r.m);
    }

    return [...result].sort((a, b) =>
      sortOrder === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    );
  }, [members, selectedTypes, selectedTags, sortOrder, query]);

  const toggleInSet = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const hasFilters =
    selectedTypes.size > 0 ||
    selectedTags.size > 0 ||
    sortOrder !== 'az';
  const clearFilters = () => {
    setSelectedTypes(new Set());
    setSelectedTags(new Set());
    setSortOrder('az');
  };

  const renderDropdownButton = (
    label: string,
    selected: Set<string>,
    kind: DropdownKind
  ) => {
    const count = selected.size;
    return (
      <Pressable
        onPress={() => setOpenDropdown(kind)}
        style={[
          styles.dropdownBtn,
          {
            backgroundColor: count > 0 ? (colors.accent ?? '#2563eb') : colors.bgPrimary,
            borderColor: count > 0 ? (colors.accent ?? '#2563eb') : (colors.borderDefault ?? '#e5e7eb'),
          },
        ]}
      >
        <Text
          style={[
            styles.dropdownBtnText,
            { color: count > 0 ? '#fff' : (colors.textSecondary ?? colors.textPrimary) },
          ]}
        >
          {label}
          {count > 0 ? ` · ${count}` : ''}
        </Text>
        <Ionicons
          name="chevron-down"
          size={14}
          color={count > 0 ? '#fff' : (colors.textSecondary ?? colors.textPrimary)}
        />
      </Pressable>
    );
  };

  const renderFilters = () => (
    <View style={styles.filtersWrap}>
      <View style={styles.controlsRow}>
        {renderDropdownButton('Type', selectedTypes, 'type')}
        {renderDropdownButton('Tag', selectedTags, 'tag')}

        <Pressable
          onPress={() => setSortOrder(o => (o === 'az' ? 'za' : 'az'))}
          style={[styles.sortBtn, { backgroundColor: colors.bgPrimary, borderColor: colors.borderDefault ?? '#e5e7eb' }]}
        >
          <Ionicons
            name={sortOrder === 'az' ? 'arrow-down' : 'arrow-up'}
            size={14}
            color={colors.textSecondary ?? colors.textPrimary}
          />
          <Text style={[styles.sortBtnText, { color: colors.textSecondary ?? colors.textPrimary }]}>
            {sortOrder === 'az' ? 'A–Z' : 'Z–A'}
          </Text>
        </Pressable>

        {hasFilters && (
          <Pressable onPress={clearFilters} style={styles.clearBtn}>
            <Ionicons name="close" size={14} color={colors.textMuted} />
            <Text style={[styles.clearBtnText, { color: colors.textMuted }]}>Clear</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const renderMember = ({ item }: { item: DirectoryMember }) => {
    const initials = item.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const typeColor = getTypeColor(item.type);
    const subtitle = item.subtitle || item.title;
    const isPerson = item.type.toLowerCase() === 'person';

    const handlePress = () => {
      if (!isPerson) return;
      (navigation as any).navigate('FullProfile', {
        personId: item.id,
        initialName: item.name,
      });
    };

    return (
      <Pressable
        onPress={handlePress}
        disabled={!isPerson}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.bgPrimary,
            borderColor: typeColor,
            shadowColor: typeColor,
            opacity: pressed && isPerson ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.cardImageContainer}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardPlaceholder, { backgroundColor: typeColor }]}>
              <Text style={styles.cardPlaceholderText}>{initials}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardContent}>
          <Text style={[styles.cardName, { color: colors.textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          {subtitle && (
            <Text style={[styles.cardSubtitle, { color: colors.textPrimary }]} numberOfLines={2}>
              {subtitle}
            </Text>
          )}
          <View style={[styles.typePill, { backgroundColor: typeColor }]}>
            <Text style={styles.typePillText}>{capitalize(item.type)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const dropdownConfig = useMemo(() => {
    if (openDropdown === 'type') {
      return {
        title: 'Filter by Type',
        options: presentTypes.map(t => capitalize(t)),
        values: presentTypes,
        selected: selectedTypes,
        onToggle: (v: string) => setSelectedTypes(prev => toggleInSet(prev, v)),
        onClear: () => setSelectedTypes(new Set()),
      };
    }
    if (openDropdown === 'tag') {
      return {
        title: 'Filter by Tag',
        options: presentTags,
        values: presentTags,
        selected: selectedTags,
        onToggle: (v: string) => setSelectedTags(prev => toggleInSet(prev, v)),
        onClear: () => setSelectedTags(new Set()),
      };
    }
    return null;
  }, [openDropdown, presentTypes, presentTags, selectedTypes, selectedTags]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bgSecondary }]}>
      <ScreenHeader />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <>
          {error && (
            <View style={[styles.errorContainer, { backgroundColor: colors.bgTertiary }]}>
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <FlatList
            data={filteredMembers}
            keyExtractor={item => item.id}
            renderItem={renderMember}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={renderFilters}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="people-outline" size={36} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {currentCommunity
                    ? hasFilters
                      ? 'No members match filters'
                      : 'No members found'
                    : 'Select a community'}
                </Text>
              </View>
            }
          />
        </>
      )}

      <Modal
        visible={openDropdown !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenDropdown(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenDropdown(null)}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: colors.bgPrimary }]}
            onPress={e => e.stopPropagation?.()}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {dropdownConfig?.title}
              </Text>
              <Pressable onPress={() => setOpenDropdown(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {dropdownConfig && dropdownConfig.values.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: colors.textMuted }]}>
                None available
              </Text>
            ) : (
              <FlatList
                data={dropdownConfig?.values ?? []}
                keyExtractor={v => v}
                style={{ maxHeight: 420 }}
                renderItem={({ item, index }) => {
                  const label = dropdownConfig!.options[index];
                  const active = dropdownConfig!.selected.has(item);
                  return (
                    <Pressable
                      onPress={() => dropdownConfig!.onToggle(item)}
                      style={[
                        styles.modalRow,
                        { borderBottomColor: colors.borderSubtle ?? 'rgba(0,0,0,0.06)' },
                      ]}
                    >
                      <Text style={[styles.modalRowText, { color: colors.textPrimary }]}>
                        {label}
                      </Text>
                      <Ionicons
                        name={active ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={active ? (colors.accent ?? '#2563eb') : colors.textMuted}
                      />
                    </Pressable>
                  );
                }}
              />
            )}

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => dropdownConfig?.onClear()}
                style={styles.modalClearBtn}
              >
                <Text style={[styles.modalClearText, { color: colors.textMuted }]}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={() => setOpenDropdown(null)}
                style={[styles.modalDoneBtn, { backgroundColor: colors.accent ?? '#2563eb' }]}
              >
                <Text style={styles.modalDoneText}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
  },
  errorText: {
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  row: {
    justifyContent: 'space-between',
  },
  filtersWrap: {
    marginBottom: 12,
    gap: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
  },
  dropdownBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 32,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalEmpty: {
    paddingVertical: 24,
    textAlign: 'center',
    fontSize: 14,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowText: {
    fontSize: 15,
    fontWeight: '500',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
  },
  modalClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalClearText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalDoneBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  modalDoneText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    borderWidth: 4,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.33,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
  },
  cardImageContainer: {
    height: IMAGE_HEIGHT,
    width: '100%',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPlaceholderText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    flex: 1,
    alignItems: 'center',
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 'auto',
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
