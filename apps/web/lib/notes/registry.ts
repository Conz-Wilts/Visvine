// LEGACY: the pre-grant folder registry reader. Access now lives in BrainGrant
// rows + CommunityNoteFolder boundary flags (lib/notes/access.ts over
// lib/notes/shared/authz.ts). This reader survives only so ensureAccessSeeded
// can migrate an existing `folders.json` sidecar the first time a community is
// touched; the sidecar itself is left in place as an inert historical record.

import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJson } from './sidecar'
import { EMPTY_REGISTRY, type FoldersConfig } from './shared/brainTypes'

const FILE = 'folders.json'

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

/** The legacy registry for a community's shared brain (empty config when none). */
export async function resolveRegistry(communityId: string): Promise<FoldersConfig> {
  const cfg = await readJson<FoldersConfig>(sharedBrain(communityId), FILE, EMPTY_REGISTRY)
  return cfg && Array.isArray(cfg.folders) ? cfg : EMPTY_REGISTRY
}
