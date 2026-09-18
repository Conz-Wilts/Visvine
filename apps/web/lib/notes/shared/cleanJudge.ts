// The judged half of a clean, pure: what to ask a judge about the mechanical
// review's output, and what its answers are allowed to change.
//
// The review (./review.ts) is rules: a title appears in a body, two notes share
// words, a note is 180 days old. Rules are cheap and blind to meaning — "Will"
// the person is linked from every "will", two meetings from one template look
// like duplicates, "Ana owns Acme" and "Sam took over Acme" look unrelated, a
// person's bio goes stale for being left alone. A judge reads the meaning.
//
// What a verdict may do is deliberately lopsided:
//
//   - to AUTO-FIXES it can only REMOVE: veto a mention link, veto a stale mark.
//     A clean with a judge writes a subset of what it would write without one.
//   - to the WORKLIST it can add, confirm, dismiss and annotate — a worklist is
//     read by a person or an agent who decides.
//
// No verdict changes nothing. Dates and numbers stay with the mechanical
// contradiction check, which is good at exactly what a judge is bad at; which
// of two conflicting notes is NEWER is read from the notes' own times here.

import type { JudgeAnswers, JudgeQuestions, JudgeState } from '@/lib/judge/shared/types'
import { choiceOf, noulOf, scoreOf } from '@/lib/judge/shared/types'
import {
  CONFLICT_AT,
  CONFLICT_QUESTION,
  DIFFERENT_BELOW,
  DUPLICATE_AT,
  DURABILITY_QUESTION,
  DURABLE_AT,
  MENTION_PICK_CONFIDENCE,
  MENTION_QUESTION,
  MENTION_VETO_BELOW,
  SAME_NOTE_QUESTION,
} from '@/lib/judge/shared/questions'
import type { NoteMeta, RawNote } from './types'
import { normalizeKey, splitFrontmatter } from './markdown'
import { firstMentionExcerpt } from './references'
import { isIndexPath } from './indexNote'
import { isRetired, supersedesOf } from './lifecycle'
import { noteTimeOf } from './queryPlan'
import { nearPairs, type AutoFix, type Issue } from './review'

/** Requests one pass may spend, per kind — a first clean of a large space must end. */
const CAPS = { mentions: 150, picks: 40, stale: 150, pairs: 120 }
/** How related two notes must be to be worth a judge's read. Below the mechanical floors on purpose. */
const PAIR_MIN_SIM = 0.3
const PAIR_NOTE_CAP = 1_500
const NOTE_TEXT_CHARS = 1_200
const MAX_PICK_CANDIDATES = 8
/** Folders of machine-read notes — never a duplicate or a conflict of anything. */
const CONFIG_FOLDERS = new Set(['connectors', 'models', 'agents', 'tools', 'actions', 'recipes', 'guides'])

type Task =
  | { kind: 'mention'; fix: Extract<AutoFix, { kind: 'linkMention' }> }
  | { kind: 'pick'; issue: Issue; candidates: string[] }
  | { kind: 'stale'; fix: Extract<AutoFix, { kind: 'setStale' }> }
  | { kind: 'pair'; a: string; b: string }

export interface JudgedCleanPlan {
  tasks: Task[]
  requests: { state: JudgeState; questions: JudgeQuestions }[]
}

export interface JudgedCleanInput {
  raws: RawNote[]
  metas: NoteMeta[]
  fixes: AutoFix[]
  issues: Issue[]
  /** Derived memories per note, when the space has them — the sharpest input for a conflict. */
  claimsByPath?: ReadonlyMap<string, readonly string[]>
  /** Which notes this clean may act on; a pair is read when either side is. */
  inScope: (path: string) => boolean
}

const describe = (m: NoteMeta) => ({
  title: m.title,
  type: typeof m.frontmatter.type === 'string' ? m.frontmatter.type : '',
  description: typeof m.frontmatter.description === 'string' ? m.frontmatter.description : '',
})

