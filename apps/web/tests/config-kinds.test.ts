/**
 * A connector is what a note DECLARES, not where it was filed
 * (lib/notes/shared/configKinds.ts): the pure half of the gate that follows
 * the declaration, the shape rule for where a connector may sit, and the two
 * readers that hang off it — the tree's `declares` stamp and the house's
 * share-down flag.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configKindOfContent,
  configKindWriteDenial,
  connectorHomeDenial,
  connectorNameOfPath,
  declaredConfigKind,
  isConnectorNoteAt,
} from '../lib/notes/shared/configKinds'
import { buildNoteIndex, buildTree } from '../lib/notes/shared/context'
import { isSharedDown } from '../lib/spaces/subspaces'

const CONNECTOR = `---\ntype: connector\ntitle: HubSpot\nhosts:\n  - api.hubapi.com\n---\n\nCall it.\n`

test('the declaration decides the kind, the legacy model shape included', () => {
  assert.equal(declaredConfigKind({ type: 'connector' }), 'connector')
  assert.equal(declaredConfigKind({ type: 'Connector' }), 'connector')
  assert.equal(declaredConfigKind({ type: 'model' }), 'model')
  assert.equal(declaredConfigKind({ type: 'connector', kind: 'model' }), 'model')
  assert.equal(declaredConfigKind({ type: 'Person' }), null)
  assert.equal(declaredConfigKind(null), null)
  assert.equal(configKindOfContent(CONNECTOR), 'connector')
  assert.equal(configKindOfContent('# Just prose mentioning type: connector\n'), null)
  assert.equal(configKindOfContent(null), null)
  assert.match(configKindWriteDenial('connector'), /Only space admins/)
  assert.match(configKindWriteDenial('model'), /models/)
})

test('a connector is named by its file, wherever the file is', () => {
  assert.equal(connectorNameOfPath('connectors/hubspot.md'), 'hubspot')
  assert.equal(connectorNameOfPath('teams/growth/hubspot.md'), 'hubspot')
  assert.equal(connectorNameOfPath('teams/growth/index.md'), null)
  assert.equal(connectorNameOfPath('teams/growth/notes.txt'), null)
  assert.equal(connectorNameOfPath('teams/growth/bad name!.md'), null)
})

test('a connector sits in connectors/ or a folder of the space’s own — nowhere else', () => {
  assert.equal(connectorHomeDenial('connectors/hubspot.md'), null)
  assert.equal(connectorHomeDenial('teams/growth/hubspot.md'), null)
  assert.equal(connectorHomeDenial('hubspot.md'), null)
  assert.match(connectorHomeDenial('connectors/growth/hubspot.md')!, /connectors\/<name>\.md/)
  assert.match(connectorHomeDenial('people/craig/hubspot.md')!, /built-in folders/)
  assert.match(connectorHomeDenial('agents/scout/hubspot.md')!, /built-in folders/)
  assert.match(connectorHomeDenial('subspaces/design/hubspot.md')!, /space that owns it/)
  assert.match(connectorHomeDenial('parent/connectors/hubspot.md')!, /space that owns it/)
  assert.match(connectorHomeDenial('teams/growth/index.md')!, /not a folder/)
  assert.match(connectorHomeDenial('teams/growth/HubSpot Prod!.md')!, /file name is its name/)
  assert.equal(isConnectorNoteAt('teams/growth/hubspot.md', CONNECTOR), true)
  assert.equal(isConnectorNoteAt('people/craig/hubspot.md', CONNECTOR), false)
  assert.equal(isConnectorNoteAt('teams/growth/hubspot.md', '---\ntype: Note\n---\n'), false)
})

test('the tree stamps what a note declares so the sidebar can move it as one', () => {
  const metas = buildNoteIndex([
    { path: 'teams/growth/hubspot.md', content: CONNECTOR, mtime: 1 },
    { path: 'teams/growth/plan.md', content: '---\ntitle: Plan\n---\n\nHi\n', mtime: 1 },
  ])
  const tree = buildTree(metas)
  const growth = tree.children![0].children![0]
  const byPath = new Map(growth.children!.map((c) => [c.path, c]))
  assert.equal(byPath.get('teams/growth/hubspot.md')?.declares, 'connector')
  assert.equal(byPath.get('teams/growth/plan.md')?.declares, undefined)
})

test('the house shares a connector down by what it declares, not by its folder', () => {
  const fm = { type: 'connector', share: 'all' }
  assert.equal(isSharedDown('connectors/hubspot.md', fm, 'design'), true)
  assert.equal(isSharedDown('teams/growth/hubspot.md', fm, 'design'), true)
  assert.equal(isSharedDown('teams/growth/plan.md', { share: 'all' }, 'design'), false)
  assert.equal(isSharedDown('people/craig/hubspot.md', fm, 'design'), false)
  assert.equal(isSharedDown('teams/growth/hubspot.md', { type: 'connector' }, 'design'), false)
})
