// Pure rules for context access requests — who may file one, who may see it, and
// how it reads in a queue. Kept free of Prisma/DOM so both the API layer
// (lib/notes/accessRequests.ts) and the console UI run the SAME logic, and so
// the rules are unit-testable (tests/access-requests.test.ts).

import { levelDisplayLabel, levelName } from './authz'
import { principalCanManage, principalCanRead } from './permissions'
import type { AccessRequest, ContextPrincipal } from './contextTypes'

/**
 * Whether a principal may file a request for `path`. Only "you already have
 * this" is refused — the path itself is never validated, because a request for a
 * path that doesn't exist is exactly what a hidden note looks like from outside,
 * and refusing it would confirm the note's absence.
 */
export function canRequest(p: ContextPrincipal, path: string): boolean {
  return !principalCanRead(p, path)
}

/**
 * Whether a principal may see a request in a queue: their own, or any request
 * for a path they manage (space admins manage everything).
 */
export function requestVisibleTo(p: ContextPrincipal, request: AccessRequest): boolean {
  return request.userId === p.userId || principalCanManage(p, request.resourcePath)
}

/** Whether a principal may approve/deny a request. Filing your own doesn't count. */
export function canResolveRequest(p: ContextPrincipal, request: AccessRequest): boolean {
  return principalCanManage(p, request.resourcePath)
}

/**
 * Human label for the requested resource: the root gate reads as the context's
 * own name, a folder keeps its trailing slash, a note drops the `.md`.
 */
export function requestTargetLabel(resourcePath: string, contextName: string): string {
  if (resourcePath === '') return contextName
  return resourcePath.replace(/\.md$/i, '')
}

/** One-line queue phrasing for a PENDING row: "wants Viewer on Research/Q3 memo". */
export function describeRequest(request: AccessRequest, contextName: string): string {
  const level = levelDisplayLabel(levelName(request.level))
  return `wants ${level} on ${requestTargetLabel(request.resourcePath, contextName)}`
}

/**
 * What actually happened, for a resolved row. An approval reports the level the
 * reviewer GRANTED (which may be more than was asked for); a denial names only
 * the resource, since no level was handed out.
 */
export function describeOutcome(request: AccessRequest, contextName: string): string {
  const target = requestTargetLabel(request.resourcePath, contextName)
  if (request.status !== 'approved') return target
  return `${levelDisplayLabel(levelName(request.grantedLevel ?? request.level))} on ${target}`
}

/** Pending first, then newest first — the order a reviewer wants to work in. */
export function sortRequests(requests: AccessRequest[]): AccessRequest[] {
  return [...requests].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'pending') return -1
      if (b.status === 'pending') return 1
    }
    return b.requestedAt - a.requestedAt
  })
}
