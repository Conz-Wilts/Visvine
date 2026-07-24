// Brain display settings (lib/notes/brainSettings.ts).
//   GET  ?communityId=            → { settings } — any member of the brain.
//   POST { communityId, contextName } → community admins only; empty name
//         resets to the default ("Community context").

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { readBrainSettings, writeContextName } from '@/lib/notes/brainSettings'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const settings = await readBrainSettings(brain)
  return NextResponse.json({ settings })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) {
    return fail('Personal spaces have no context settings')
  }
  if (!brain.isAdmin) {
    return fail('Only community admins can rename the context', 403)
  }
  if (typeof body.contextName !== 'string') {
    return fail('contextName is required')
  }
  // Length policy is owned by writeContextName (it clamps).
  try {
    const settings = await writeContextName(brain, body.contextName)
    return NextResponse.json({ settings })
  } catch (err) {
    return failFromError(err)
  }
}
