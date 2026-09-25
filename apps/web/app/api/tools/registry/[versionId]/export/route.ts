import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { exportVersion } from '@/lib/tools/package'

/**
 * `GET /api/tools/registry/<versionId>/export` — a published version as a
 * `.vvtool` package: signed when Visvine lists it (lib/tools/package).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session
  const result = await exportVersion(versionId, { userId: session.userId, email: session.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return new Response(Buffer.from(result.bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Visvine-Package-Digest': result.digest,
    },
  })
}
