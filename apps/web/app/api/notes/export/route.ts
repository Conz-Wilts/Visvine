// GET /api/notes/export?spaceId=&scope=&path=
// Download a single note as a .md file (the stored markdown is the source of truth).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail } from '@/lib/notes/api'
import { readNote } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  try {
    const content = await readNote(context, path)
    const filename = (path.split('/').pop() || 'note.md').replace(/"/g, '')
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 })
  }
}
