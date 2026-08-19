/**
 * Notifications — the shapes and pure rules (docs/notifications.md).
 *
 * React-free and Prisma-free so the bell (client), the routes and the tests
 * can all import it. The DB side is `./service.ts`.
 */

/** Everything the machinery has to tell a person. Add a kind, add a writer. */
export const NOTIFICATION_KINDS = [
  'connection_broken',
  'agent_deactivated',
  'agent_run_failed',
  'agent_notify',
  'agent_question',
  'tool_review',
  'access_request',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value)
}

/** What a writer hands `notify()`. */
export interface NotifyInput {
  spaceId?: string | null
  kind: NotificationKind
  title: string
  /** Plain text, capped at BODY_MAX_CHARS. */
  body?: string | null
  /** In-app path (`/tools`, `/admin?section=…`) — the bell navigates here on click. */
  href?: string | null
  /**
   * Collapses repeats: while an UNREAD row with the same key exists for the
   * user, another `notify` with that key creates nothing. Once read, it can
   * fire again. Use it for "still broken" / "failed again" style events.
   */
  dedupeKey?: string | null
}

/** One inbox line as the API and the SSE stream serialise it. */
export interface NotificationDTO {
  id: string
  spaceId: string | null
  kind: NotificationKind | string
  title: string
  body: string | null
  href: string | null
  createdAt: string
  readAt: string | null
}

const TITLE_MAX_CHARS = 200
export const BODY_MAX_CHARS = 2048
export const LIST_MAX_TAKE = 100

export type NormalizedNotifyInput = {
  spaceId: string | null
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  dedupeKey: string | null
}

/**
 * Trim and cap what a writer passed. Never throws: an over-long body is cut,
 * an empty title becomes the kind name — the point of a notification is that
 * it arrives, not that the caller got every field perfect.
 */
export function normalizeNotifyInput(n: NotifyInput): NormalizedNotifyInput {
  const title = (n.title ?? '').trim().slice(0, TITLE_MAX_CHARS) || n.kind
  const body = n.body?.trim() ? n.body.trim().slice(0, BODY_MAX_CHARS) : null
  const href = n.href?.trim() ? n.href.trim() : null
  const dedupeKey = n.dedupeKey?.trim() ? n.dedupeKey.trim().slice(0, 200) : null
  return {
    spaceId: n.spaceId ?? null,
    kind: n.kind,
    title,
    body,
    href,
    dedupeKey,
  }
}

/** Dedupe + drop blanks; order preserved. */
export function uniqueUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))]
}


/** Clamp a `take` query param into [1, LIST_MAX_TAKE]; default 30. */
export function clampTake(raw: string | number | null | undefined, fallback = 30): number {
  const n = typeof raw === 'number' ? raw : raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), LIST_MAX_TAKE)
}

/** "just now", "5m", "3h", "2d", else a short date — for the bell's list. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
