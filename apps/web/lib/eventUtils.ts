/**
 * Event-related utility functions
 */

import type { NBEvent, NBAttendee, RSVPStatus } from './types';
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

  // Escape special characters in iCalendar format. Fold every newline variant
  // (CRLF / CR / LF) so a bare \r can't inject extra calendar lines on this
  // unauthenticated endpoint.
  const escape = (str: string) => str.replace(/[,;\\]/g, '\\$&').replace(/\r\n|\r|\n/g, '\\n');

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

// ─── RSVP status helpers ───────────────────────────────────────────────────────

/**
 * Normalize an attendee status to the current vocabulary.
 * Legacy rows used 'registered' for what we now call 'going'.
 */
export function normalizeStatus(status: string | null | undefined): RSVPStatus {
  if (!status || status === 'registered') return 'going';
  return status as RSVPStatus;
}

/** Statuses that hold a confirmed seat at the event. */
const CONFIRMED_STATUSES: RSVPStatus[] = ['going', 'checked_in'];

/**
 * How many capacity spots a single attendee occupies. A confirmed guest takes
 * 1 + their plus-ones; a "maybe" reserves nothing; everyone else (waitlisted,
 * pending, cancelled, no_show, invited) takes nothing.
 */
export function spotsTaken(a: Pick<NBAttendee, 'status' | 'response' | 'plusOnes'>): number {
  if (a.response === 'maybe') return 0;
  if (!CONFIRMED_STATUSES.includes(normalizeStatus(a.status))) return 0;
  return 1 + (a.plusOnes ?? 0);
}

/** Total confirmed spots taken across an attendee list (for capacity math). */
export function occupiedSpots(attendees: Array<Pick<NBAttendee, 'status' | 'response' | 'plusOnes'>>): number {
  return attendees.reduce((sum, a) => sum + spotsTaken(a), 0);
}

/**
 * Decide the operational status for a new/updated RSVP given the guest's
 * response and the event's current occupancy.
 */
export function decideRsvpStatus(
  response: NBAttendee['response'],
  party: number,
  opts: { capacity?: number; requireApproval?: boolean; occupied: number; isExistingConfirmed?: boolean; waitlistEnabled?: boolean },
): RSVPStatus | 'full' {
  if (response === 'declined') return 'cancelled';
  if (response === 'maybe') return 'going'; // present but non-occupying
  if (opts.requireApproval) return 'pending';
  // Already-confirmed guests editing their RSVP keep their seat.
  if (opts.isExistingConfirmed) return 'going';
  if (opts.capacity && opts.occupied + party > opts.capacity) {
    // Over capacity: waitlist by default; only reject ('full') when the host has
    // explicitly disabled the waitlist.
    return opts.waitlistEnabled === false ? 'full' : 'waitlisted';
  }
  return 'going';
}

