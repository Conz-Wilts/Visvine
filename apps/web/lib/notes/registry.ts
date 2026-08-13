// LEGACY: the pre-grant folder registry reader. Access now lives in BrainGrant
// rows + SpaceNoteFolder boundary flags (lib/notes/access.ts over
// lib/notes/shared/authz.ts). This reader survives only so ensureAccessSeeded
// can migrate an existing `folders.json` sidecar the first time a space is
// touched; the sidecar itself is left in place as an inert historical record.

import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJson } from './sidecar'
import { EMPTY_REGISTRY, type FoldersConfig } from './shared/brainTypes'

const FILE = 'folders.json'

function sharedBrain(spaceId: string): Brain {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/** The legacy registry for a space's shared brain (empty config when none). */
export async function resolveRegistry(spaceId: string): Promise<FoldersConfig> {
  const cfg = await readJson<FoldersConfig>(sharedBrain(spaceId), FILE, EMPTY_REGISTRY)
  return cfg && Array.isArray(cfg.folders) ? cfg : EMPTY_REGISTRY
}
