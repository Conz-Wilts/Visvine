/**
 * Activity rows — everything about a person, in one shape (docs/mobile.md).
 *
 * Pure: each `rowFor*` maps a narrow input from one source to the row the
 * phone draws. A row names where it happened (`space`), when (`at`), what to
 * open (`target`, and `href` for the web) and — for a request an admin can
 * answer — the two doors that already exist, so nothing here writes.
 */
import { agentPageHref } from '@/lib/agents/config'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'

type ActivityKind = 'run' | 'mention' | 'reply' | 'join_request' | 'access_request' | 'event'

interface ActivityAction {
  label: 'Approve' | 'Decline'
  method: 'PUT' | 'DELETE'
  href: string
  body?: Record<string, unknown>
}

type ActivityTarget =
  | { type: 'agent'; spaceId: string; agentName: string; runId: string | null }
  | { type: 'conversation'; conversationId: string; messageId: string | null }
  | { type: 'members'; spaceId: string; userId: string }
  | { type: 'accessRequests'; spaceId: string; requestId: string }
  | { type: 'event'; spaceId: string; eventId: string }

export interface ActivityRow {
  /** `<kind>:<source row id>` — stable, so a page never repeats one. */
  id: string
  kind: ActivityKind
  /** ISO. */
  at: string
  title: string
  subtitle: string | null
  space: { id: string; name: string } | null
  actor: { id: string; name: string; image: string | null } | null
  /** The web address, space named by id. */
  href: string
  target: ActivityTarget
  actions?: ActivityAction[]
}

const SUBTITLE_CHARS = 140

export function oneLine(text: string | null | undefined, cap = SUBTITLE_CHARS): string | null {
  if (!text) return null
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return null
  return line.length > cap ? `${line.slice(0, cap - 1)}…` : line
}

function iso(at: Date | string): string {
  return typeof at === 'string' ? at : at.toISOString()
}

export function rowForRun(run: {
  id: string
  spaceId: string
  spaceName: string
  agentName: string
  agentTitle: string
  status: string
  endedAt: Date | string
  summary: string | null
  errorMessage: string | null
}): ActivityRow {
  const failed = run.status !== 'succeeded'
  return {
    id: `run:${run.id}`,
    kind: 'run',
    at: iso(run.endedAt),
    title: failed ? `${run.agentTitle} could not finish` : `${run.agentTitle} finished`,
    subtitle: oneLine(failed ? run.errorMessage : run.summary),
    space: { id: run.spaceId, name: run.spaceName },
    actor: null,
    href: agentPageHref(run.agentName, run.id, run.spaceId),
    target: { type: 'agent', spaceId: run.spaceId, agentName: run.agentName, runId: run.id },
  }
}

export function rowForMention(m: {
  mentionId: string
  messageId: string
  conversationId: string
  conversationName: string | null
  spaceId: string | null
  spaceName: string | null
  createdAt: Date | string
  text: string
  sender: { id: string; name: string; image: string | null }
}): ActivityRow {
  const where = m.conversationName ? ` in ${m.conversationName}` : ''
  return {
    id: `mention:${m.mentionId}`,
    kind: 'mention',
    at: iso(m.createdAt),
    title: `${m.sender.name} mentioned you${where}`,
    subtitle: oneLine(m.text),
    space: m.spaceId && m.spaceName ? { id: m.spaceId, name: m.spaceName } : null,
    actor: m.sender,
    href: `/messages/${encodeURIComponent(m.conversationId)}`,
    target: { type: 'conversation', conversationId: m.conversationId, messageId: m.messageId },
  }
}

export function rowForReply(r: {
  messageId: string
  conversationId: string
  conversationName: string | null
  spaceId: string | null
  spaceName: string | null
  createdAt: Date | string
  text: string
  sender: { id: string; name: string; image: string | null }
}): ActivityRow {
  const where = r.conversationName ? ` in ${r.conversationName}` : ''
  return {
    id: `reply:${r.messageId}`,
    kind: 'reply',
    at: iso(r.createdAt),
    title: `${r.sender.name} replied to you${where}`,
    subtitle: oneLine(r.text),
    space: r.spaceId && r.spaceName ? { id: r.spaceId, name: r.spaceName } : null,
    actor: r.sender,
    href: `/messages/${encodeURIComponent(r.conversationId)}`,
    target: { type: 'conversation', conversationId: r.conversationId, messageId: r.messageId },
  }
}

export function rowForJoinRequest(j: {
  membershipId: string
  spaceId: string
  spaceName: string
  joinedAt: Date | string
  user: { id: string; name: string; image: string | null }
}): ActivityRow {
  const members = `/api/spaces/${encodeURIComponent(j.spaceId)}/members/${encodeURIComponent(j.user.id)}`
  return {
    id: `join_request:${j.membershipId}`,
    kind: 'join_request',
    at: iso(j.joinedAt),
    title: `${j.user.name} wants to join ${j.spaceName}`,
    subtitle: null,
    space: { id: j.spaceId, name: j.spaceName },
    actor: j.user,
    href: inSpace(j.spaceId, '/admin?section=members'),
    target: { type: 'members', spaceId: j.spaceId, userId: j.user.id },
    actions: [
      { label: 'Approve', method: 'PUT', href: members, body: { status: 'active' } },
      { label: 'Decline', method: 'DELETE', href: members },
    ],
  }
}

export function rowForAccessRequest(a: {
  requestId: string
  spaceId: string
  spaceName: string
  resourcePath: string
  level: number
  message: string | null
  createdAt: Date | string
  user: { id: string; name: string; image: string | null }
}): ActivityRow {
  const what = a.resourcePath ? a.resourcePath : 'the whole context'
  const level = a.level >= 30 ? 'edit' : 'view'
  return {
    id: `access_request:${a.requestId}`,
    kind: 'access_request',
    at: iso(a.createdAt),
    title: `${a.user.name} asks to ${level} ${what}`,
    subtitle: oneLine(a.message),
    space: { id: a.spaceId, name: a.spaceName },
    actor: a.user,
    href: inSpace(a.spaceId, '/admin?section=members'),
    target: { type: 'accessRequests', spaceId: a.spaceId, requestId: a.requestId },
    actions: [
      { label: 'Approve', method: 'PUT', href: '/api/notes/access-requests', body: { spaceId: a.spaceId, requestId: a.requestId, approve: true } },
      { label: 'Decline', method: 'PUT', href: '/api/notes/access-requests', body: { spaceId: a.spaceId, requestId: a.requestId, approve: false } },
    ],
  }
}

export function rowForEvent(e: {
  eventId: string
  spaceId: string
  spaceName: string
  title: string
  startAt: string
  location: string | null
  status: string
}): ActivityRow {
  return {
    id: `event:${e.eventId}`,
    kind: 'event',
    at: e.startAt,
    title: e.title,
    subtitle: oneLine(e.location) ?? (e.status === 'waitlisted' ? 'Waitlisted' : null),
    space: { id: e.spaceId, name: e.spaceName },
    actor: null,
    href: inSpace(e.spaceId, `/events/${encodeURIComponent(e.eventId)}`),
    target: { type: 'event', spaceId: e.spaceId, eventId: e.eventId },
  }
}
