// The shared brain's folder registry (governance surface).
//   GET  ?communityId=  → { folders, me }   — private folders the caller can't
//        read are filtered out (community admins see all); each folder carries
//        the caller's level and derived canWrite/canAdmin flags.
//   POST { communityId, action, ... }:
//        'register'     { name, id?, visibility }              — any member (becomes admin)
//        'unregister'   { folderId }                            — folder admin
//        'setVisibility'{ folderId, visibility }                — folder admin
//        'setLock'      { folderId, locked }                    — folder admin
//        'setMember'    { folderId, member: {userId,...}, level } — folder admin
//        'removeMember' { folderId, userId }                    — folder admin
// Every mutation is written to the audit trail. Scope is ignored — the registry
// governs the SHARED brain only.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import {
  registerFolder,
  unregisterFolder,
  setVisibility,
  setFolderLock,
  setMemberLevel,
  removeMember,
} from '@/lib/notes/registry'
import { logAudit } from '@/lib/notes/audit'
import {
  memberLevel,
  principalCanWrite,
  principalIsFolderAdmin,
  readableFolders,
} from '@/lib/notes/shared/permissions'
import type { BrainPrincipal, FolderLevel, FolderVisibility } from '@/lib/notes/shared/brainTypes'

const LEVELS: FolderLevel[] = ['read', 'write', 'admin']
const VISIBILITIES: FolderVisibility[] = ['public', 'private']

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const folders = readableFolders(p.folders, p).map((f) => ({
    ...f,
    myLevel: memberLevel(f, p.userId),
    canWrite: principalCanWrite(p, f.id),
    canAdmin: principalIsFolderAdmin(p, f.id),
  }))
  // The brain gate (root registry entry, id ''): whether the CALLER can read the
  // brain at all. A gated-out member sees no folders above, so this is the one
  // signal the UI has to offer "request brain access". Personal spaces are
  // never gated (root entry absent → open).
  const root = p.folders.folders.find((f) => f.id === '')
  const gate = {
    gated: root !== undefined,
    canRead: p.communityAdmin || root === undefined || readableFolders(p.folders, p).some((f) => f.id === ''),
    // Whether the caller may write at the brain root (create notes outside any
    // registered folder) — the UI uses this to hide "new context" affordances.
    canWrite: principalCanWrite(p, ''),
    myLevel: root ? memberLevel(root, p.userId) : undefined,
  }
  return NextResponse.json({
    folders,
    gate,
    me: { userId: p.userId, communityAdmin: p.communityAdmin },
  })
}

function audit(p: BrainPrincipal, folderId: string, detail: string): void {
  void logAudit(p.communityId, {
    userId: p.userId,
    name: p.name,
    action: 'folder',
    path: folderId,
    detail,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const action = typeof body.action === 'string' ? body.action : null

  try {
    if (action === 'register') {
      const name = typeof body.name === 'string' ? body.name : null
      const visibility = VISIBILITIES.includes(body.visibility) ? (body.visibility as FolderVisibility) : null
      if (!name || !visibility) return fail('name and visibility are required')
      const id = typeof body.id === 'string' ? body.id : undefined
      const folder = await registerFolder(
        p.communityId,
        { id, name, visibility },
        { userId: p.userId, name: p.name, email: p.email || undefined },
      )
      audit(p, folder.id, `registered (${visibility})`)
      return NextResponse.json({ folder })
    }

    // Every other action manages an existing registered folder — admin-only.
    // NOTE: '' is the ROOT GATE and a valid folderId — test for string, not truthiness.
    const folderId = typeof body.folderId === 'string' ? body.folderId : null
    if (folderId === null) return fail('folderId is required')
    if (!principalIsFolderAdmin(p, folderId)) {
      return fail('Only a folder admin can manage this folder', 403)
    }

    switch (action) {
      case 'unregister':
        await unregisterFolder(p.communityId, folderId)
        audit(p, folderId, 'unregistered')
        return NextResponse.json({ ok: true })
      case 'setVisibility': {
        const visibility = VISIBILITIES.includes(body.visibility)
          ? (body.visibility as FolderVisibility)
          : null
        if (!visibility) return fail('visibility must be public or private')
        await setVisibility(p.communityId, folderId, visibility)
        audit(p, folderId, `visibility → ${visibility}`)
        return NextResponse.json({ ok: true })
      }
      case 'setLock': {
        const locked = body.locked === true
        await setFolderLock(p.communityId, folderId, locked)
        audit(p, folderId, locked ? 'locked' : 'unlocked')
        return NextResponse.json({ ok: true })
      }
      case 'setMember': {
        const member = typeof body.member === 'object' && body.member !== null ? body.member : null
        const userId = member && typeof member.userId === 'string' ? member.userId : null
        const level = LEVELS.includes(body.level) ? (body.level as FolderLevel) : null
        if (!userId || !level) return fail('member.userId and level are required')
        await setMemberLevel(
          p.communityId,
          folderId,
          {
            userId,
            name: typeof member.name === 'string' ? member.name : undefined,
            email: typeof member.email === 'string' ? member.email : undefined,
          },
          level,
          p.userId,
        )
        audit(p, folderId, `set ${userId} → ${level}`)
        return NextResponse.json({ ok: true })
      }
      case 'removeMember': {
        const userId = typeof body.userId === 'string' ? body.userId : null
        if (!userId) return fail('userId is required')
        await removeMember(p.communityId, folderId, userId)
        audit(p, folderId, `removed ${userId}`)
        return NextResponse.json({ ok: true })
      }
      default:
        return fail('Unknown action')
    }
  } catch (err) {
    return failFromError(err)
  }
}
