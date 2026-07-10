// The shared brain's folder registry — the DB port of blackbird-brain's
// src/server/folders.ts (`.brain/folders.yaml`). Loaded per call so membership
// changes apply immediately. The registry's ROOT entry (id '') is the brain
// gate: a community brain is private by default — joining the community does
// NOT grant brain access. ensureBrainGate materializes the root entry on first
// touch, grandfathering the community's CURRENT members (write; admins get
// admin) so an existing community never locks itself out; members who join
// later see nothing until a root/folder admin grants access (or approves a
// join request on folder id '').

import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJson, writeJson } from './sidecar'
import { toDateString } from './shared/noteLog'
import {
  EMPTY_REGISTRY,
  type Folder,
  type FolderLevel,
  type FolderVisibility,
  type FoldersConfig,
} from './shared/brainTypes'

const FILE = 'folders.json'

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

/** The registry for a community's shared brain (empty config when none exists). */
export async function resolveRegistry(communityId: string): Promise<FoldersConfig> {
  const cfg = await readJson<FoldersConfig>(sharedBrain(communityId), FILE, EMPTY_REGISTRY)
  return cfg && Array.isArray(cfg.folders) ? cfg : EMPTY_REGISTRY
}

export async function saveRegistry(communityId: string, cfg: FoldersConfig): Promise<void> {
  await writeJson(sharedBrain(communityId), FILE, cfg)
}

/**
 * Materialize the brain gate (the root registry entry, id '') for a normal
 * community, grandfathering every CURRENT active member: members get write,
 * community admins get admin. Idempotent — an existing root entry governs.
 * Personal-space communities are never gated (skip them at the caller).
 */
export async function ensureBrainGate(communityId: string): Promise<FoldersConfig> {
  const cfg = await resolveRegistry(communityId)
  if (cfg.folders.some((f) => f.id === '')) return cfg
  const memberships = await prisma.userCommunity.findMany({
    where: { communityId, status: 'active' },
    select: { userId: true, role: true, user: { select: { name: true, email: true } } },
  })
  const today = toDateString(Date.now())
  const root: Folder = {
    id: '',
    name: 'Community brain',
    visibility: 'private',
    members: memberships.map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? undefined,
      email: m.user?.email ?? undefined,
      level: m.role === 'admin' ? ('admin' as const) : ('write' as const),
      grantedBy: 'system',
      grantedAt: today,
    })),
    createdBy: 'system',
    createdAt: today,
  }
  const next: FoldersConfig = { version: cfg.version, folders: [root, ...cfg.folders] }
  await saveRegistry(communityId, next)
  return next
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'folder'
}

export interface RegisterMember {
  userId: string
  name?: string
  email?: string
}

/**
 * Register a top-level folder id (an existing physical folder, or a new one the
 * caller will create) with `creator` as its first admin. Rejects an id that is
 * already registered.
 */
export async function registerFolder(
  communityId: string,
  input: { id?: string; name: string; visibility: FolderVisibility },
  creator: RegisterMember,
): Promise<Folder> {
  const cfg = await resolveRegistry(communityId)
  const id = (input.id ?? slugify(input.name)).trim()
  if (!id || id.includes('/')) throw new Error(`Invalid folder id: ${id}`)
  if (cfg.folders.some((f) => f.id === id)) throw new Error(`Folder already registered: ${id}`)
  const today = toDateString(Date.now())
  const folder: Folder = {
    id,
    name: input.name.trim() || id,
    visibility: input.visibility,
    members: [
      {
        userId: creator.userId,
        name: creator.name,
        email: creator.email,
        level: 'admin',
        grantedBy: creator.userId,
        grantedAt: today,
      },
    ],
    createdBy: creator.userId,
    createdAt: today,
  }
  cfg.folders.push(folder)
  await saveRegistry(communityId, cfg)
  return folder
}

/** Remove a folder's registry entry (its notes revert to legacy open behavior). */
export async function unregisterFolder(communityId: string, folderId: string): Promise<void> {
  const cfg = await resolveRegistry(communityId)
  cfg.folders = cfg.folders.filter((f) => f.id !== folderId)
  await saveRegistry(communityId, cfg)
}

async function mutateFolder(
  communityId: string,
  folderId: string,
  fn: (folder: Folder) => void,
): Promise<FoldersConfig> {
  const cfg = await resolveRegistry(communityId)
  const folder = cfg.folders.find((f) => f.id === folderId)
  if (!folder) throw new Error(`Unknown folder: ${folderId}`)
  fn(folder)
  await saveRegistry(communityId, cfg)
  return cfg
}

export async function setMemberLevel(
  communityId: string,
  folderId: string,
  member: RegisterMember,
  level: FolderLevel,
  grantedBy: string,
): Promise<void> {
  await mutateFolder(communityId, folderId, (folder) => {
    const existing = folder.members.find((m) => m.userId === member.userId)
    if (existing) {
      existing.level = level
      if (member.name) existing.name = member.name
      if (member.email) existing.email = member.email
    } else {
      folder.members.push({
        userId: member.userId,
        name: member.name,
        email: member.email,
        level,
        grantedBy,
        grantedAt: toDateString(Date.now()),
      })
    }
  })
}

export async function removeMember(
  communityId: string,
  folderId: string,
  userId: string,
): Promise<void> {
  await mutateFolder(communityId, folderId, (folder) => {
    folder.members = folder.members.filter((m) => m.userId !== userId)
  })
}

export async function setVisibility(
  communityId: string,
  folderId: string,
  visibility: FolderVisibility,
): Promise<void> {
  await mutateFolder(communityId, folderId, (folder) => {
    folder.visibility = visibility
  })
}

/** Freeze/unfreeze a folder for AI maintenance passes (review fixes, enrichment). */
export async function setFolderLock(
  communityId: string,
  folderId: string,
  locked: boolean,
): Promise<void> {
  await mutateFolder(communityId, folderId, (folder) => {
    if (locked) folder.locked = true
    else delete folder.locked
  })
}