function namesOf(m: NoteMeta): string[] {
  const aliases = Array.isArray(m.frontmatter.aliases) ? (m.frontmatter.aliases as unknown[]).map(String) : []
  return [m.title, ...aliases]
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|')

export function planJudgedClean(input: JudgedCleanInput): JudgedCleanPlan {
  const byPath = new Map(input.metas.map((m) => [m.path, m]))
  const bodyByPath = new Map(input.raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const tasks: Task[] = []
  const requests: JudgedCleanPlan['requests'] = []
  const count = { mentions: 0, picks: 0, stale: 0, pairs: 0 }

  for (const fix of input.fixes) {
    if (fix.kind === 'linkMention' && count.mentions < CAPS.mentions) {
      const target = byPath.get(fix.targetPath)
      const passage = firstMentionExcerpt(bodyByPath.get(fix.path) ?? '', fix.title)
      if (!target || !passage) continue
      count.mentions += 1
      tasks.push({ kind: 'mention', fix })
      requests.push({ state: { name: fix.title, passage, candidate: describe(target) }, questions: { refers: MENTION_QUESTION } })
    } else if (fix.kind === 'setStale' && count.stale < CAPS.stale) {
      const m = byPath.get(fix.path)
      if (!m) continue
      count.stale += 1
      tasks.push({ kind: 'stale', fix })
      requests.push({
        state: { ...describe(m), text: (bodyByPath.get(fix.path) ?? '').trim().slice(0, NOTE_TEXT_CHARS) },
        questions: { durability: DURABILITY_QUESTION },
      })
    }
  }

  for (const issue of input.issues) {
    if (issue.kind !== 'unlinked-mention' || count.picks >= CAPS.picks) continue
    const name = /^mentions "(.+)" \(ambiguous\)$/.exec(issue.detail)?.[1]
    if (!name) continue
    const key = normalizeKey(name)
    const candidates = input.metas.filter((m) => namesOf(m).some((n) => normalizeKey(n) === key)).slice(0, MAX_PICK_CANDIDATES)
    const passage = firstMentionExcerpt(bodyByPath.get(issue.path) ?? '', name)
    if (candidates.length < 2 || !passage) continue
    count.picks += 1
    const criteria: Record<string, string> = { none: 'None of these, or the passage does not say enough to tell.' }
    candidates.forEach((m, i) => {
      const d = describe(m)
      criteria[`c${i}`] = [d.title, d.type, d.description, m.path].filter(Boolean).join(' — ')
    })
    tasks.push({ kind: 'pick', issue, candidates: candidates.map((m) => m.path) })
    requests.push({
      state: { name, passage },
      questions: { which: { type: 'choice', instructions: 'Which candidate does the name in the passage refer to?', criteria } },
    })
  }

  // The similarity pass is the expensive part; a very large space compares its
  // most recently changed notes, which is where new duplicates and conflicts are.
  const comparable = input.metas
    .filter((m) => !isIndexPath(m.path) && !CONFIG_FOLDERS.has(m.path.split('/')[0]) && !isRetired(m.frontmatter))
    .sort((x, y) => y.mtime - x.mtime)
    .slice(0, PAIR_NOTE_CAP)
  const docs = comparable.map((m) => ({ path: m.path, title: m.title, body: bodyByPath.get(m.path) ?? '' }))
  for (const pair of nearPairs(docs, PAIR_MIN_SIM, 3)) {
    if (count.pairs >= CAPS.pairs) break
    if (!input.inScope(pair.a) && !input.inScope(pair.b)) continue
    const a = byPath.get(pair.a)!
    const b = byPath.get(pair.b)!
    if (supersedesOf(a.frontmatter).includes(b.path) || supersedesOf(b.frontmatter).includes(a.path)) continue
    count.pairs += 1
    const side = (m: NoteMeta) => ({
      title: m.title,
      text: (bodyByPath.get(m.path) ?? '').trim().slice(0, NOTE_TEXT_CHARS),
      statements: [...(input.claimsByPath?.get(m.path) ?? [])].slice(0, 12),
    })
    tasks.push({ kind: 'pair', a: a.path, b: b.path })
    requests.push({ state: { a: side(a), b: side(b) }, questions: { same: SAME_NOTE_QUESTION, conflict: CONFLICT_QUESTION } })
  }

  return { tasks, requests }
}

export interface JudgedCleanResult {
  fixes: AutoFix[]
  issues: Issue[]
  judged: { mentions_vetoed: number; stale_vetoed: number; duplicates_found: number; duplicates_dismissed: number; conflicts_found: number; mentions_picked: number }
}

/** Apply the answers (index-aligned with the plan's requests; null = no verdict). */
export function applyJudgedClean(
  input: Pick<JudgedCleanInput, 'metas' | 'fixes' | 'issues' | 'inScope'>,
  plan: JudgedCleanPlan,
  answers: (JudgeAnswers | null)[],
): JudgedCleanResult {
  const byPath = new Map(input.metas.map((m) => [m.path, m]))
  const vetoed = new Set<AutoFix>()
  const dismissed = new Set<Issue>()
  const annotate = new Map<Issue, string>()
  const added: Issue[] = []
  const judged = { mentions_vetoed: 0, stale_vetoed: 0, duplicates_found: 0, duplicates_dismissed: 0, conflicts_found: 0, mentions_picked: 0 }
  const pairIssue = (kind: string, a: string, b: string) =>
    input.issues.find((i) => i.kind === kind && i.other !== undefined && pairKey(i.path, i.other) === pairKey(a, b))

  plan.tasks.forEach((task, i) => {
    const answer = answers[i]
    if (!answer) return
    if (task.kind === 'mention') {
      const refers = noulOf(answer, 'refers')
      if (refers !== undefined && refers < MENTION_VETO_BELOW) {
        vetoed.add(task.fix)
        judged.mentions_vetoed += 1
      }
    } else if (task.kind === 'stale') {
      const durability = scoreOf(answer, 'durability')
      if (durability && durability.score >= DURABLE_AT) {
        vetoed.add(task.fix)
        judged.stale_vetoed += 1
      }
    } else if (task.kind === 'pick') {
      const which = choiceOf(answer, 'which')
      if (!which || which.choice === 'none' || which.confidence < MENTION_PICK_CONFIDENCE) return
      const path = task.candidates[Number(which.choice.slice(1))]
      if (!path) return
      annotate.set(task.issue, ` — most likely ${byPath.get(path)?.title ?? path} (/${path}, ${which.confidence.toFixed(2)})`)
      judged.mentions_picked += 1
    } else {
      const same = scoreOf(answer, 'same')
      const conflict = noulOf(answer, 'conflict')
      const a = byPath.get(task.a)
      const b = byPath.get(task.b)
      if (!a || !b || !same) return
      const mechanicalDup = pairIssue('duplicate', a.path, b.path)
      if (same.score >= DUPLICATE_AT) {
        judged.duplicates_found += 1
        if (mechanicalDup) annotate.set(mechanicalDup, ' — the same thing by meaning, not only by wording')
        else {
          const [here, there] = input.inScope(a.path) ? [a, b] : [b, a]
          added.push({ path: here.path, kind: 'duplicate', other: there.path, detail: `says the same as ${there.title} (${there.path}) in different words — consider merging` })
        }
      } else if (same.score < DIFFERENT_BELOW && same.confidence >= 0.6 && mechanicalDup) {
        dismissed.add(mechanicalDup)
        judged.duplicates_dismissed += 1
      }
      if (conflict !== undefined && conflict >= CONFLICT_AT && same.score >= DIFFERENT_BELOW) {
        judged.conflicts_found += 1
        const mechanical = pairIssue('contradiction', a.path, b.path)
        if (mechanical) annotate.set(mechanical, ' — confirmed by meaning')
        else {
          // Which one is newer is the notes' own record, never the judge's guess.
          const [newer, older] = noteTimeOf(a) >= noteTimeOf(b) ? [a, b] : [b, a]
          const [here, there] = input.inScope(newer.path) ? [newer, older] : [older, newer]
          const lead = here === newer ? `appears to replace or conflict with the older ${there.title}` : `appears to be replaced or contradicted by the newer ${there.title}`
          added.push({ path: here.path, kind: 'contradiction', other: there.path, detail: `${lead} (${there.path}) — if ${newer.title} is current, add \`supersedes: /${older.path}\` to it` })
        }
      }
    }
  })

  return {
    fixes: input.fixes.filter((f) => !vetoed.has(f)),
    issues: [...input.issues.filter((i) => !dismissed.has(i)).map((i) => (annotate.has(i) ? { ...i, detail: i.detail + annotate.get(i)! } : i)), ...added],
    judged,
  }
}
