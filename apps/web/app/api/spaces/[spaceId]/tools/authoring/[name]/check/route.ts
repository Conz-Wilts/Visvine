import { NextRequest, NextResponse } from 'next/server'
import { describeAuthoredTool } from '@/lib/tools/service'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { runStaticChecks } from '@/lib/tools/checks/analyze'
import { latestWorkingReport, recordReport } from '@/lib/tools/checks/runs'
import type { CheckResponse } from '@/lib/tools/api'

/**
 * Run the static checks on a working copy now — the same stages a publish
 * runs, so what passes here is what publish accepts — and record the report
 * the Tool tab then shows. Anyone who can open the Tool may ask; the report is
 * about the code they can already read.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> },
) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const tool = await describeAuthoredTool(ctx.principal, ctx.resolved, name)
  if (!tool) return bad('Tool not found', 404)
  if (!tool.build) return bad(`${name} has never been compiled here — save it once, then check it.`, 409)

  const report = await runStaticChecks({
    index: tool.sources['index.md'],
    ui: tool.sources['ui.tsx'],
    data: tool.sources['data.js'],
    modules: tool.modules,
    config: tool.config,
    build: {
      ok: tool.build.ok,
      errors: tool.build.errors,
      warnings: tool.build.warnings,
      configError: tool.build.configError,
    },
  })
  await recordReport({
    spaceId: ctx.resolved.spaceId,
    name,
    versionId: null,
    sourceHash: tool.build.sourceHash,
    trigger: 'check',
    report,
  })
  const stored = await latestWorkingReport(ctx.resolved.spaceId, name)
  if (!stored) return bad('The report could not be read back.', 500)
  const body: CheckResponse = { checks: { ...stored, stale: false } }
  return NextResponse.json(body)
}
