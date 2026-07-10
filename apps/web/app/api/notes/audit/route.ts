// GET /api/notes/audit?communityId= → { entries }
// The shared brain's compliance trail (private-folder reads + governance
// mutations), newest first, capped. Community-admin only.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail } from '@/lib/notes/api'
import { listAudit } from '@/lib/notes/audit'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  if (!brain.isAdmin) return fail('Only an admin can view the audit trail', 403)
  return NextResponse.json({ entries: await listAudit(brain.communityId) })
}
