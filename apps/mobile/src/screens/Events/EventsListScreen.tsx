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
import type { Event } from '../../types';
import api from '../../services/api';
import { useCommunity } from '../../contexts/CommunityContext';
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

export default function EventsListScreen() {
  const navigation = useNavigation();
  const { currentCommunity } = useCommunity();
  const { colors } = useTheme();
  const { query, setPlaceholder } = useSearch();

  useFocusEffect(
    useCallback(() => {
      setPlaceholder('Search events');
    }, [setPlaceholder])
  );

  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!currentCommunity) {
      setEvents([]);
      setIsLoading(false);
      return;
    }

    const response = await api.getEvents(currentCommunity.id);

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setEvents(response.data.events);
      setError(null);
    }
  }, [currentCommunity]);

  useEffect(() => {
    setIsLoading(true);
    fetchEvents().finally(() => setIsLoading(false));
  }, [fetchEvents]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchEvents();
    setIsRefreshing(false);
  }, [fetchEvents]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const isUpcoming = (dateString: string) => new Date(dateString) > new Date();

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return events;
    return events
      .map(e => ({ e, s: searchScore(needle, e.title) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(r => r.e);
  }, [events, query]);

  const renderEvent = ({ item }: { item: Event }) => {
    const upcoming = isUpcoming(item.startAt);

    return (
      <TouchableOpacity
        style={[styles.eventCard, { backgroundColor: colors.bgPrimary }]}
        onPress={() => {
          (navigation as any).navigate('EventDetail', {
            eventId: item.id,
            eventTitle: item.title,
          });
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.eventDate, { backgroundColor: colors.accentLight }]}>
          <Text style={[styles.eventMonth, { color: colors.accentDark }]}>
            {new Date(item.startAt).toLocaleDateString('en-US', { month: 'short' })}
          </Text>
          <Text style={[styles.eventDay, { color: colors.textPrimary }]}>
            {new Date(item.startAt).getDate()}
          </Text>
        </View>

        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text style={[styles.eventTitle, { color: colors.textPrimary }]} numberOfLines={2}>
              {item.title}
            </Text>
            {upcoming && (
              <View style={[styles.upcomingBadge, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.upcomingBadgeText, { color: colors.accentDark }]}>Upcoming</Text>
              </View>
            )}
          </View>

          {item.location && (
            <View style={styles.eventMeta}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.eventMetaText, { color: colors.textMuted }]} numberOfLines={1}>
                {item.location.label}
              </Text>
            </View>
          )}

          <View style={styles.eventMeta}>
            <Ionicons name="time-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.eventMetaText, { color: colors.textMuted }]}>
              {formatDate(item.startAt)} at {formatTime(item.startAt)}
            </Text>
          </View>

          <View style={styles.eventStats}>
            <View style={styles.stat}>
              <Ionicons name="people-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.statText, { color: colors.textMuted }]}>
                {item.analytics.rsvpCount} RSVPs
              </Text>
            </View>
            {item.capacity && (
              <View style={[styles.spotsBadge, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.spotsText, { color: colors.accentDark }]}>
                  {item.capacity - item.analytics.rsvpCount} spots left
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bgSecondary }]}>
      <ScreenHeader />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : !currentCommunity ? (
        <View style={styles.centerContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.bgTertiary }]}>
            <Ionicons name="calendar-outline" size={36} color={colors.textMuted} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>Select a community to view events</Text>
        </View>
      ) : (
        <>
          {error && (
            <View style={[styles.errorContainer, { backgroundColor: colors.bgTertiary }]}>
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <FlatList
            data={filteredEvents}
            keyExtractor={item => item.id}
            renderItem={renderEvent}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
            }
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="calendar-outline" size={36} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>No events found</Text>
              </View>
            }
          />
        </>
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
    gap: 12,
  },
  listContent: {
    padding: 16,
  },
  eventCard: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  eventDate: {
    width: 52,
    paddingVertical: 8,
    alignItems: 'center',
    marginRight: 14,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  eventMonth: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  eventDay: {
    fontSize: 22,
    fontWeight: '700',
  },
  eventContent: {
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  upcomingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  upcomingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 5,
  },
  eventMetaText: {
    fontSize: 13,
  },
  eventStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 10,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
  },
  spotsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  spotsText: {
    fontSize: 11,
    fontWeight: '500',
  },
  errorContainer: {
    padding: 16,
    margin: 16,
    borderRadius: 12,
  },
  errorText: {
    fontSize: 14,
  },
  emptyContainer: {
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
