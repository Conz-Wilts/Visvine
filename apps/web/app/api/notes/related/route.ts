// GET /api/notes/related?communityId=&scope=&path=
// Notes most similar in content to the given one (TF-IDF cosine), excluding the
// note itself and any note already linked to/from it — surfacing unlinked but
// related notes. Mirrors rpc.ts 'related:get'. Computed over the visibility-
// filtered vault, so private folders the caller can't read never rank.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault } from '@/lib/notes/brainService'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { relatedNotes } from '@/lib/notes/shared/related'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const target = new URL(req.url).searchParams.get('path')
  if (!target) return fail('path is required')

  const p = await principalOf(brain)
  const { raws, metas } = await visibleVault(p, brain)
  const docs = raws.map((note) => {
    const meta = metas.find((m) => m.path === note.path)
    return { path: note.path, title: meta?.title ?? note.path, body: splitFrontmatter(note.content).body }
  })

  const targetMeta = metas.find((m) => m.path === target)
  const exclude = new Set<string>([target])
  for (const linked of targetMeta?.linkTargets ?? []) exclude.add(linked)
  for (const m of metas) {
    if (m.linkTargets.includes(target)) exclude.add(m.path)
  }

  return NextResponse.json({ related: relatedNotes(docs, target, { exclude, limit: 5 }) })
}
