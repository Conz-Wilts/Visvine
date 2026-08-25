/**
 * Folders of agents: a brief may sit anywhere under agents/ except live/ and
 * keeps its leaf name as the agent's name (lib/agents/config.ts,
 * lib/notes/entities.ts). The folders themselves are ordinary Context
 * folders, browsed in the tree.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-folders.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentBriefPath, agentFolderOfPath, agentFolderProblem, normaliseAgentFolder } from '@/lib/agents/config'
import { canonicalBriefOrder } from '@/lib/agents/briefs'
import { agentNameOfPath, entityKindOfPath, isAgentActivationPath, isAgentBriefPath, parseEntityHref } from '@/lib/notes/entities'

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
