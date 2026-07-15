// Types for the brain permission/visibility layer, ported from blackbird-brain's
// src/shared/{brainTypes,types}.ts and adapted to Visvine's multi-tenant model:
// members are keyed by stable userId (not email), and the registry lives in the
// CommunityBrainFile sidecar table instead of `.brain/folders.yaml`. Pure — no
// Node/DOM/Prisma imports; usable from server, client, and tests.

/** Cumulative folder access levels: admin ⊃ write ⊃ read. */
export type FolderLevel = 'read' | 'write' | 'admin'

/** public = every community member can read; private = members-only. */
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
 * A registered team folder inside a community's SHARED brain. `id` is the
 * folder's top-level path segment (e.g. "deals" for notes under `deals/…`).
 * Unregistered physical folders behave like the brain root: readable and
 * writable by every member (Visvine's pre-registry behavior).
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

/** The shared brain's folder registry (sidecar file "folders.json"). */
export interface FoldersConfig {
  version: number
  folders: Folder[]
}

export const EMPTY_REGISTRY: FoldersConfig = { version: 1, folders: [] }

/**
 * The resolved caller identity every brain-service function takes explicitly —
 * identity is never implicit. Built by lib/notes/principal.ts from the session,
 * the community membership, and the folder registry.
 */
export interface BrainPrincipal {
  userId: string
  email: string
  name: string
  communityId: string
  /** Admin of this community (incl. super admins) — bypasses folder gates. */
  communityAdmin: boolean
  /** The shared brain's folder registry as it applies to this caller. */
  folders: FoldersConfig
  /** True for internal maintenance passes (review/enrichment) — sees/writes all. */
  system?: boolean
}

/** Apply-or-deny result of a gated write. */
export type WriteResult =
  | { status: 'applied'; path: string }
  | { status: 'denied'; reason: string }

// --- sidecar record shapes ----------------------------------------------------

/** A pending request to join a private folder (sidecar "join-requests.jsonl"). */
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

/** A queued promotion the requester couldn't apply directly (sidecar "move-proposals.jsonl"). */
export interface MoveProposalEntry {
  id: string
  /** Source note path in the proposer's PERSONAL brain. */
  fromPath: string
  /** Destination path in the SHARED brain. */
  toPath: string
  folderId: string
  content: string // full markdown snapshot at proposal time
  proposedBy: string // userId
  proposerName: string
  proposedAt: number
  status: 'pending' | 'approved' | 'denied'
  resolvedBy?: string
  resolvedAt?: number
}

/** One read-audit line (sidecar "audit.jsonl") — private-folder reads only. */
export interface AuditEntry {
  at: number
  userId: string
  name: string
  action: 'read' | 'write' | 'move' | 'delete' | 'folder' | 'promote'
  path: string
  detail?: string
}
