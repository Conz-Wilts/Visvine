// The note-first create commit: turns a filled-in draft into a real directory
// node AND its canonical context note in one gated call.
//
//   POST { spaceId, type, name, alias?, identityId?, spaceRef?, fields?, body?, tags? }
//     → 201 { node, notePath, resolution, noteError? }
//     → 409 { error, existingNodeId, existingPath }
//     → 403 { error }
//
// The work itself lives in lib/directory/createEntity.ts — the MCP
// `add_context` tool calls the same function directly, so this handler is only
// the HTTP adapter: parse, resolve the context (membership check), delegate, map
// the result union onto status codes.
//
// Why this exists alongside POST /api/data/nodes: that route is the admin-only
// bulk/Data-tab surface. Here the rule is "if you could write people/craig.md by
// hand, you can create Craig" — active membership plus the context's own write
// gate at the target note path.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { createEntity } from '@/lib/directory/createEntity'
import { handleApiError } from '@/lib/api/route'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const context = await requireContext(req, body)
    if (context instanceof Response) return context

    const result = await createEntity(context, {
      type: typeof body.type === 'string' ? body.type : '',
      name: typeof body.name === 'string' ? body.name : '',
      alias: typeof body.alias === 'string' ? body.alias : null,
      identityId: typeof body.identityId === 'string' ? body.identityId : null,
      spaceRef: typeof body.spaceRef === 'string' ? body.spaceRef : null,
      fields: (body.fields ?? {}) as Record<string, unknown>,
      body: typeof body.body === 'string' ? body.body : '',
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t: unknown): t is string => typeof t === 'string')
        : [],
    })

    if (!result.ok) {
      // The 409 carries the existing node/path so the client can offer
      // "already exists — open it" rather than a bare error.
      const payload: Record<string, unknown> = { error: result.error }
      if (result.status === 409) {
        payload.existingNodeId = result.existingNodeId ?? null
        payload.existingPath = result.existingPath
      }
      return NextResponse.json(payload, { status: result.status })
    }

    return NextResponse.json(
      {
        node: result.node,
        notePath: result.notePath,
        resolution: result.resolution,
        noteError: result.noteError,
      },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err, 'api.directory.entities.post.failed')
  }
}
