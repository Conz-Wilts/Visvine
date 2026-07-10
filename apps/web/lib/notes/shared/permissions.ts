// The folder access layer, ported from blackbird-brain's src/shared/permissions.ts
// and adapted to Visvine: members are keyed by userId, and the registry's ROOT
// entry (id '') gates the WHOLE community brain — a community brain is private by
// default: joining a community does not grant brain access until a root/folder
// admin does (existing members are grandfathered into the root entry when the
// gate is first materialized — see registry.ensureBrainGate). A registered
// folder's own ACL refines the root's; an unregistered folder falls back to the
// root entry, and only with NO root entry at all does the legacy member-open
// behavior apply. Pure predicates; the service layer and the UI call the same
// functions.

import type { BrainPrincipal, Folder, FolderLevel, FoldersConfig } from './brainTypes'
import { ROOT_FOLDER } from './placement'

const RANK: Record<FolderLevel, number> = { read: 1, write: 2, admin: 3 }

function atLeast(level: FolderLevel | undefined, min: FolderLevel): boolean {
  return level !== undefined && RANK[level] >= RANK[min]
}

export function folderById(cfg: FoldersConfig, id: string): Folder | undefined {
  return cfg.folders.find((f) => f.id === id)
}

/** The caller's explicit level in a folder. */
export function memberLevel(folder: Folder, userId: string): FolderLevel | undefined {
  return folder.members.find((m) => m.userId === userId)?.level
}

/** Read: a public folder is readable by every member; a private one only by its members. */
export function canReadFolder(folder: Folder, userId: string): boolean {
  if (folder.visibility === 'public') return true
  return memberLevel(folder, userId) !== undefined
}

/** Write requires a write-or-admin membership, regardless of visibility. */
export function canWriteFolder(folder: Folder, userId: string): boolean {
  return atLeast(memberLevel(folder, userId), 'write')
}

/** Admin manages members, join requests, visibility, and locks. */
export function isFolderAdmin(folder: Folder, userId: string): boolean {
  return atLeast(memberLevel(folder, userId), 'admin')
}

// --- principal-level checks (compose folder predicates with the community-admin
// and system escape hatches; unregistered folders stay open). -------------------

/** Community admins and the system principal bypass per-folder membership. */
export function principalIsSuperAdmin(p: BrainPrincipal): boolean {
  return p.system === true || p.communityAdmin === true
}

/** The entry governing a folder: its own registration, else the root gate. */
function governingFolder(cfg: FoldersConfig, folderId: string): Folder | undefined {
  return folderById(cfg, folderId) ?? folderById(cfg, ROOT_FOLDER)
}

/**
 * Whether the principal may READ a shared-brain note in the given folder.
 * A registered folder enforces its own ACL; an unregistered one falls back to
 * the root gate. No root entry at all → legacy member-open.
 */
export function principalCanRead(p: BrainPrincipal, folderId: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  const folder = governingFolder(p.folders, folderId)
  return folder ? canReadFolder(folder, p.userId) : true
}

/**
 * Whether the principal may WRITE a shared-brain note in the given folder.
 * Same governing-entry fallback as reads; write requires write-or-admin level.
 */
export function principalCanWrite(p: BrainPrincipal, folderId: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  const folder = governingFolder(p.folders, folderId)
  return folder ? canWriteFolder(folder, p.userId) : true
}

/** Whether the principal administers a folder (root gate governs unregistered ones). */
export function principalIsFolderAdmin(p: BrainPrincipal, folderId: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  const folder = governingFolder(p.folders, folderId)
  return folder ? isFolderAdmin(folder, p.userId) : false
}

/** Folders the principal can see: public ones plus private ones they belong to. */
export function readableFolders(cfg: FoldersConfig, p: BrainPrincipal): Folder[] {
  if (principalIsSuperAdmin(p)) return cfg.folders
  return cfg.folders.filter((f) => canReadFolder(f, p.userId))
}
