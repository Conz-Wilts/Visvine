// What a caller should know before (or just after) creating a note: which
// existing notes are already about the same subject, and where notes like it
// are filed. A duplicate that is never written costs nothing to merge; one
// found by the nightly clean costs a read, a merge and a trash.
//
// Advice only. It never refuses a write and never changes one — the caller is
// told, and decides. Candidates come from the ordinary search under the
// caller's own lens, so nothing they cannot read is named. The judge decides
// "same subject"; with no judge there is no advice, and the write is as before.

import { decide, decideMany, judgeConfigured } from '@/lib/judge/client'
import { choiceOf, scoreOf } from '@/lib/judge/shared/types'
import { FILING_CONFIDENCE, filingQuestion, SAME_NOTE_QUESTION, SIMILAR_AT, DUPLICATE_AT } from '@/lib/judge/shared/questions'
import { parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { isIndexPath } from './shared/indexNote'
import { searchContext, visibleVault, writeDenial } from './contextService'
import type { Context } from './store'
import type { ContextPrincipal } from './shared/contextTypes'

const CANDIDATES = 5
const TEXT_CHARS = 1_200
const MAX_OPTIONS = 24
const DEADLINE_MS = 3_000

export interface WriteAdvice {
  /** Existing notes about the same subject, closest first. */
  similar: { path: string; title: string; relation: 'same thing' | 'same subject' }[]
  suggested?: { type?: string; folder?: string }
}

export async function adviseWrite(p: ContextPrincipal, context: Context, path: string, content: string): Promise<WriteAdvice | null> {
  if (!judgeConfigured() || isIndexPath(path)) return null
  const fm = parseFrontmatter(content)
  const body = splitFrontmatter(content).body.trim()
  const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : (path.split('/').pop() ?? path).replace(/\.md$/i, '')
  if (body.length < 40) return null

  const { raws, metas } = await visibleVault(p, context)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const found = await searchContext(p, context, `${title} ${body.slice(0, 200)}`, {}, CANDIDATES + 1, { judge: false })
  const hits = found.hits.filter((h) => h.kind === 'note' && h.path !== path && !isIndexPath(h.path)).slice(0, CANDIDATES)

  const mine = { title, text: body.slice(0, TEXT_CHARS) }
  const answers = await decideMany(
    hits.map((h) => ({
      state: { a: mine, b: { title: h.title, text: (bodyByPath.get(h.path) ?? '').trim().slice(0, TEXT_CHARS) } },
      questions: { same: SAME_NOTE_QUESTION },
    })),
    { deadlineMs: DEADLINE_MS },
  )
  const similar = hits
    .map((h, i) => ({ h, score: scoreOf(answers[i], 'same')?.score }))
    .filter((x): x is { h: (typeof hits)[number]; score: number } => x.score !== undefined && x.score >= SIMILAR_AT)
    .sort((a, b) => b.score - a.score)
    .map(({ h, score }) => ({ path: h.path, title: h.title, relation: score >= DUPLICATE_AT ? ('same thing' as const) : ('same subject' as const) }))

  // Filing: only kinds and folders the space already uses — the vocabulary is
  // closed, so a suggestion is always something that exists.
  const types = [...new Set(metas.map((m) => m.frontmatter.type).filter((t): t is string => typeof t === 'string' && t.trim() !== ''))].slice(0, MAX_OPTIONS)
  const folders = metas
    .filter((m) => isIndexPath(m.path) && m.path !== 'index.md')
    .map((m) => ({ folder: m.path.replace(/\/index\.md$/, ''), about: [m.title, m.frontmatter.description].filter((v) => typeof v === 'string' && v).join(' — ') }))
    .filter((f) => writeDenial(p, context, `${f.folder}/x.md`) === null)
    .slice(0, MAX_OPTIONS)
  const needsType = typeof fm.type !== 'string' && types.length > 1
  const needsFolder = !path.includes('/') && folders.length > 1
  let suggested: WriteAdvice['suggested']
  if (needsType || needsFolder) {
    const questions = {
      ...(needsType ? { type: filingQuestion('type', Object.fromEntries(types.map((t, i) => [`t${i}`, t]))) } : {}),
      ...(needsFolder ? { folder: filingQuestion('folder', Object.fromEntries(folders.map((f, i) => [`f${i}`, `${f.folder}/ — ${f.about}`]))) } : {}),
    }
    const filed = await decide(mine, questions, { deadlineMs: DEADLINE_MS })
    const type = choiceOf(filed, 'type')
    const folder = choiceOf(filed, 'folder')
    const pickedType = type && type.choice !== 'none' && type.confidence >= FILING_CONFIDENCE ? types[Number(type.choice.slice(1))] : undefined
    const pickedFolder = folder && folder.choice !== 'none' && folder.confidence >= FILING_CONFIDENCE ? folders[Number(folder.choice.slice(1))]?.folder : undefined
    if (pickedType || pickedFolder) suggested = { ...(pickedType ? { type: pickedType } : {}), ...(pickedFolder ? { folder: pickedFolder } : {}) }
  }

  return similar.length || suggested ? { similar, ...(suggested ? { suggested } : {}) } : null
}
