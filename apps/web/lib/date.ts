// lib/date.ts — canonical date/time formatters for the app.
//
// Consolidates the relative-time and date-label helpers that were previously
// duplicated across feed, messages, and notes components. Each
// `timeAgo` style preserves the exact user-visible output of the surface it
// replaced — do not merge styles without checking every call site.
//
// Event-specific formatting (multi-day ranges, etc.) lives in lib/eventUtils.ts.

type DateInput = string | number | Date;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export type TimeAgoStyle = 'long' | 'short' | 'compact';

/**
 * Relative "time ago" formatting. Future timestamps (clock skew) read as the
 * most-recent bucket. Styles (each preserves a pre-consolidation surface):
 *
 * - `long`    — "just now", "5 minutes ago" … "2 years ago" (notes editor).
 * - `short`   — "just now", "5m ago", "3h ago", "12d ago"; days uncapped.
 * - `compact` — "just now", "5m", "3h", "2d", "3w", then "5 Mar" (blog/feed).
 *
 * Pass `now` (epoch ms) for deterministic output in tests.
 */
export function timeAgo(
  input: DateInput,
  opts: { style?: TimeAgoStyle; now?: number } = {},
): string {
  const { style = 'long', now = Date.now() } = opts;
  const date = toDate(input);
  const diff = now - date.getTime();

  switch (style) {
    case 'long': {
      if (diff < MINUTE) return 'just now';
      if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute');
      if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour');
      if (diff < WEEK) return plural(Math.floor(diff / DAY), 'day');
      if (diff < MONTH) return plural(Math.floor(diff / WEEK), 'week');
      if (diff < YEAR) return plural(Math.floor(diff / MONTH), 'month');
      return plural(Math.floor(diff / YEAR), 'year');
    }
    case 'short': {
      const mins = Math.floor(diff / MINUTE);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    }
    case 'compact': {
      const secs = Math.floor(diff / SECOND);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      if (secs < 60) return 'just now';
      if (mins < 60) return `${mins}m`;
      if (hours < 24) return `${hours}h`;
      if (days < 7) return `${days}d`;
      if (weeks < 4) return `${weeks}w`;
      return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
}

/** Absolute date, e.g. "5 Mar 2024" (viewer's locale ordering). */
export function formatDate(input: DateInput): string {
  return toDate(input).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Time only, e.g. "3:42 PM". */
export function formatTime(input: DateInput): string {
  return toDate(input).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Message group header label: "Today", "Yesterday", "March 5", or
 * "March 5, 2024" when the date falls in a different year.
 */
export function formatDateLabel(input: DateInput): string {
  const d = toDate(input);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  );
}

/**
 * Compact chat timestamp: time of day for today ("3:42 PM"), "Yesterday",
 * or a short date ("Mar 5"). Empty string for missing values.
 */
export function formatChatTimestamp(value: DateInput | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = toDate(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
