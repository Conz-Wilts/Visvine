// The judged half of a clean, pure: what is asked, and what an answer may change.
// Run: node --import tsx --test tests/clean-judge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { applyJudgedClean, planJudgedClean } from '../lib/notes/shared/cleanJudge'
import { buildNoteIndex } from '../lib/notes/shared/context'
import type { AutoFix, Issue } from '../lib/notes/shared/review'
import type { JudgeAnswers } from '../lib/judge/shared/types'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 1): RawNote => ({ path, content, mtime })

const RAWS: RawNote[] = [
  note('people/will/index.md', '---\ntitle: Will\ntype: Person\ndescription: Head of sales\n---\nRuns the sales team.'),
  note('notes/plan.md', '---\ntitle: Plan\n---\nWe will ship the pricing change on Friday after the review.'),
  note('notes/old-bio.md', '---\ntitle: Ana bio\n---\nAna founded the company and leads product. She studied in Madrid.'),
  note('decisions/owner-a.md', '---\ntitle: Acme account owner\n---\nAna owns the Acme account and leads every Acme renewal call.', 10),
  note('decisions/owner-b.md', '---\ntitle: Acme account handover\n---\nSam took over the Acme account in June and leads every Acme renewal call.', 20),
]
const metas = buildNoteIndex(RAWS)
const everywhere = () => true

const mention: AutoFix = { kind: 'linkMention', path: 'notes/plan.md', title: 'Will', targetPath: 'people/will/index.md' }
const stale: AutoFix = { kind: 'setStale', path: 'notes/old-bio.md' }
const fill: AutoFix = { kind: 'addMissingFrontmatter', path: 'notes/plan.md', fields: { description: 'x' } }

test('the plan asks about mention links, stale marks and related pairs — and nothing else', () => {
  const plan = planJudgedClean({ raws: RAWS, metas, fixes: [mention, stale, fill], issues: [], inScope: everywhere })
  assert.deepEqual(plan.tasks.map((t) => t.kind).sort(), ['mention', 'pair', 'stale'])
  assert.equal(plan.requests.length, plan.tasks.length)
  const asked = plan.requests[plan.tasks.findIndex((t) => t.kind === 'mention')].state as { passage: string; candidate: { type: string } }
  assert.match(asked.passage, /We will ship/)
  assert.equal(asked.candidate.type, 'Person')
  const pair = plan.tasks.find((t) => t.kind === 'pair')
  assert.deepEqual(pair && pair.kind === 'pair' ? [pair.a, pair.b].sort() : null, ['decisions/owner-a.md', 'decisions/owner-b.md'])
})

test('a verdict can only remove auto-fixes; no verdict removes none', () => {
  const input = { raws: RAWS, metas, fixes: [mention, stale, fill], issues: [] as Issue[], inScope: everywhere }
  const plan = planJudgedClean(input)
  const answers = plan.tasks.map((t): JudgeAnswers | null =>
    t.kind === 'mention'
      ? { refers: { type: 'noul', noul: 0.03 } }
      : t.kind === 'stale'
        ? { durability: { type: 'score', score: 1.9, confidence: 0.9 } }
        : null,
  )
  const out = applyJudgedClean(input, plan, answers)
  assert.deepEqual(out.fixes, [fill])
  assert.equal(out.judged.mentions_vetoed, 1)
  assert.equal(out.judged.stale_vetoed, 1)

  const silent = applyJudgedClean(input, plan, plan.tasks.map(() => null))
  assert.deepEqual(silent.fixes, [mention, stale, fill])
  assert.deepEqual(silent.issues, [])
})

test('a conflict names the newer note from the notes’ own times, and asks for supersedes on it', () => {
  const input = { raws: RAWS, metas, fixes: [] as AutoFix[], issues: [] as Issue[], inScope: everywhere }
  const plan = planJudgedClean(input)
  const answers = plan.tasks.map((): JudgeAnswers => ({ same: { type: 'score', score: 1.1, confidence: 0.7 }, conflict: { type: 'noul', noul: 0.92 } }))
  const out = applyJudgedClean(input, plan, answers)
  assert.equal(out.issues.length, 1)
  assert.equal(out.issues[0].kind, 'contradiction')
  assert.equal(out.issues[0].path, 'decisions/owner-b.md')
  assert.match(out.issues[0].detail, /supersedes: \/decisions\/owner-a\.md/)
})

test('a mechanical duplicate the judge calls different is dismissed; one it calls the same is confirmed', () => {
  const dup: Issue = { path: 'decisions/owner-a.md', kind: 'duplicate', other: 'decisions/owner-b.md', detail: 'possible duplicate of Acme account handover (0.70) — consider merging' }
  const input = { raws: RAWS, metas, fixes: [] as AutoFix[], issues: [dup], inScope: everywhere }
  const plan = planJudgedClean(input)
  const different = applyJudgedClean(input, plan, plan.tasks.map((): JudgeAnswers => ({ same: { type: 'score', score: 0.1, confidence: 0.9 }, conflict: { type: 'noul', noul: 0.1 } })))
  assert.deepEqual(different.issues, [])
  const same = applyJudgedClean(input, plan, plan.tasks.map((): JudgeAnswers => ({ same: { type: 'score', score: 1.9, confidence: 0.9 }, conflict: { type: 'noul', noul: 0.1 } })))
  assert.equal(same.issues.length, 1)
  assert.match(same.issues[0].detail, /by meaning/)
})

test('an ambiguous mention gets a suggested target only above the confidence floor', () => {
  const raws = [
    ...RAWS,
    note('people/craig/index.md', '---\ntitle: Craig\ntype: Person\ndescription: Investor at Northstar\n---\nInvestor.'),
    note('people/craig-2/index.md', '---\ntitle: Craig\ntype: Person\ndescription: Our plumber\n---\nPlumber.'),
    note('notes/round.md', '---\ntitle: Round\n---\nCraig confirmed Northstar will lead the seed round.'),
  ]
  const m = buildNoteIndex(raws)
  const issue: Issue = { path: 'notes/round.md', kind: 'unlinked-mention', detail: 'mentions "Craig" (ambiguous)' }
  const input = { raws, metas: m, fixes: [] as AutoFix[], issues: [issue], inScope: everywhere }
  const plan = planJudgedClean(input)
  const at = plan.tasks.findIndex((t) => t.kind === 'pick')
  assert.notEqual(at, -1)
  const sure = plan.tasks.map((_, i): JudgeAnswers | null => (i === at ? { which: { type: 'choice', choice: 'c0', probabilities: {}, confidence: 0.93 } } : null))
  const picked = applyJudgedClean(input, plan, sure).issues.find((i) => i.kind === 'unlinked-mention')
  assert.match(picked?.detail ?? '', /most likely Craig \(\/people\/craig/)
  const unsure = plan.tasks.map((_, i): JudgeAnswers | null => (i === at ? { which: { type: 'choice', choice: 'c0', probabilities: {}, confidence: 0.5 } } : null))
  assert.equal(applyJudgedClean(input, plan, unsure).issues.find((i) => i.kind === 'unlinked-mention')?.detail, issue.detail)
})
