// Principal-level access predicates: the folder gate expressed over one
// ContextPrincipal. All real semantics live in ./authz.ts (grants + restricted
// cuts + max-wins); this layer folds in the space-admin and system escape
// hatches so the service layer and the UI ask one question the same way.
// Pure predicates; paths are context-relative note or folder paths ('' = root).

import type { ContextPrincipal } from './contextTypes'
import {
  canManage,
  canRead,
  canWrite,
  effectiveLevel,
  folderVisible,
  levelName,
  type AccessLevelName,
} from './authz'

/** Space admins and the system principal bypass every context gate. */
export function principalIsSuperAdmin(p: ContextPrincipal): boolean {
  return p.system === true || p.spaceAdmin === true
}

/** Whether the principal may READ a shared-context path (note or source). */
export function principalCanRead(p: ContextPrincipal, path: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  return canRead(p.access, path)
}

/** Whether the principal may WRITE at a shared-context path (edit level or up). */
export function principalCanWrite(p: ContextPrincipal, path: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  return canWrite(p.access, path)
}

/**
 * Whether the principal MANAGES a path (full level: share, restrict, delete
 * within the subtree) — the successor of the old per-folder admin.
 */
export function principalCanManage(p: ContextPrincipal, path: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  return canManage(p.access, path)
}

/** Whether a folder should appear in this principal's tree at all. */
export function principalSeesFolder(p: ContextPrincipal, folderPath: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  return folderVisible(p.access, folderPath)
}

/** The principal's effective level name at a path (admins read as 'full'). */
export function principalLevelName(p: ContextPrincipal, path: string): AccessLevelName | null {
  if (principalIsSuperAdmin(p)) return 'full'
  return levelName(effectiveLevel(p.access, path))
}
