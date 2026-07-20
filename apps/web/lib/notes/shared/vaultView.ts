// The pure half of the server's per-brain vault memo (lib/notes/vaultCache.ts):
// given a cached corpus, what may THIS principal see, and under which cache key?
// Pure — no Prisma — so the no-title-leak property is unit-testable.

import type { BrainPrincipal } from './brainTypes'
import type { NoteMeta, RawNote } from './types'
import { buildNoteIndex } from './graph'
import { filterVisible } from './visibility'
import { canReadFolder, folderById, principalIsSuperAdmin } from './permissions'
import { ROOT_FOLDER } from './placement'

export interface VaultView {
  raws: RawNote[]
  metas: NoteMeta[]
}

/**
 * The visibility signature: everything filterVisible's outcome depends on for a
 * fixed corpus. Per registered folder, whether this principal can read it (a
 * registration change flips the folder's presence in the string even when the
 * readable set is otherwise identical), plus whether unregistered folders are
 * readable (their governing entry is the root gate; no root entry = open).
 * Equal signatures ⇒ identical filterVisible output, so views can be shared.
 */
export function visibilitySignature(p: BrainPrincipal): string {
  const root = folderById(p.folders, ROOT_FOLDER)
  const unregistered = root ? canReadFolder(root, p.userId) : true
  const perFolder = p.folders.folders
    .map((f) => `${f.id}:${canReadFolder(f, p.userId) ? 1 : 0}`)
    .sort()
  return `u:${unregistered ? 1 : 0}|${perFolder.join(',')}`
}

/** Whether the principal sees the corpus unfiltered (no signature needed). */
export function seesUnfiltered(p: BrainPrincipal, shared: boolean): boolean {
  return !shared || principalIsSuperAdmin(p)
}

/** Build one principal-visible view: filtered raws + index rebuilt over ONLY
 *  the visible raws, so links into hidden folders stay unresolved (no title leak). */
export function buildVaultView(raws: RawNote[], p: BrainPrincipal): VaultView {
  const visible = filterVisible(raws, p)
  return { raws: visible, metas: buildNoteIndex(visible) }
}
