import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Event } from '../../types';
import api from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';
import type { EventsStackParamList } from '../../navigation/EventsStack';

type EventDetailRouteProp = RouteProp<EventsStackParamList, 'EventDetail'>;

export default function EventDetailScreen() {
  const route = useRoute<EventDetailRouteProp>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { eventId } = route.params;

  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvent = async () => {
      const response = await api.getEvent(eventId);

      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        setEvent(response.data);
      }
      setIsLoading(false);
    };

    fetchEvent();
  }, [eventId]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.bgSecondary }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.bgSecondary }]}>
        <View style={[styles.errorIconWrap, { backgroundColor: colors.bgTertiary }]}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
        </View>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error || 'Event not found'}</Text>
      </View>
    );
  }

  const rsvpPercentage = event.capacity
    ? Math.round((event.analytics.rsvpCount / event.capacity) * 100)
    : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bgSecondary }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      <View style={[styles.header, { backgroundColor: colors.bgPrimary, borderBottomColor: colors.borderLight }]}>
        <View style={[styles.dateBadge, { backgroundColor: colors.accentLight }]}>
          <Text style={[styles.dateMonth, { color: colors.accentDark }]}>
            {new Date(event.startAt).toLocaleDateString('en-US', { month: 'short' })}
          </Text>
          <Text style={[styles.dateDay, { color: colors.textPrimary }]}>
            {new Date(event.startAt).getDate()}
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{event.title}</Text>
        {event.description && (
          <Text style={[styles.description, { color: colors.textMuted }]}>{event.description}</Text>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <View style={styles.infoRow}>
          <View style={[styles.infoIconWrap, { backgroundColor: colors.accentLight }]}>
            <Ionicons name="calendar" size={18} color={colors.accentDark} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Date</Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{formatDate(event.startAt)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={[styles.infoIconWrap, { backgroundColor: colors.accentLight }]}>
            <Ionicons name="time" size={18} color={colors.accentDark} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Time</Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
              {formatTime(event.startAt)}
              {event.endAt && ` - ${formatTime(event.endAt)}`}
            </Text>
          </View>
        </View>

        {event.timezone && (
          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.accentLight }]}>
              <Ionicons name="globe" size={18} color={colors.accentDark} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Timezone</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{event.timezone}</Text>
            </View>
          </View>
        )}

        {event.location && (
          <View style={[styles.infoRow, { marginBottom: 0 }]}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.accentLight }]}>
              <Ionicons name="location" size={18} color={colors.accentDark} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Location</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{event.location.label}</Text>
              {event.location.address && (
                <Text style={[styles.infoSubtext, { color: colors.textMuted }]}>{event.location.address}</Text>
              )}
            </View>
          </View>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Attendance</Text>
        <View style={styles.statsContainer}>
          <View style={[styles.statItem, { backgroundColor: colors.bgSecondary }]}>
            <Text style={[styles.statNumber, { color: colors.accentDark }]}>{event.analytics.rsvpCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>RSVPs</Text>
          </View>
          <View style={[styles.statItem, { backgroundColor: colors.bgSecondary }]}>
            <Text style={[styles.statNumber, { color: colors.accentDark }]}>{event.analytics.checkinCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Checked In</Text>
          </View>
          {event.capacity && (
            <View style={[styles.statItem, { backgroundColor: colors.bgSecondary }]}>
              <Text style={[styles.statNumber, { color: colors.success }]}>
                {event.capacity - event.analytics.rsvpCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Spots Left</Text>
            </View>
          )}
        </View>

        {event.capacity && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.bgTertiary }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(rsvpPercentage, 100)}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              {rsvpPercentage}% capacity
            </Text>
          </View>
        )}
      </View>

      {event.visibility !== 'public' && (
        <View style={[styles.visibilityContainer, { backgroundColor: colors.bgTertiary }]}>
          <Ionicons
            name={event.visibility === 'private' ? 'lock-closed' : 'people'}
            size={16}
            color={colors.textMuted}
          />
          <Text style={[styles.visibilityText, { color: colors.textMuted }]}>
            {event.visibility === 'private' ? 'Private event' : 'Community members only'}
          </Text>
        </View>
      )}

      <View style={styles.rsvpSection}>
        <TouchableOpacity
          style={[styles.rsvpButton, { backgroundColor: colors.accent }]}
          activeOpacity={0.7}
        >
          <Text style={styles.rsvpButtonText}>RSVP to Event</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
    padding: 24,
  },
  errorIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
  },
  dateBadge: {
    width: 56,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  dateMonth: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dateDay: {
    fontSize: 28,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    padding: 20,
    marginTop: 12,
    borderRadius: 16,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: {
    flex: 1,
    paddingTop: 2,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  infoSubtext: {
    fontSize: 14,
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  statNumber: {
    fontSize: 26,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  visibilityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  visibilityText: {
    fontSize: 14,
  },
  rsvpSection: {
    padding: 20,
  },
  rsvpButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  rsvpButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
