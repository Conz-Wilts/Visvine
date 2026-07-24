// Types for the brain permission/visibility layer. Access is grant-based (see
// ./authz.ts): a principal carries the pre-scoped BrainAccess the pure checks
// run over. The legacy folder-registry shapes (Folder/FoldersConfig, the old
// `folders.json` sidecar) are kept ONLY so lib/notes/access.ts can parse and
// migrate pre-grant registries — no live check reads them. Pure — no
// Node/DOM/Prisma imports; usable from server, client, and tests.

import type { BrainAccess } from './authz'

/**
 * The resolved caller identity every brain-service function takes explicitly —
 * identity is never implicit. Built by lib/notes/brain.ts#principalOf from the
 * session, the community membership, and the caller's grant rows.
 */
export interface BrainPrincipal {
  userId: string
  email: string
  name: string
  communityId: string
  /** Admin of this community (incl. super admins) — bypasses every brain gate. */
  communityAdmin: boolean
  /** The caller's grants + the brain's restricted/locked folder boundaries. */
  access: BrainAccess
  /** True for internal maintenance passes (review/enrichment) — sees/writes all. */
  system?: boolean
}

/** Apply-or-deny result of a gated write. */
export type WriteResult =
  | { status: 'applied'; path: string }
  | { status: 'denied'; reason: string }

// --- legacy folder registry (migration input only) ------------------------------

/** Legacy cumulative folder levels: admin ⊃ write ⊃ read (now view/edit/full). */
export type FolderLevel = 'read' | 'write' | 'admin'

/** Legacy: public = every community member can read; private = members-only. */
export type FolderVisibility = 'public' | 'private'

interface FolderMember {
  userId: string
  /** Display name/email snapshots for the admin UI (identity is userId). */
  name?: string
  email?: string
  level: FolderLevel
  grantedBy: string // userId
  grantedAt: string // YYYY-MM-DD
}

/**
 * A legacy registered top-level folder of a community's SHARED brain (`id` was
 * the top-level path segment; '' the brain-gating root entry). Only read at
 * migration time — see authz.migrateLegacyRegistry.
 */
export interface Folder {
  id: string
  name: string
  visibility: FolderVisibility
  members: FolderMember[]
  createdBy: string // userId
  createdAt: string // YYYY-MM-DD
  /** Frozen for AI maintenance passes (review auto-fixes, enrichment targets). */
  locked?: boolean
}

/** The legacy folder registry (sidecar file "folders.json"). */
export interface FoldersConfig {
  version: number
  folders: Folder[]
}

export const EMPTY_REGISTRY: FoldersConfig = { version: 1, folders: [] }

// --- sidecar record shapes ----------------------------------------------------

/**
 * A pending request to join a restricted folder (sidecar "join-requests.jsonl").
 * `folderId` is a folder path at any depth; '' = the brain root (brain access).
 */
export interface JoinRequest {
  id: string
  folderId: string
  userId: string
  name: string
  email?: string
  message?: string
  requestedAt: number // epoch ms
  status: 'pending' | 'approved' | 'denied'
  resolvedBy?: string // userId
  resolvedAt?: number
}

/** A queued promotion/publication the requester couldn't apply directly (sidecar "move-proposals.jsonl"). */
export interface MoveProposalEntry {
  id: string
  /** Source note path in the proposer's PERSONAL brain. */
  fromPath: string
  /** Destination path in the SHARED brain. */
  toPath: string
  folderId: string
  content: string // full markdown snapshot at proposal time
  /** 'publish' = approving creates a LIVE publication link; absent/'copy' = one-time copy. */
  kind?: 'copy' | 'publish'
  proposedBy: string // userId
  proposerName: string
  proposedAt: number
  status: 'pending' | 'approved' | 'denied'
  resolvedBy?: string
  resolvedAt?: number
}

/** One read-audit line (sidecar "audit.jsonl") — restricted-folder reads only. */
export interface AuditEntry {
  at: number
  userId: string
  name: string
  action: 'read' | 'write' | 'move' | 'delete' | 'folder' | 'promote' | 'grant' | 'publish'
  path: string
  detail?: string
}
