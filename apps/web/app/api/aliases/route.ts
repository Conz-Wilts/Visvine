// A community's PERSON aliases (lib/notes/aliases.ts) — the permission model in
// one list. An alias is a directory chip, a set of holders, and a set of brain
// grants, all at once, so the whole of it is managed in one place: Console →
// Aliases. The Types page shows them read-only.
//
// Any member may LIST them (they're organizational, not secret); community
// admins do everything else.
//   GET  ?communityId=                              → { aliases }
//   POST { communityId, action, ... }:
//        'create'        { name, color }
//        'update'        { name, newName?, color? }
//        'delete'        { name }
//        'setOwner'      { name, owner }
//        'addHolder'     { name, userId }
//        'removeHolder'  { name, userId }
// Any change that would leave nobody owning the community is refused with 400,
// as is any attempt to rename, recolour, delete or un-own the built-in Owner
// alias.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import {
  addAliasHolder,
  createAlias,
  deleteAlias,
  listAliases,
  removeAliasHolder,
  setAliasOwner,
  updateAlias,
} from '@/lib/notes/aliases'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  return NextResponse.json({ aliases: await listAliases(brain.communityId) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) return fail('Personal spaces have no aliases')
  if (!brain.isAdmin) return fail('Only a community admin can manage aliases', 403)
  const action = typeof body.action === 'string' ? body.action : null
  const actor = { userId: brain.actor.id, name: brain.actor.name }

  const name = typeof body.name === 'string' ? body.name : null
  if (!name) return fail('name is required')

  try {
    if (action === 'create') {
      const color = typeof body.color === 'string' ? body.color : ''
      await createAlias(brain.communityId, name, color, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'update') {
      const newName = typeof body.newName === 'string' ? body.newName : undefined
      const color = typeof body.color === 'string' ? body.color : undefined
      if (newName === undefined && color === undefined) {
        return fail('Nothing to change — pass newName or color')
      }
      await updateAlias(brain.communityId, name, { newName, color }, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'delete') {
      await deleteAlias(brain.communityId, name, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'setOwner') {
      await setAliasOwner(brain.communityId, name, body.owner === true, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'addHolder' || action === 'removeHolder') {
      const userId = typeof body.userId === 'string' ? body.userId : null
      if (!userId) return fail('userId is required')
      if (action === 'addHolder') {
        await addAliasHolder(brain.communityId, name, userId, actor)
      } else {
        await removeAliasHolder(brain.communityId, name, userId)
      }
      return NextResponse.json({ ok: true })
    }

    return fail('Unknown action')
  } catch (err) {
    return failFromError(err)
  }
}
