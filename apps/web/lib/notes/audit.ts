// The context audit trail: private-folder reads plus every governance mutation
// (folder registry changes, grants, promotions, gated moves/deletes, connector
// calls, agent activations, secret changes, Tool lifecycle), kept for
// compliance.
//
// This is a LEDGER in the sense of docs/data-architecture.md — one row per
// event, first-hand, not derivable from anything — so it lives in its own table
// (`context_audit_entries`), one INSERT per call, so fire-and-forget appends
// inside loops (searchContext logs one entry per restricted hit) never race
// each other. logAudit never throws; listAudit returns newest-first and capped.

import prisma from '@/lib/prisma'
import type { AuditEntry } from './shared/contextTypes'

const MAX_RETURNED = 500

export async function logAudit(
  spaceId: string,
  entry: Omit<AuditEntry, 'at'>,
): Promise<void> {
  try {
    await prisma.contextAuditEntry.create({
      data: {
        spaceId,
        userId: entry.userId,
        name: entry.name,
        action: entry.action,
        path: entry.path,
        detail: entry.detail ?? null,
      },
    })
  } catch {
    /* auditing must never break the read/write path */
  }
}

/** Newest-first audit trail (admin surface), capped. */
export async function listAudit(spaceId: string): Promise<AuditEntry[]> {
  const rows = await prisma.contextAuditEntry.findMany({
    where: { spaceId },
    orderBy: { at: 'desc' },
    take: MAX_RETURNED,
    select: { at: true, userId: true, name: true, action: true, path: true, detail: true },
  })
  return rows.map((r) => ({
    at: r.at.getTime(),
    userId: r.userId,
    name: r.name,
    // The column is a plain string (an audit trail must be able to record an
    // action a later build no longer knows about); the DTO's union is what
    // today's writers produce.
    action: r.action as AuditEntry['action'],
    path: r.path,
    ...(r.detail === null ? {} : { detail: r.detail }),
  }))
}
