// Single Context Source route.
//   GET  ?spaceId=&path=&offset=&maxChars= → { source, text, totalChars, downloadUrl }
//        A page of the extracted text plus a short-lived signed URL for the
//        original file. Private-folder reads are audited inside contextService.
//   POST { spaceId, path, action: 'reingest' } → { source } — gated retry
//        (failed ingestion or embedding-model change).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { readSourceVisible, reingestSourceGated } from '@/lib/notes/contextService'
import { findSource } from '@/lib/notes/sourceStore'
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const params = new URL(req.url).searchParams
  const path = params.get('path')
  if (!path) return fail('path is required')
  const offsetChars = Number(params.get('offset') ?? 0) || 0
  const maxChars = Number(params.get('maxChars') ?? 0) || undefined

  const p = await principalOf(context)
  try {
    const page = await readSourceVisible(p, context, path, { offsetChars, maxChars })
    if (!page) return fail(`No accessible source: ${path}`, 404)
    const row = await findSource(context, page.meta.path)
    // gcsPath '' = original not stored (storage unconfigured at upload time).
    const downloadUrl =
      row?.gcsPath && process.env.GCS_RESOURCES_BUCKET
        ? await getSignedUrl(RESOURCES_BUCKET(), row.gcsPath)
        : null
    return NextResponse.json({
      source: page.meta,
      text: page.text,
      totalChars: page.totalChars,
      downloadUrl,
    })
  } catch (err) {
    return failFromError(err)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  if (body.action !== 'reingest') return fail('Unknown action')

  const p = await principalOf(context)
  try {
    const result = await reingestSourceGated(p, context, path)
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ source: result.source })
  } catch (err) {
    return failFromError(err)
  }
}
