// The pure half of the server's per-context vault memo (lib/notes/vaultCache.ts):
// given a cached corpus, what may THIS principal see, and under which cache key?
// Pure — no Prisma — so the no-title-leak property is unit-testable.

import type { ContextPrincipal } from './contextTypes'
import type { NoteMeta, RawNote } from './types'
import { buildNoteIndex } from './context'
import { filterVisible } from './visibility'
import { accessSignature } from './authz'
import { principalIsSuperAdmin } from './permissions'

export interface VaultView {
  raws: RawNote[]
  metas: NoteMeta[]
}

/**
 * The visibility signature: everything filterVisible's outcome depends on for a
 * fixed corpus — the caller's readable grant roots plus the context's restricted
 * cuts (shared/authz.ts#accessSignature). Equal signatures ⇒ identical
 * filterVisible output, so views can be shared across equally-granted viewers.
 */
export function visibilitySignature(p: ContextPrincipal): string {
  return accessSignature(p.access)
}

/** Whether the principal sees the corpus unfiltered (no signature needed). */
export function seesUnfiltered(p: ContextPrincipal, shared: boolean): boolean {
  return !shared || principalIsSuperAdmin(p)
}

/** Build one principal-visible view: filtered raws + index rebuilt over ONLY
 *  the visible raws, so links into hidden folders stay unresolved (no title leak). */
export function buildVaultView(raws: RawNote[], p: ContextPrincipal): VaultView {
  const visible = filterVisible(raws, p)
  return { raws: visible, metas: buildNoteIndex(visible) }
}
