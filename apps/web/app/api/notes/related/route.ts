// GET /api/notes/related?communityId=&scope=&path=
// Notes most similar in content to the given one (TF-IDF cosine), excluding the
// note itself and any note already linked to/from it — surfacing unlinked but
// related notes. Mirrors rpc.ts 'related:get'.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail } from '@/lib/notes/api'
import { listRaw } from '@/lib/notes/store'
import { buildNoteIndex } from '@/lib/notes/shared/graph'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { relatedNotes } from '@/lib/notes/shared/related'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const target = new URL(req.url).searchParams.get('path')
  if (!target) return fail('path is required')

  const raw = await listRaw(brain)
  const index = buildNoteIndex(raw)
  const docs = raw.map((note) => {
    const meta = index.find((m) => m.path === note.path)
    return { path: note.path, title: meta?.title ?? note.path, body: splitFrontmatter(note.content).body }
  })

  const targetMeta = index.find((m) => m.path === target)
  const exclude = new Set<string>([target])
  for (const linked of targetMeta?.linkTargets ?? []) exclude.add(linked)
  for (const m of index) {
    if (m.linkTargets.includes(target)) exclude.add(m.path)
  }

  return NextResponse.json({ related: relatedNotes(docs, target, { exclude, limit: 5 }) })
}
