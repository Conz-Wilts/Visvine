// A space's PERSON aliases (lib/notes/aliases.ts) — the permission model in
// one list. An alias is a directory chip, a set of holders, and a set of context
// grants, all at once, so the whole of it is managed in one place: Console →
// Aliases. The Types page shows them read-only.
//
// Any member may LIST them (they're organizational, not secret); space
// admins do everything else.
//   GET  ?spaceId=                              → { aliases }
//   POST { spaceId, action, ... }:
//        'create'        { name, color, nodeType? }
//        'update'        { name, newName?, color?, nodeType? }
//        'delete'        { name, nodeType? }
//        'setOwner'      { name, owner }
//        'addHolder'     { name, userId }
//        'removeHolder'  { name, userId }
// Any change that would leave nobody owning the space is refused with 400,
// as is any attempt to rename, recolour, delete or un-own the built-in Owner
// alias.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import {
  addAliasHolder,
  createAlias,
  deleteAlias,
  listAliases,
  removeAliasHolder,
  setAliasOwner,
  updateAlias,
} from '@/lib/notes/aliases'
import {
  createTypeAlias,
  deleteTypeAlias,
  updateTypeAlias,
} from '@/lib/notes/typeAliases'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  return NextResponse.json({ aliases: await listAliases(context.spaceId) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.isPersonalSpace) return fail('Personal spaces have no aliases')
  if (!context.isAdmin) return fail('Only a space admin can manage aliases', 403)
  const action = typeof body.action === 'string' ? body.action : null
  const actor = { userId: context.actor.id, name: context.actor.name }

  const name = typeof body.name === 'string' ? body.name : null
  if (!name) return fail('name is required')

  // `nodeType` opts into the whole vocabulary rather than just Person's, through
  // lib/notes/typeAliases.ts — the same door the MCP manage_alias tool uses, and
  // the one that clears directory chips when an alias goes. Absent, this stays
  // the Person-only surface it has always been.
  const nodeType = typeof body.nodeType === 'string' ? body.nodeType : null

  try {
    if (action === 'create') {
      const color = typeof body.color === 'string' ? body.color : ''
      if (nodeType) {
        await createTypeAlias(context.spaceId, nodeType, name, color, actor)
      } else {
        await createAlias(context.spaceId, name, color, actor)
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'update') {
      const newName = typeof body.newName === 'string' ? body.newName : undefined
      const color = typeof body.color === 'string' ? body.color : undefined
      if (newName === undefined && color === undefined) {
        return fail('Nothing to change — pass newName or color')
      }
      if (nodeType) {
        await updateTypeAlias(context.spaceId, nodeType, name, { newName, color }, actor)
      } else {
        await updateAlias(context.spaceId, name, { newName, color }, actor)
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'delete') {
      if (nodeType) {
        await deleteTypeAlias(context.spaceId, nodeType, name, actor)
      } else {
        await deleteAlias(context.spaceId, name, actor)
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'setOwner') {
      await setAliasOwner(context.spaceId, name, body.owner === true, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'addHolder' || action === 'removeHolder') {
      const userId = typeof body.userId === 'string' ? body.userId : null
      if (!userId) return fail('userId is required')
      if (action === 'addHolder') {
        await addAliasHolder(context.spaceId, name, userId, actor)
      } else {
        await removeAliasHolder(context.spaceId, name, userId)
      }
      return NextResponse.json({ ok: true })
    }

    return fail('Unknown action')
  } catch (err) {
    return failFromError(err)
  }
}
