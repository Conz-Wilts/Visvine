/**
 * Event-related utility functions
 */

import type { NBEvent } from './types';
import { createHash } from 'crypto';

/**
 * Convert text to kebab-case slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generate event ID from title and start date
 */
export function generateEventId(title: string, startAt: string): `event:${string}` {
  const slug = slugify(title);
  const date = new Date(startAt);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  return `event:${slug}-${dateStr}`;
}

/**
 * Generate attendee ID from event ID and email/identifier
 */
export function generateAttendeeId(
  eventId: string,
  identifier: string
): `attendee:${string}` {
  const hash = createHash('md5')
    .update(`${eventId}:${identifier.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 8);
  return `attendee:${eventId}:${hash}`;
}

/**
 * Format event date range in human-readable format
 */
export function formatEventDateRange(
  start: string,
  end?: string,
  timezone?: string
): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;

  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };

  if (timezone) {
    dateOptions.timeZone = timezone;
    timeOptions.timeZone = timezone;
  }

  const datePart = startDate.toLocaleDateString('en-US', dateOptions);
  const startTime = startDate.toLocaleTimeString('en-US', timeOptions);

  if (endDate) {
    const endTime = endDate.toLocaleTimeString('en-US', timeOptions);
    const sameDay = startDate.toDateString() === endDate.toDateString();

    if (sameDay) {
      return `${datePart}, ${startTime} – ${endTime}`;
    } else {
      const endDatePart = endDate.toLocaleDateString('en-US', dateOptions);
      return `${datePart} ${startTime} – ${endDatePart} ${endTime}`;
    }
  }

  return `${datePart}, ${startTime}`;
}

/**
 * Normalize LinkedIn URL to standard format
 */
export function normalizeLinkedIn(url: string): string {
  if (!url) return '';

  let normalized = url.trim().toLowerCase();

  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//i, '');

  // Remove www
  normalized = normalized.replace(/^www\./i, '');

  // Ensure it starts with linkedin.com
  if (!normalized.startsWith('linkedin.com/')) {
    if (normalized.startsWith('in/')) {
      normalized = `linkedin.com/${normalized}`;
    } else {
      normalized = `linkedin.com/in/${normalized}`;
    }
  }

  // Remove trailing slashes and query params
  normalized = normalized.split('?')[0].replace(/\/$/, '');

  // Add https protocol back
  return `https://${normalized}`;
}

/**
 * Generate iCalendar (.ics) format for event
 */
export function makeICS(event: NBEvent): string {
  const now = new Date();
  const dtStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const startDate = new Date(event.startAt);
  const dtStart = startDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const endDate = event.endAt ? new Date(event.endAt) : new Date(startDate.getTime() + 3600000);
  const dtEnd = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const location = event.location?.label || '';
  const description = event.description || '';
  const title = event.title;

  // Escape special characters in iCalendar format
  const escape = (str: string) => str.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Visvine//Events//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${event.id}@visvine.com
DTSTAMP:${dtStamp}
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${escape(title)}
DESCRIPTION:${escape(description)}
LOCATION:${escape(location)}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;
}

/**
 * Check if email domain is in allowlist
 */
export function isEmailDomainAllowed(
  email: string,
  allowlist?: string[]
): boolean {
  if (!allowlist || allowlist.length === 0) return true;

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  return allowlist.some((allowed) => domain === allowed.toLowerCase());
}

/**
 * Format date for display (shorter format)
 */
export function formatEventDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format time for display
 */
export function formatEventTime(date: string): string {
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Check if event is in the past
 */
export function isEventPast(endAt?: string, startAt?: string): boolean {
  const compareDate = endAt || startAt;
  if (!compareDate) return false;
  return new Date(compareDate) < new Date();
}

/**
 * Check if event is upcoming (starts in the future)
 */
export function isEventUpcoming(startAt: string): boolean {
  return new Date(startAt) > new Date();
}

/**
 * Short date for calendar badge display (e.g., { month: "MAY", day: "14" })
 */
export function formatEventDateShort(startAt: string): { month: string; day: string } {
  const d = new Date(startAt);
  return {
    month: d.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
  };
}

/**
 * Get event status based on current time
 */
export function getEventStatus(startAt: string, endAt?: string): 'upcoming' | 'live' | 'past' {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : start + 3 * 60 * 60 * 1000;

  if (now < start) return 'upcoming';
  if (now <= end) return 'live';
  return 'past';
}

