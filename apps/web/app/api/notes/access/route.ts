// The context access surface (successor of the folder-registry route): one
// endpoint that answers "who can see this and why" and carries every grant
// mutation. All semantics live in lib/notes/shared/authz.ts + lib/notes/access.ts.
//
//   GET ?spaceId=&path=<p>   → per-path view: the caller's effective level
//        (canRead/canWrite/canManage), the merged who-has-access list with
//        provenance (when readable), restricted ancestors, and — for managers —
//        the grantable subjects (members + aliases). `path` may be '' (the root).
//   GET ?spaceId=            → overview: restricted/locked folders, whether
//        the caller is gated out of the context entirely, their readable roots.
//   POST { spaceId, action, ... }:
//        'grant'    { subjectType, subjectId?, path, level }   — manage at path
//        'revoke'   { grantId }                                — manage at the grant's path
//        'restrict' { folderPath, restricted }                 — manage at path
//        'setLock'  { folderPath, locked }                     — manage at path

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import {
  accessListFor,
  grantAccess,
  loadSpaceAccess,
  revokeAccess,
  setFolderLocked,
  setFolderRestricted,
} from '@/lib/notes/access'
import { listAliases, loadPersonAliases } from '@/lib/notes/aliases'
import { findAliasByRef } from '@/lib/types/context'
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
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

/** Restricted folders that cover or sit inside the caller's view of a path. */
function visibleRestricted(p: ContextPrincipal, path: string): string[] {
  return p.access.restricted.filter(
    (cut) =>
      path === cut ||
      path.startsWith(`${cut}/`) ||
      cut.startsWith(path === '' ? '' : `${path}/`),
  )
}

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const p = await principalOf(context)
  const url = new URL(req.url)
  const path = url.searchParams.get('path')

  const gated =
    !context.isPersonalSpace &&
    !p.spaceAdmin &&
    !p.access.grants.some((g) => g.level > 0)

  if (path === null) {
    // Space admins additionally get the full grant dump with subject
    // names — the Access-overview page (forgotten restrictions and grants are
    // the #1 permissions support ticket).
    let grants = null
    if (p.spaceAdmin && !context.isPersonalSpace) {
      const all = await loadSpaceAccess(context.spaceId)
      // Alias grants store the alias ID, so the display name comes from the
      // space's own vocabulary.
      const userIds = [...new Set(all.grants.filter((g) => g.subjectType === 'user').map((g) => g.subjectId))]
      const [users, vocabulary] = await Promise.all([
        userIds.length
          ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
          : Promise.resolve([]),
        loadPersonAliases(context.spaceId),
      ])
      const userName = new Map(users.map((u) => [u.id, u.name]))
      grants = all.grants.map((g) => ({
        ...g,
        subjectName:
          g.subjectType === 'space'
            ? 'Everyone'
            : g.subjectType === 'alias'
              ? (findAliasByRef(vocabulary, g.subjectId, 'Person')?.name ?? g.subjectId)
              : (userName.get(g.subjectId) ?? 'Former member'),
      }))
    }
    return NextResponse.json({
      me: { userId: p.userId, spaceAdmin: p.spaceAdmin },
      gated,
      restricted: p.access.restricted,
      locked: p.access.locked,
      readableRoots: p.spaceAdmin ? [''] : readableRoots(p.access),
      grants,
    })
  }

  const canRead = context.isPersonalSpace || principalCanRead(p, path)
  const canWrite = context.isPersonalSpace || principalCanWrite(p, path)
  const canManage = context.isPersonalSpace ? context.isAdmin : principalCanManage(p, path)

  let entries = null
  let subjects = null
  if (!context.isPersonalSpace && canRead) {
    entries = await accessListFor(context.spaceId, path)
  }
  if (!context.isPersonalSpace && canManage) {
    const [members, aliases] = await Promise.all([
      prisma.spaceMember.findMany({
        where: { spaceId: context.spaceId, status: 'active' },
        select: { userId: true, user: { select: { name: true, email: true, image: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      listAliases(context.spaceId),
    ])
    subjects = {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user?.name ?? 'Member',
        email: m.user?.email ?? null,
        image: m.user?.image ?? null,
      })),
      // `id` rides along so the picker can tell an alias already granted from
      // one that isn't — grant rows are keyed by id, not by name.
      aliases: aliases.map((a) => ({ id: a.id, name: a.name, color: a.color, admin: a.admin, system: a.system, holderCount: a.holders.length })),
    }
  }

  return NextResponse.json({
    path,
    me: { userId: p.userId, spaceAdmin: p.spaceAdmin },
    gated,
    canRead,
    canWrite,
    canManage,
    myLevel: context.isPersonalSpace ? 'full' : principalLevelName(p, path),
    restricted: context.isPersonalSpace ? [] : visibleRestricted(p, path),
    locked: context.isPersonalSpace ? [] : p.access.locked,
    entries,
    subjects,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.isPersonalSpace) {
    return fail('Personal spaces are private — there is nothing to share here')
  }
  const p = await principalOf(context)
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
          return fail('Only someone with full access here (or a space admin) can share it', 403)
        }
        const grant = await grantAccess(
          context.spaceId,
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
        const row = await prisma.contextGrant.findFirst({
          where: { id: grantId, spaceId: context.spaceId },
          select: { resourcePath: true },
        })
        if (!row) return fail('Unknown grant', 404)
        if (!principalCanManage(p, row.resourcePath)) {
          return fail('Only someone with full access here (or a space admin) can revoke it', 403)
        }
        await revokeAccess(context.spaceId, grantId, actor)
        return NextResponse.json({ ok: true })
      }
      case 'restrict': {
        const folderPath = typeof body.folderPath === 'string' ? body.folderPath : null
        if (!folderPath) return fail('folderPath is required')
        if (!principalCanManage(p, folderPath)) {
          return fail('Only someone with full access here (or a space admin) can restrict it', 403)
        }
        // A non-admin restricting a folder keeps full access ON the boundary —
        // otherwise the cut would sever their own manage rights and nobody
        // could undo it short of a space admin.
        if (body.restricted === true && !p.spaceAdmin) {
          await grantAccess(
            context.spaceId,
            { subjectType: 'user', subjectId: p.userId, resourcePath: folderPath, level: LEVEL_FULL },
            actor,
          )
        }
        await setFolderRestricted(context.spaceId, folderPath, body.restricted === true, actor)
        return NextResponse.json({ ok: true })
      }
      case 'setLock': {
        const folderPath = typeof body.folderPath === 'string' ? body.folderPath : null
        if (!folderPath) return fail('folderPath is required')
        if (!principalCanManage(p, folderPath)) {
          return fail('Only someone with full access here (or a space admin) can lock it', 403)
        }
        await setFolderLocked(context.spaceId, folderPath, body.locked === true, actor)
        return NextResponse.json({ ok: true })
      }
      default:
        return fail('Unknown action')
    }
  } catch (err) {
    return failFromError(err)
  }
}
