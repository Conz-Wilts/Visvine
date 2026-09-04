/**
 * Event-related utility functions
 */

import { mapLinksFor } from '@/lib/events/mapLink';
import type { NBEvent, NBAttendee, RSVPStatus, RSVPResponse } from './types';
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
  // Created note-first and not scheduled yet. Every formatter below would say
  // "Invalid Date"; this is the one sentence that is actually true.
  if (Number.isNaN(startDate.getTime())) return 'Date to be set';
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
    // Show the timezone once (on the end time) instead of on both times.
    const startTimeNoTz = startDate.toLocaleTimeString('en-US', { ...timeOptions, timeZoneName: undefined });
    const endTime = endDate.toLocaleTimeString('en-US', timeOptions);
    // Compare calendar days in the event's timezone, not the runtime's locale,
    // so cross-midnight events render as two dates.
    const sameDay =
      startDate.toLocaleDateString('en-CA', { timeZone: timezone }) ===
      endDate.toLocaleDateString('en-CA', { timeZone: timezone });

    if (sameDay) {
      return `${datePart}, ${startTimeNoTz} – ${endTime}`;
    } else {
      const endDatePart = endDate.toLocaleDateString('en-US', dateOptions);
      return `${datePart} ${startTimeNoTz} – ${endDatePart} ${endTime}`;
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

  normalized = normalized.replace(/^https?:\/\//i, '');

  normalized = normalized.replace(/^www\./i, '');

  // Ensure it starts with linkedin.com
  if (!normalized.startsWith('linkedin.com/')) {
    if (normalized.startsWith('in/')) {
      normalized = `linkedin.com/${normalized}`;
    } else {
      normalized = `linkedin.com/in/${normalized}`;
    }
  }

  normalized = normalized.split('?')[0].replace(/\/$/, '');

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

  const location = [event.location?.label, event.location?.address].filter(Boolean).join(', ');
  const mapLink = mapLinksFor(event.location)?.google;
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
LOCATION:${escape(location)}${mapLink ? `
URL:${mapLink}` : ''}
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
 * Labels of required registration questions a "going" RSVP left unanswered.
 * Required checkboxes (e.g. terms acceptance) must be true; everything else
 * must be a non-blank string. Maybe/declined responses skip the questions.
 */
export function missingRequiredAnswers(
  schema: NBEvent['form']['schema'] | undefined,
  submission: { response?: string; answers?: Record<string, string | boolean> },
): string[] {
  if (!schema?.length || submission.response !== 'going') return [];
  return schema
    .filter((f) => f.required)
    .filter((f) => {
      const v = submission.answers?.[f.id];
      return f.type === 'checkbox' ? v !== true : !(typeof v === 'string' && v.trim());
    })
    .map((f) => f.label);
}

/**
 * Format time for display
 */
export function formatEventTime(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
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
  // The calendar badge for an unscheduled event: no month, no number.
  if (Number.isNaN(d.getTime())) return { month: 'TBD', day: '·' };
  return {
    month: d.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
  };
}

/**
 * "Starts in …" countdown label for an upcoming event (null once started).
 * Shared by the events feed and the event detail page so the two never
 * disagree about how far away an event is.
 */
export function startsInLabel(startAt: string): string | null {
  const diffMs = new Date(startAt).getTime() - Date.now();
  // No date set yet (an event created note-first) — there is no countdown to
  // give, and NaN arithmetic below would happily render "Starts in NaN months".
  if (Number.isNaN(diffMs)) return null;
  if (diffMs < 0) return null;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'Starting soon';
  if (hours < 24) return `Starts in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(diffMs / 86400000);
  if (days === 1) return 'Starts tomorrow';
  if (days < 30) return `Starts in ${days} days`;
  const months = Math.round(days / 30);
  return `Starts in ${months} month${months > 1 ? 's' : ''}`;
}

/** Button/label copy for the three RSVP responses, shared by every RSVP form. */
export const RESPONSE_LABELS: Record<RSVPResponse, string> = {
  going: "I'm going",
  maybe: 'Maybe',
  declined: "Can't go",
};

/**
 * Get event status based on current time
 */
export function getEventStatus(startAt: string, endAt?: string): 'upcoming' | 'live' | 'past' {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  // Unscheduled, not over: every comparison against NaN is false, so without
  // this an event awaiting its date fell through to 'past' and rendered dimmed
  // with a "Past event" badge.
  if (Number.isNaN(start)) return 'upcoming';
  const end = endAt ? new Date(endAt).getTime() : start + 3 * 60 * 60 * 1000;

  if (now < start) return 'upcoming';
  if (now <= end) return 'live';
  return 'past';
}

// ─── RSVP status helpers ───────────────────────────────────────────────────────

/** An attendee's status, with the column's default standing in for a blank. */
export function normalizeStatus(status: string | null | undefined): RSVPStatus {
  return status ? (status as RSVPStatus) : 'going';
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

