import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { Conversation } from '../../types';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSearch } from '../../contexts/SearchContext';
import ScreenHeader from '../../components/ScreenHeader';

function searchScore(needle: string, name: string): number {
  const n = name.toLowerCase();
  if (n === needle) return 10000;
  const idx = n.indexOf(needle);
  if (idx === -1) return 0;
  if (idx === 0) return 5000 - needle.length;
  return 1000 - idx * 10;
}

export default function ConversationsListScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();

  const { query, setPlaceholder } = useSearch();

  useFocusEffect(
    useCallback(() => {
      setPlaceholder('Search conversations');
    }, [setPlaceholder])
  );

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    const response = await api.getConversations();

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setConversations(response.data.conversations);
      setError(null);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchConversations().finally(() => setIsLoading(false));
  }, [fetchConversations]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchConversations();
    setIsRefreshing(false);
  }, [fetchConversations]);

  const getDisplayName = useCallback(
    (c: Conversation) => {
      const other = c.participants.find(p => p.id !== user?.id);
      return c.type === 'GROUP' ? c.name : other?.name || 'Unknown';
    },
    [user?.id]
  );

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations
      .map(c => ({ c, s: searchScore(needle, getDisplayName(c) ?? '') }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(r => r.c);
  }, [conversations, query, getDisplayName]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const displayName = getDisplayName(item);

    return (
      <TouchableOpacity
        style={[styles.conversationItem, { borderBottomColor: colors.borderLight }]}
        onPress={() => {
          (navigation as any).navigate('Conversation', {
            conversationId: item.id,
            conversationName: displayName,
          });
        }}
      >
        <View style={[styles.avatar, { backgroundColor: colors.accentLight }]}>
          <Text style={[styles.avatarText, { color: colors.accentDark }]}>
            {displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.conversationName, { color: colors.textPrimary }]} numberOfLines={1}>
              {displayName}
            </Text>
            {item.lastMessage && (
              <Text style={[styles.timestamp, { color: colors.textMuted }]}>
                {formatTime(item.lastMessage.createdAt)}
              </Text>
            )}
          </View>
          <View style={styles.messagePreview}>
            {item.lastMessage ? (
              <Text style={[styles.lastMessage, { color: colors.textMuted }]} numberOfLines={1}>
                {item.lastMessage.sender.name}: {item.lastMessage.text}
              </Text>
            ) : (
              <Text style={[styles.lastMessage, { color: colors.textMuted }]}>No messages yet</Text>
            )}
            {item.unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.bgPrimary }]}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <ScreenHeader showCommunitySelector={false} />

      {error && (
        <View style={[styles.errorContainer, { backgroundColor: colors.bgTertiary }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={item => item.id}
          renderItem={renderConversation}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={48} color={colors.borderDefault} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {query ? 'No conversations found' : 'No messages yet'}
              </Text>
            </View>
          }
        />
      )}
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  listContent: {
    flexGrow: 1,
  },
  conversationItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
  },
  conversationContent: {
    flex: 1,
    marginLeft: 12,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    marginLeft: 8,
  },
  messagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorContainer: {
    padding: 16,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
});
