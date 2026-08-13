// Append-only brain audit — the port of blackbird-brain's src/server/brainAudit.ts
// plus its bundleLog folder trail, folded into one sidecar file ("audit.jsonl" on
// the shared brain). Records private-folder reads and every governance mutation
// (folder registry changes, promotions, gated moves/deletes) for compliance.

import { SHARED_OWNER_KEY, type Brain } from './store'
import { appendJsonl, readJsonl } from './sidecar'
import type { AuditEntry } from './shared/brainTypes'

const FILE = 'audit.jsonl'
const MAX_RETURNED = 500

function sharedBrain(spaceId: string): Brain {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

export async function logAudit(
  spaceId: string,
  entry: Omit<AuditEntry, 'at'>,
): Promise<void> {
  try {
    await appendJsonl(sharedBrain(spaceId), FILE, { at: Date.now(), ...entry })
  } catch {
    /* auditing must never break the read/write path */
  }
}

/** Newest-first audit trail (admin surface), capped. */
export async function listAudit(spaceId: string): Promise<AuditEntry[]> {
  const entries = await readJsonl<AuditEntry>(sharedBrain(spaceId), FILE)
  return entries.slice(-MAX_RETURNED).reverse()
}
