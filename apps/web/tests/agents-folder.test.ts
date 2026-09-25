/**
 * An agent is a folder (lib/agents/config.ts, lib/notes/entities.ts):
 * `agents/<name>/index.md` is the brief, `agents/<name>/activation.md` the
 * admin-only activation, and anything else in the folder is the agent's own —
 * the one place under agents/ its runs may write.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-folder.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentActivationPath, agentBriefAliasPath, agentBriefPath, agentFolderPath, globProblem, newAgentNote, parseAgentBrief } from '@/lib/agents/config'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import {
  agentNameOfPath,
  agentOfPath,
  agentOfRevisionStamp,
  canonicalEntityPath,
  entityKindOfPath,
  entityNotePath,
  entityNotePaths,
  entityOwnerPathOf,
  isAgentActivationPath,
  isAgentBriefPath,
  isAgentOwnNotePath,
  isFolderOnlyEntityKind,
  parseEntityHref,
} from '@/lib/notes/entities'

test('the three notes of an agent folder are told apart by path alone', () => {
  assert.equal(isAgentBriefPath('agents/digest/index.md'), true)
  assert.equal(isAgentBriefPath('agents/digest/activation.md'), false)
  assert.equal(isAgentBriefPath('agents/digest/report.md'), false)
  assert.equal(isAgentBriefPath('agents/digest.md'), false, 'the flat form is an alias, not a brief')
  assert.equal(isAgentBriefPath('agents/index.md'), false, "the namespace's own home page")
  assert.equal(isAgentBriefPath('people/digest/index.md'), false)

  assert.equal(isAgentActivationPath('agents/digest/activation.md'), true)
  assert.equal(isAgentActivationPath('agents/digest/index.md'), false)
  assert.equal(isAgentActivationPath('agents/live/digest.md'), false)

  assert.equal(isAgentOwnNotePath('agents/digest/report.md', 'digest'), true)
  assert.equal(isAgentOwnNotePath('agents/digest/2026-01-31.md', 'digest'), true)
  assert.equal(isAgentOwnNotePath('agents/digest/index.md', 'digest'), false)
  assert.equal(isAgentOwnNotePath('agents/digest/activation.md', 'digest'), false)
  assert.equal(isAgentOwnNotePath('agents/digest/report.md', 'other'), false)
  assert.equal(isAgentOwnNotePath('agents/digest/deep/report.md', 'digest'), false, 'no sub-folders of its own')
})

test('the name is the folder segment', () => {
  assert.equal(agentNameOfPath('agents/digest/index.md'), 'digest')
  assert.equal(agentNameOfPath('agents/digest/activation.md'), 'digest')
  assert.equal(agentNameOfPath('agents/digest/report.md'), null, 'an own note names no agent — it belongs to one')
  assert.equal(agentOfPath('agents/digest/report.md'), 'digest')
  assert.equal(agentNameOfPath('agents/index.md'), null)
  assert.equal(agentNameOfPath('agents/digest.md'), null)
})

test('paths are derived from the name, and the flat form is only an alias', () => {
  assert.equal(agentFolderPath('digest'), 'agents/digest')
  assert.equal(agentBriefPath('digest'), 'agents/digest/index.md')
  assert.equal(agentActivationPath('digest'), 'agents/digest/activation.md')
  assert.equal(agentBriefAliasPath('digest'), 'agents/digest.md')
  assert.equal(canonicalEntityPath('agents/digest.md'), 'agents/digest/index.md')
})

test('an agent is a folder-only entity with a flat alias, like a person', () => {
  const node = { id: 'agent:digest', type: 'agent' }
  assert.equal(isFolderOnlyEntityKind('agent'), true)
  assert.equal(entityNotePath(node), 'agents/digest/index.md')
  assert.deepEqual(entityNotePaths(node), ['agents/digest.md', 'agents/digest/index.md'])
  assert.equal(entityKindOfPath('agents/digest/index.md'), 'agent')
  assert.equal(entityKindOfPath('agents/digest.md'), 'agent')
  assert.equal(entityKindOfPath('agents/digest/activation.md'), null, 'the activation is a sub-note, never an entity')
  assert.equal(entityKindOfPath('agents/digest/report.md'), null)
  assert.equal(parseEntityHref('/agents/digest/index.md'), 'agents/digest/index.md')
  assert.equal(parseEntityHref('agents/index.md'), null)
  assert.equal(entityOwnerPathOf('agents/digest/activation.md'), 'agents/digest')
  assert.equal(entityOwnerPathOf('agents/digest/report.md'), 'agents/digest')
})

test('the revision stamp names the agent whose run wrote', () => {
  assert.equal(agentOfRevisionStamp('agent', 'agent:digest'), 'digest')
  assert.equal(agentOfRevisionStamp('agent', 'mcp'), null)
  assert.equal(agentOfRevisionStamp('edit', 'agent:digest'), null)
  assert.equal(agentOfRevisionStamp('agent', 'agent:'), null)
  assert.equal(agentOfRevisionStamp(undefined, undefined), null)
})

test('no trigger glob can reach into an agent folder', () => {
  assert.equal(globProblem('people/**'), null)
  assert.match(globProblem('agents/**')!, /agents\//)
  assert.match(globProblem('**/report.md')!, /agents\//, 'an own note is under agents/ too')
  assert.match(globProblem('**/activation.md')!, /agents\//)
  assert.match(globProblem('**')!, /agents\//)
})

