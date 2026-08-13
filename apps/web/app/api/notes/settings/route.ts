// Context display settings (lib/notes/contextSettings.ts).
//   GET  ?spaceId=            → { settings } — any member of the context.
//   POST { spaceId, contextName } → space admins only; empty name
//         resets to the default ("Space context").

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { readContextSettings, writeContextName } from '@/lib/notes/contextSettings'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const settings = await readContextSettings(context)
  return NextResponse.json({ settings })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.isPersonalSpace) {
    return fail('Personal spaces have no context settings')
  }
  if (!context.isAdmin) {
    return fail('Only space admins can rename the context', 403)
  }
  if (typeof body.contextName !== 'string') {
    return fail('contextName is required')
  }
  // Length policy is owned by writeContextName (it clamps).
  try {
    const settings = await writeContextName(context, body.contextName)
    return NextResponse.json({ settings })
  } catch (err) {
    return failFromError(err)
  }
}
