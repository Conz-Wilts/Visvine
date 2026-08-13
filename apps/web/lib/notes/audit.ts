// Append-only context audit — one sidecar file ("audit.jsonl" on the shared
// context) carrying both the read trail and the folder trail. Records private-folder reads and every governance mutation
// (folder registry changes, promotions, gated moves/deletes) for compliance.

import { SHARED_OWNER_KEY, type Context } from './store'
import { appendJsonl, readJsonl } from './sidecar'
import type { AuditEntry } from './shared/contextTypes'

const FILE = 'audit.jsonl'
const MAX_RETURNED = 500

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

export async function logAudit(
  spaceId: string,
  entry: Omit<AuditEntry, 'at'>,
): Promise<void> {
  try {
    await appendJsonl(sharedContext(spaceId), FILE, { at: Date.now(), ...entry })
  } catch {
    /* auditing must never break the read/write path */
  }
}

/** Newest-first audit trail (admin surface), capped. */
export async function listAudit(spaceId: string): Promise<AuditEntry[]> {
  const entries = await readJsonl<AuditEntry>(sharedContext(spaceId), FILE)
  return entries.slice(-MAX_RETURNED).reverse()
}
