/**
 * Folders of agents: a brief may sit anywhere under agents/ except live/,
 * keeps its leaf name as the agent's name, and the roster builds a tree from
 * the folders' index notes (lib/agents/config.ts, lib/notes/entities.ts,
 * features/agents/lib/tree.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-folders.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentBriefPath, agentFolderOfPath, agentFolderProblem, normaliseAgentFolder } from '@/lib/agents/config'
import { canonicalBriefOrder } from '@/lib/agents/briefs'
import { agentNameOfPath, entityKindOfPath, isAgentActivationPath, isAgentBriefPath, parseEntityHref } from '@/lib/notes/entities'
import { buildAgentTree, flattenAgentTree } from '@/features/agents/lib/tree'
import type { AgentFolder, AgentSummary } from '@/lib/agents/service'

test('a brief is any agents/**/<name>.md outside live/ and not an index', () => {
  assert.equal(isAgentBriefPath('agents/digest.md'), true)
  assert.equal(isAgentBriefPath('agents/ops/digest.md'), true)
  assert.equal(isAgentBriefPath('agents/ops/reports/digest.md'), true)
  assert.equal(isAgentBriefPath('agents/live/digest.md'), false)
  assert.equal(isAgentBriefPath('agents/ops/index.md'), false)
  assert.equal(isAgentBriefPath('agents/index.md'), false)
  assert.equal(isAgentBriefPath('people/digest.md'), false)
  assert.equal(isAgentActivationPath('agents/live/digest.md'), true)
  assert.equal(isAgentActivationPath('agents/live/ops/digest.md'), false)
})

test('the agent name is the leaf, wherever the brief sits', () => {
  assert.equal(agentNameOfPath('agents/digest.md'), 'digest')
  assert.equal(agentNameOfPath('agents/ops/reports/digest.md'), 'digest')
  assert.equal(agentNameOfPath('agents/live/digest.md'), 'digest')
  assert.equal(agentNameOfPath('agents/ops/index.md'), null)
  assert.equal(agentNameOfPath('agents/live/ops/digest.md'), null)
  assert.equal(agentFolderOfPath('agents/digest.md'), '')
  assert.equal(agentFolderOfPath('agents/ops/reports/digest.md'), 'ops/reports')
})

test('a nested brief is an agent entity; a folder of agents is not', () => {
  assert.equal(entityKindOfPath('agents/ops/digest.md'), 'agent')
  assert.equal(parseEntityHref('/agents/ops/digest.md'), 'agents/ops/digest.md')
  assert.equal(entityKindOfPath('agents/ops/index.md'), null)
  assert.equal(parseEntityHref('agents/live/digest.md'), null)
})

test('agentBriefPath places a new brief in its folder', () => {
  assert.equal(agentBriefPath('digest'), 'agents/digest.md')
  assert.equal(agentBriefPath('digest', ''), 'agents/digest.md')
  assert.equal(agentBriefPath('digest', 'ops'), 'agents/ops/digest.md')
  assert.equal(agentBriefPath('digest', '/agents/ops/reports/'), 'agents/ops/reports/digest.md')
  assert.equal(normaliseAgentFolder('agents'), null)
  assert.equal(normaliseAgentFolder(' agents/ops '), 'ops')
})

test('live/ and bad segments are refused as folders', () => {
  assert.equal(agentFolderProblem(''), null)
  assert.equal(agentFolderProblem('ops/reports'), null)
  assert.match(agentFolderProblem('live')!, /activations/)
  assert.match(agentFolderProblem('live/x')!, /activations/)
  assert.match(agentFolderProblem('Ops Reports')!, /not a folder name/)
})

test('the canonical brief among duplicates is the shallowest, then alphabetical', () => {
  const paths = ['agents/z/digest.md', 'agents/digest.md', 'agents/a/digest.md'].sort(canonicalBriefOrder)
  assert.deepEqual(paths, ['agents/digest.md', 'agents/a/digest.md', 'agents/z/digest.md'])
})

function agent(name: string, folder: string, rowState: AgentSummary['rowState'] = 'off'): AgentSummary {
  return {
    name,
    path: folder ? `agents/${folder}/${name}.md` : `agents/${name}.md`,
    folder,
    title: name,
    description: null,
    model: 'gemini/x',
    connectors: [],
    tools: [],
    invalid: null,
    authorUserId: null,
    activation: { active: rowState !== 'off', schedule: null, scheduleLabel: '', every: null, on: null, triggersLabel: null, debounceMs: 0, timezone: null, invalid: null },
    state: { status: rowState === 'running' ? 'running' : 'idle', nextRunAt: null, lastRunAt: null, runningSince: null, deactivatedReason: null, deactivatedDetail: null, consecutiveFailures: 0 },
    lastRun: null,
    keyStored: true,
    rowState,
    spend: null,
  }
}
const folder = (path: string, title = path): AgentFolder => ({ path, indexPath: `agents/${path}/index.md`, title, description: null })

test('buildAgentTree nests folders and agents, folders first, and rolls the loudest tone up', () => {
  const tree = buildAgentTree(
    [folder('ops', 'Ops'), folder('ops/reports', 'Reports'), folder('sales', 'Sales')],
    [agent('zed', ''), agent('digest', 'ops/reports', 'running'), agent('sync', 'ops'), agent('alpha', '')],
  )
  assert.deepEqual(
    tree.map((n) => (n.kind === 'folder' ? `F:${n.folder.path}` : `A:${n.agent.name}`)),
    ['F:ops', 'F:sales', 'A:alpha', 'A:zed'],
  )
  const ops = tree[0]
  assert.equal(ops.kind, 'folder')
  if (ops.kind !== 'folder') return
  assert.equal(ops.agentCount, 2)
  assert.equal(ops.tone, 'live', 'the running agent two levels down colours the top folder')
  assert.deepEqual(ops.children.map((n) => (n.kind === 'folder' ? `F:${n.folder.path}` : `A:${n.agent.name}`)), ['F:ops/reports', 'A:sync'])
  assert.equal(ops.children[0].depth, 1)
  assert.equal((ops.children[0] as { children: unknown[] }).children.length, 1)

  const all = flattenAgentTree(tree, new Set())
  assert.equal(all.length, 7)
  const folded = flattenAgentTree(tree, new Set(['ops']))
  assert.deepEqual(folded.map((n) => (n.kind === 'folder' ? n.folder.path : n.agent.name)), ['ops', 'sales', 'alpha', 'zed'])
})

test('an agent whose folder has no index still lands at the top rather than vanishing', () => {
  const tree = buildAgentTree([], [agent('lost', 'ghost')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'agent')
})
