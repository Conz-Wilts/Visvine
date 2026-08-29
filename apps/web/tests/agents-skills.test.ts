// What an agent has been taught: reading a skill note, choosing which ones a
// request calls for, and the rules that stop a skill claiming more than advice.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-skills.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSkill,
  parseSkillPath,
  selectSkills,
  skillIndexPath,
  slugify,
  statusOnPublish,
  unmetReach,
  type SkillDoc,
} from '@/lib/agents/shared/skills'

function skill(over: Partial<SkillDoc> & { slug: string }): SkillDoc {
  return {
    path: skillIndexPath('digest', over.slug),
    agent: 'digest',
    title: over.slug,
    description: '',
    status: 'approved',
    keywords: [],
    hosts: [],
    actions: [],
    imageDigest: null,
    taughtBy: null,
    taughtInRun: null,
    ...over,
  }
}

test('a skill is a folder under its agent, and only that shape', () => {
  assert.deepEqual(parseSkillPath('agents/digest/skills/file-expenses/index.md'), {
    agent: 'digest',
    slug: 'file-expenses',
  })
  for (const path of [
    'agents/digest/skills/file-expenses/steps.md',
    'agents/digest/skills/index.md',
    'agents/digest/index.md',
    'skills/file-expenses/index.md',
    'agents/digest/skills/File Expenses/index.md',
    'agents/digest/skills/../../../etc/index.md',
  ]) {
    assert.equal(parseSkillPath(path), null, path)
  }
})

test('slugs are deterministic, so teaching the same thing twice collides rather than duplicates', () => {
  assert.equal(slugify('File the expense report'), 'file-the-expense-report')
  assert.equal(slugify('File the expense report'), slugify('file  the EXPENSE report!'))
  assert.equal(slugify('???'), 'skill')
})

test('a skill note is read leniently and a malformed one simply is not selected', () => {
  const doc = parseSkill('agents/digest/skills/file-expenses/index.md', {
    title: 'File expenses',
    description: 'Turn a receipt into an expense line',
    status: 'approved',
    keywords: ['expense report', 'receipt'],
    hosts: ['api.example.com'],
    actions: ['edit_context'],
    image_digest: 'sha256:abc',
    taught_by: 'user_1',
    taught_in_run: 'run_1',
  })
  assert.ok(doc)
  assert.equal(doc?.status, 'approved')
  assert.deepEqual(doc?.keywords[0], { all: ['expense', 'report'], score: 2 })

  // Junk in every field, and the note still reads as a draft skill rather than throwing.
  const junk = parseSkill('agents/digest/skills/x/index.md', {
    status: 'nonsense',
    keywords: 'not a list',
    hosts: [1, 2, 3],
    actions: null,
  } as never)
  assert.equal(junk?.status, 'draft')
  assert.deepEqual([...(junk?.keywords ?? [])], [])
  assert.deepEqual([...(junk?.hosts ?? [])], [])
})

test('selection needs every word of a phrase, and prefers the more specific one', () => {
  const skills = [
    skill({ slug: 'file-expenses', keywords: [{ all: ['expense', 'report'], score: 2 }] }),
    skill({ slug: 'write-report', keywords: [{ all: ['report'], score: 1 }] }),
  ]
  const chosen = selectSkills('file the expense report for March', skills)
  assert.deepEqual(chosen.map((s) => s.slug), ['file-expenses', 'write-report'])

  // "report" alone must not pull in the expense skill.
  assert.deepEqual(selectSkills('write the weekly report', skills).map((s) => s.slug), ['write-report'])
  assert.deepEqual(selectSkills('book a flight', skills), [])
})

test('only approved skills are put in front of an agent', () => {
  const keywords = [{ all: ['expense'], score: 1 }]
  const skills = [
    skill({ slug: 'draft-one', status: 'draft', keywords }),
    skill({ slug: 'pending-one', status: 'pending', keywords }),
    skill({ slug: 'retired-one', status: 'retired', keywords }),
    skill({ slug: 'approved-one', status: 'approved', keywords }),
  ]
  assert.deepEqual(selectSkills('an expense', skills).map((s) => s.slug), ['approved-one'])
})

test("publishing follows the Tools rule: an admin approves by publishing, a member waits", () => {
  assert.equal(statusOnPublish(true), 'approved')
  assert.equal(statusOnPublish(false), 'pending')
})

test('an approver is shown the reach the skill claims but the space does not permit', () => {
  const doc = skill({
    slug: 'file-expenses',
    hosts: ['api.example.com', 'api.stripe.com'],
    actions: ['edit_context', 'send_invoice'],
  })
  assert.deepEqual(unmetReach(doc, ['api.example.com'], ['edit_context']), {
    hosts: ['api.stripe.com'],
    actions: ['send_invoice'],
  })
  // Nothing unmet is the ordinary case, and reads as such.
  assert.deepEqual(unmetReach(doc, ['api.example.com', 'api.stripe.com'], ['edit_context', 'send_invoice']), {
    hosts: [],
    actions: [],
  })
})
