// Context Sources collection route.
//   GET    ?communityId=&scope=&folderId=            → { sources: ContextSourceMeta[] }
//   POST   multipart (file, path|folder) ?communityId= → { source } — upload + ingest
//   DELETE ?communityId=&path=                        → { ok } — row + chunks + GCS object
// Sources are non-note files living at brain paths, so the folder gate and
// visibility lens (inside brainService) govern them exactly like notes. The
// POST reads communityId from the query string — multipart has no JSON body,
// and requireBrain falls back to searchParams.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import {
  createSourceGated,
  deleteSourceGated,
  listVisibleSources,
} from '@/lib/notes/brainService'
import { sanitizePath } from '@/lib/notes/store'
import {
  MAX_SOURCE_BYTES,
  SOURCE_EXTENSIONS_LABEL,
  normalizeSourcePath,
  sourceKindOf,
} from '@/lib/notes/shared/sourceTypes'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const folderId = new URL(req.url).searchParams.get('folderId') ?? undefined
  const p = await principalOf(brain)
  const sources = await listVisibleSources(p, brain, folderId)
  return NextResponse.json({ sources })
}

export async function POST(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain

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

  // Destination: an explicit brain path, or folder + the file's own name.
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

  const p = await principalOf(brain)
  try {
    const result = await createSourceGated(p, brain, {
      path,
      name: file.name,
      kind,
      mimeType: file.type || 'application/octet-stream',
      buffer: Buffer.from(await file.arrayBuffer()),
      createdBy: brain.actor.id,
    })
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ source: result.source })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  try {
    const result = await deleteSourceGated(p, brain, path)
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
