// GET /api/notes/audit?spaceId= → { entries }
// The shared context's compliance trail (private-folder reads + governance
// mutations), newest first, capped. Space-admin only.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail } from '@/lib/notes/api'
import { listAudit } from '@/lib/notes/audit'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  if (!context.isAdmin) return fail('Only an admin can view the audit trail', 403)
  return NextResponse.json({ entries: await listAudit(context.spaceId) })
}
