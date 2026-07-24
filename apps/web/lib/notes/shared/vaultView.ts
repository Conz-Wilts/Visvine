// The pure half of the server's per-brain vault memo (lib/notes/vaultCache.ts):
// given a cached corpus, what may THIS principal see, and under which cache key?
// Pure — no Prisma — so the no-title-leak property is unit-testable.

import type { BrainPrincipal } from './brainTypes'
import type { NoteMeta, RawNote } from './types'
import { buildNoteIndex } from './graph'
import { filterVisible } from './visibility'
import { accessSignature } from './authz'
import { principalIsSuperAdmin } from './permissions'

export interface VaultView {
  raws: RawNote[]
  metas: NoteMeta[]
}

/**
 * The visibility signature: everything filterVisible's outcome depends on for a
 * fixed corpus — the caller's readable grant roots plus the brain's restricted
 * cuts (shared/authz.ts#accessSignature). Equal signatures ⇒ identical
 * filterVisible output, so views can be shared across equally-granted viewers.
 */
export function visibilitySignature(p: BrainPrincipal): string {
  return accessSignature(p.access)
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
