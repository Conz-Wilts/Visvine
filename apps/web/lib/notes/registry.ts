// LEGACY: the pre-grant folder registry reader. Access now lives in ContextGrant
// rows + SpaceNoteFolder boundary flags (lib/notes/access.ts over
// lib/notes/shared/authz.ts). This reader survives only so ensureAccessSeeded
// can migrate an existing `folders.json` sidecar the first time a space is
// touched; the sidecar itself is left in place as an inert historical record.

import { SHARED_OWNER_KEY, type Context } from './store'
import { readJson } from './sidecar'
import { EMPTY_REGISTRY, type FoldersConfig } from './shared/contextTypes'

const FILE = 'folders.json'

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/** The legacy registry for a space's shared context (empty config when none). */
export async function resolveRegistry(spaceId: string): Promise<FoldersConfig> {
  const cfg = await readJson<FoldersConfig>(sharedContext(spaceId), FILE, EMPTY_REGISTRY)
  return cfg && Array.isArray(cfg.folders) ? cfg : EMPTY_REGISTRY
}
