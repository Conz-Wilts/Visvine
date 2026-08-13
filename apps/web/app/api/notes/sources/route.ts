// Context Sources collection route.
//   GET    ?spaceId=&scope=&folderId=            → { sources: ContextSourceMeta[] }
//   POST   multipart (file, path|folder) ?spaceId= → { source } — upload + ingest
//   DELETE ?spaceId=&path=                        → { ok } — row + chunks + GCS object
// Sources are non-note files living at context paths, so the folder gate and
// visibility lens (inside contextService) govern them exactly like notes. The
// POST reads spaceId from the query string — multipart has no JSON body,
// and requireContext falls back to searchParams.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import {
  createSourceGated,
  deleteSourceGated,
  listVisibleSources,
} from '@/lib/notes/contextService'
import { sanitizePath } from '@/lib/notes/store'
import {
  MAX_SOURCE_BYTES,
  SOURCE_EXTENSIONS_LABEL,
  normalizeSourcePath,
  sourceKindOf,
} from '@/lib/notes/shared/sourceTypes'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const folderId = new URL(req.url).searchParams.get('folderId') ?? undefined
  const p = await principalOf(context)
  const sources = await listVisibleSources(p, context, folderId)
  return NextResponse.json({ sources })
}

export async function POST(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail('Expected multipart form data')
  }
  const file = form.get('file')
  if (!(file instanceof File)) return fail('file is required')
  if (file.size > MAX_SOURCE_BYTES)
    return fail(`File too large (max ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB)`)

  const kind = sourceKindOf(file.name)
  if (!kind) return fail(`Unsupported file type — ${SOURCE_EXTENSIONS_LABEL} are supported`)

  // Destination: an explicit context path, or folder + the file's own name.
  const rawPath = form.get('path')
  const rawFolder = form.get('folder')
  const dest =
    typeof rawPath === 'string' && rawPath
      ? rawPath
      : typeof rawFolder === 'string' && rawFolder
        ? `${rawFolder}/${file.name}`
        : file.name

  let path: string
  try {
    path = normalizeSourcePath(sanitizePath(dest))
  } catch (err) {
    return failFromError(err)
  }

  const p = await principalOf(context)
  try {
    const result = await createSourceGated(p, context, {
      path,
      name: file.name,
      kind,
      mimeType: file.type || 'application/octet-stream',
      buffer: Buffer.from(await file.arrayBuffer()),
      createdBy: context.actor.id,
    })
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ source: result.source })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  try {
    const result = await deleteSourceGated(p, context, path)
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
