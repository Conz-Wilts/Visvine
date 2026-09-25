import { NextRequest, NextResponse } from 'next/server'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { importPackage } from '@/lib/tools/package'
import { PACKAGE_LIMITS } from '@/lib/tools/package/shared/layout'
import type { ImportResponse } from '@/lib/tools/api'

/**
 * `POST …/tools/import[?name=]` with a `.vvtool` package as the body — a new
 * working copy in this space, authored by the caller (lib/tools/package).
 * The door the CLI and scripts use; an AI client uses `import_tool`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength === 0) return bad('Send the package as the request body.', 400)
  if (bytes.byteLength > PACKAGE_LIMITS.maxPackageBytes) return bad('The package is too large.', 413)
  const result = await importPackage(ctx.principal, ctx.resolved, bytes, { name: req.nextUrl.searchParams.get('name') ?? undefined })
  if (!result.ok) return bad(result.error, result.status)
  const body: ImportResponse = {
    name: result.name,
    renamedFrom: result.renamedFrom,
    provenance: result.provenance,
    unverifiedSignature: result.unverifiedSignature,
    ignored: result.ignored,
    buildOk: result.buildOk,
    problems: result.problems,
  }
  return NextResponse.json(body, { status: 201 })
}
