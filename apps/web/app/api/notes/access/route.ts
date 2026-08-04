// The brain access surface (successor of the folder-registry route): one
// endpoint that answers "who can see this and why" and carries every grant
// mutation. All semantics live in lib/notes/shared/authz.ts + lib/notes/access.ts.
//
//   GET ?communityId=&path=<p>   → per-path view: the caller's effective level
//        (canRead/canWrite/canManage), the merged who-has-access list with
//        provenance (when readable), restricted ancestors, and — for managers —
//        the grantable subjects (members + aliases). `path` may be '' (the root).
//   GET ?communityId=            → overview: restricted/locked folders, whether
//        the caller is gated out of the brain entirely, their readable roots.
//   POST { communityId, action, ... }:
//        'grant'    { subjectType, subjectId?, path, level }   — manage at path
//        'revoke'   { grantId }                                — manage at the grant's path
//        'restrict' { folderPath, restricted }                 — manage at path
//        'setLock'  { folderPath, locked }                     — manage at path

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import {
  accessListFor,
  grantAccess,
  loadCommunityAccess,
  revokeAccess,
  setFolderLocked,
  setFolderRestricted,
} from '@/lib/notes/access'
import { listAliases } from '@/lib/notes/aliases'
import {
  principalCanManage,
  principalCanRead,
  principalCanWrite,
  principalLevelName,
} from '@/lib/notes/shared/permissions'
import {
  LEVEL_FULL,
  SUBJECT_TYPES,
  parseLevel,
  readableRoots,
  type GrantSubjectType,
} from '@/lib/notes/shared/authz'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'

/** Restricted folders that cover or sit inside the caller's view of a path. */
function visibleRestricted(p: BrainPrincipal, path: string): string[] {
  return p.access.restricted.filter(
    (cut) =>
      path === cut ||
      path.startsWith(`${cut}/`) ||
      cut.startsWith(path === '' ? '' : `${path}/`),
  )
}

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const url = new URL(req.url)
  const path = url.searchParams.get('path')

  const gated =
    !brain.isPersonalSpace &&
    !p.communityAdmin &&
    !p.access.grants.some((g) => g.level > 0)

  if (path === null) {
    // Community admins additionally get the full grant dump with subject
    // names — the Access-overview page (forgotten restrictions and grants are
    // the #1 permissions support ticket).
    let grants = null
    if (p.communityAdmin && !brain.isPersonalSpace) {
      const all = await loadCommunityAccess(brain.communityId)
      // Alias grants are stored by NAME — no lookup needed.
      const userIds = [...new Set(all.grants.filter((g) => g.subjectType === 'user').map((g) => g.subjectId))]
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : []
      const userName = new Map(users.map((u) => [u.id, u.name]))
      grants = all.grants.map((g) => ({
        ...g,
        subjectName:
          g.subjectType === 'community'
            ? 'Everyone'
            : g.subjectType === 'alias'
              ? g.subjectId
              : (userName.get(g.subjectId) ?? 'Former member'),
      }))
    }
    return NextResponse.json({
      me: { userId: p.userId, communityAdmin: p.communityAdmin },
      gated,
      restricted: p.access.restricted,
      locked: p.access.locked,
      readableRoots: p.communityAdmin ? [''] : readableRoots(p.access),
      grants,
    })
  }

  const canRead = brain.isPersonalSpace || principalCanRead(p, path)
  const canWrite = brain.isPersonalSpace || principalCanWrite(p, path)
  const canManage = brain.isPersonalSpace ? brain.isAdmin : principalCanManage(p, path)

  let entries = null
  let subjects = null
  if (!brain.isPersonalSpace && canRead) {
    entries = await accessListFor(brain.communityId, path)
  }
  if (!brain.isPersonalSpace && canManage) {
    const [members, aliases] = await Promise.all([
      prisma.userCommunity.findMany({
        where: { communityId: brain.communityId, status: 'active' },
        select: { userId: true, user: { select: { name: true, email: true, image: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      listAliases(brain.communityId),
    ])
    subjects = {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user?.name ?? 'Member',
        email: m.user?.email ?? null,
        image: m.user?.image ?? null,
      })),
      aliases: aliases.map((a) => ({ name: a.name, color: a.color, owner: a.owner, system: a.system, holderCount: a.holders.length })),
    }
  }

  return NextResponse.json({
    path,
    me: { userId: p.userId, communityAdmin: p.communityAdmin },
    gated,
    canRead,
    canWrite,
    canManage,
    myLevel: brain.isPersonalSpace ? 'full' : principalLevelName(p, path),
    restricted: brain.isPersonalSpace ? [] : visibleRestricted(p, path),
    locked: brain.isPersonalSpace ? [] : p.access.locked,
    entries,
    subjects,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) {
    return fail('Personal spaces are private — there is nothing to share here')
  }
  const p = await principalOf(brain)
  const action = typeof body.action === 'string' ? body.action : null
  const actor = { userId: p.userId, name: p.name }

  try {
    switch (action) {
      case 'grant': {
        const path = typeof body.path === 'string' ? body.path : null
        const level = parseLevel(body.level)
        const subjectType = SUBJECT_TYPES.includes(body.subjectType)
          ? (body.subjectType as GrantSubjectType)
          : null
        if (path === null || !level || !subjectType) {
          return fail('path, level, and subjectType are required')
        }
        if (!principalCanManage(p, path)) {
          return fail('Only someone with full access here (or a community admin) can share it', 403)
        }
        const grant = await grantAccess(
          brain.communityId,
          {
            subjectType,
            subjectId: typeof body.subjectId === 'string' ? body.subjectId : '',
            resourcePath: path,
            level,
          },
          actor,
        )
        return NextResponse.json({ grant })
      }
      case 'revoke': {
        const grantId = typeof body.grantId === 'string' ? body.grantId : null
        if (!grantId) return fail('grantId is required')
        const row = await prisma.brainGrant.findFirst({
          where: { id: grantId, communityId: brain.communityId },
          select: { resourcePath: true },
        })
        if (!row) return fail('Unknown grant', 404)
        if (!principalCanManage(p, row.resourcePath)) {
          return fail('Only someone with full access here (or a community admin) can revoke it', 403)
        }
        await revokeAccess(brain.communityId, grantId, actor)
        return NextResponse.json({ ok: true })
      }
      case 'restrict': {
        const folderPath = typeof body.folderPath === 'string' ? body.folderPath : null
        if (!folderPath) return fail('folderPath is required')
        if (!principalCanManage(p, folderPath)) {
          return fail('Only someone with full access here (or a community admin) can restrict it', 403)
        }
        // A non-admin restricting a folder keeps full access ON the boundary —
        // otherwise the cut would sever their own manage rights and nobody
        // could undo it short of a community admin.
        if (body.restricted === true && !p.communityAdmin) {
          await grantAccess(
            brain.communityId,
            { subjectType: 'user', subjectId: p.userId, resourcePath: folderPath, level: LEVEL_FULL },
            actor,
          )
        }
        await setFolderRestricted(brain.communityId, folderPath, body.restricted === true, actor)
        return NextResponse.json({ ok: true })
      }
      case 'setLock': {
        const folderPath = typeof body.folderPath === 'string' ? body.folderPath : null
        if (!folderPath) return fail('folderPath is required')
        if (!principalCanManage(p, folderPath)) {
          return fail('Only someone with full access here (or a community admin) can lock it', 403)
        }
        await setFolderLocked(brain.communityId, folderPath, body.locked === true, actor)
        return NextResponse.json({ ok: true })
      }
      default:
        return fail('Unknown action')
    }
  } catch (err) {
    return failFromError(err)
  }
}
