// Principal-level access predicates: the folder gate expressed over one
// ContextPrincipal. All real semantics live in ./authz.ts (grants + restricted
// cuts + max-wins); this layer folds in the space-admin and system escape
// hatches so the service layer and the UI ask one question the same way.
// Pure predicates; paths are context-relative note or folder paths ('' = root).

import type { ContextPrincipal } from './contextTypes'
import {
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
 * Whether the principal may administer the context's ACCESS: share, restrict,
 * lock, resolve access requests and promotion proposals.
 *
 * Deliberately path-free. Grants only ever carry view/edit on a resource;
 * nothing a grant can say makes you an administrator of it. So this is exactly
 * "is a space admin (or the system principal)" — the per-folder manager role is
 * gone. Content operations that used to ride on it (deleting a note, renaming
 * or deleting a folder) are gated on edit at the path instead, which is what
 * Editor advertises.
 */
export function principalCanManage(p: ContextPrincipal): boolean {
  return principalIsSuperAdmin(p)
}

/** Whether a folder should appear in this principal's tree at all. */
export function principalSeesFolder(p: ContextPrincipal, folderPath: string): boolean {
  if (principalIsSuperAdmin(p)) return true
  return folderVisible(p.access, folderPath)
}

/** The principal's effective level name at a path. Admins read as 'edit', the
 *  top grantable level — their administrative powers aren't a level, so the UI
 *  says "space admin" separately rather than inventing a rung for it. */
export function principalLevelName(p: ContextPrincipal, path: string): AccessLevelName | null {
  if (principalIsSuperAdmin(p)) return 'edit'
  return levelName(effectiveLevel(p.access, path))
}