test('a new brief names its own folder as the default place to write', () => {
  const note = newAgentNote({ name: 'digest', title: 'Digest' })
  const parsed = parseAgentBrief(parseFrontmatter(note), splitFrontmatter(note).body)
  assert.equal(parsed.ok, true)
  assert.match(note, /agents\/digest\//)
  assert.match(note, /## Write to/)
})

test('an agent sits in agents/<name> or a folder of the space’s own, named by its folder', async () => {
  const { agentFolderDenial, briefFolderOf, agentFileIn, agentFolderOfBrief, ancestorFolders } = await import('../lib/agents/shared/folder')
  assert.equal(agentFolderDenial('agents/digest'), null)
  assert.equal(agentFolderDenial('teams/growth/digest'), null)
  assert.match(agentFolderDenial('agents/team/digest') ?? '', /agents\/<name>/)
  assert.match(agentFolderDenial('people/ana/digest') ?? '', /built-in folders/)
  assert.match(agentFolderDenial('subspaces/x/digest') ?? '', /space that owns it/)
  assert.match(agentFolderDenial('teams/Digest Bot') ?? '', /folder name is its name/)
  const brief = '---\ntype: agent\ntitle: Digest\n---\nBody.\n'
  assert.equal(briefFolderOf('teams/growth/digest/index.md', brief), 'teams/growth/digest')
  assert.equal(briefFolderOf('teams/growth/digest/index.md', '---\ntitle: Digest\n---\n'), null, 'a folder of the space’s own is an agent only by declaring it')
  assert.equal(briefFolderOf('agents/digest/index.md', '---\ntitle: Digest\n---\n'), 'agents/digest', 'under agents/ the path is enough')
  assert.equal(briefFolderOf('teams/growth/digest/notes.md', brief), null)
  assert.equal(agentFileIn('teams/growth/digest', 'teams/growth/digest/index.md'), 'brief')
  assert.equal(agentFileIn('teams/growth/digest', 'teams/growth/digest/memory.md'), 'own')
  assert.equal(agentFileIn('teams/growth/digest', 'teams/growth/digest/skills/a/index.md'), null)
  assert.equal(agentFolderOfBrief('agents/digest.md', 'digest'), 'agents/digest')
  assert.deepEqual(ancestorFolders('a/b/c.md'), ['a/b', 'a'])
})
