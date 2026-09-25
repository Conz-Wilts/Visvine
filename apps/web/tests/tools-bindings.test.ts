/**
 * Bindings: a Tool names the KIND of thing it needs and each space binds its
 * own. The substitution, the checks a value must pass, what a space takes with
 * nobody choosing, the requirements an unbound slot adds, and the curated
 * dependencies a manifest may declare. Pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-bindings.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bindingChoices,
  bindingDenial,
  boundTypeClaims,
  defaultBindings,
  planBindings,
  planSettings,
  resolveReach,
  sourceBindings,
  type BindableSpace,
} from '@visvine/tool-protocol/bindings'
import { parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { CURATED_DEPENDENCIES, dependencyDenial, rangeAdmits } from '@visvine/tool-protocol/dependencies'
import { refuseRecordRead, refuseRecordWrite, refuseResourceRead } from '@visvine/tool-protocol/reach'
import { boundRequirements, describeRequirements, isDegraded } from '@/lib/tools/requirements'
import { installedVersion } from '@/lib/tools/vendorBundle'

function facts(raw: Record<string, unknown>): ToolManifestFacts {
  const parsed = parseManifestFacts({ manifestVersion: 2, ...raw })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.value
}

const CRM = facts({
  bindings: {
    deals: { kind: 'folder', label: 'Deal notes', suggest: 'deals' },
    deal: { kind: 'type', label: 'Deal type', suggest: 'Deal', fields: ['stage'] },
    crm: { kind: 'connector', label: 'CRM', recipe: 'hubspot', optional: true },
    digest: { kind: 'agent', label: 'Digest', optional: true },
  },
  permissions: {
    context: { read: ['$deals/**'], write: ['$deals/**'] },
    records: { read: ['$deal'], write: [{ type: '$deal', fields: ['stage'] }] },
    connectors: [{ use: '$crm', actions: ['search_deals'] }],
    agents: ['$digest'],
  },
  settings: { currency: { type: 'string', label: 'Currency', enum: ['USD', 'EUR'], default: 'USD' } },
})

/** A space that files deals elsewhere and calls its type something else. */
const SALES: BindableSpace = {
  folders: ['sales', 'sales/pipeline', 'people'],
  types: { Opportunity: ['stage', 'amount'], Person: ['email'] },
  connectors: [{ name: 'hubspot-2', recipe: 'hubspot' }, { name: 'gmail', recipe: 'gmail' }],
  agents: ['nightly'],
}

test('the bound reach is concrete: each $slot is this space\'s folder, type, connector', () => {
  const { reach, unbound } = resolveReach(CRM, { deals: 'sales/pipeline', deal: 'Opportunity', crm: 'hubspot-2' })
  assert.deepEqual(reach.read, ['sales/pipeline/**'])
  assert.deepEqual(reach.write, ['sales/pipeline/**'])
  assert.deepEqual(reach.records.read, ['Opportunity'])
  assert.deepEqual(reach.records.write, [{ type: 'Opportunity', fields: ['stage'] }])
  assert.deepEqual(reach.connectors, ['hubspot-2'])
  assert.deepEqual(reach.connectorActions, { 'hubspot-2': ['search_deals'] })
  assert.deepEqual(unbound, ['digest'])
  assert.equal(refuseRecordRead(reach, 'opportunity'), null)
  assert.ok(refuseRecordRead(reach, 'Deal'), 'the source space\'s name means nothing here')
  assert.ok(refuseRecordWrite(reach, 'Opportunity', ['amount']))
})

test('an unbound slot drops the reach it would have granted, and the Tool is degraded by its label', () => {
  const { reach, unbound } = resolveReach(CRM, { deal: 'Opportunity' })
  assert.deepEqual(reach.read, [])
  assert.deepEqual(unbound, ['crm', 'deals', 'digest'])
  const requirements = boundRequirements(CRM, { deal: 'Opportunity' }, { connectors: [], types: ['opportunity'], agents: [] })
  assert.ok(isDegraded(requirements))
  assert.deepEqual(requirements.bindings, ['CRM', 'Deal notes', 'Digest'])
  assert.ok(describeRequirements(requirements).includes('Deal notes is not bound'))
})

test('in the space that wrote it, every slot is its own suggestion', () => {
  assert.deepEqual(sourceBindings(CRM), { deals: 'deals', deal: 'Deal' })
})

test('a value must fit: a folder of the space\'s own, a type with the fields, a connector of the recipe', () => {
  const slot = CRM.bindings
  assert.equal(bindingDenial(slot.deals, 'sales/pipeline', SALES), null)
  assert.equal(bindingDenial(slot.deals, 'brand-new', SALES), null, 'a folder a Tool\'s first write makes is fine')
  assert.match(bindingDenial(slot.deals, 'connectors', SALES) ?? '', /holds what runs/)
  assert.match(bindingDenial(slot.deals, 'tools/x', SALES) ?? '', /holds what runs/)
  assert.match(bindingDenial(slot.deals, '../etc', SALES) ?? '', /not a folder path/)
  assert.equal(bindingDenial(slot.deal, 'opportunity', SALES), null)
  assert.match(bindingDenial(slot.deal, 'Person', SALES) ?? '', /no stage field/)
  assert.match(bindingDenial(slot.deal, 'Invoice', SALES) ?? '', /no type Invoice/)
  assert.equal(bindingDenial(slot.crm, 'HubSpot-2', SALES), null)
  assert.match(bindingDenial(slot.crm, 'gmail', SALES) ?? '', /must be a hubspot connector/)
  assert.equal(bindingDenial(slot.crm, '', SALES), null, 'an optional slot may stay empty')
  assert.match(bindingDenial(slot.deals, '', SALES) ?? '', /cannot be left unbound/)
})

test('planBindings checks what is asked, spells it as the space does, and defaults the rest', () => {
  const planned = planBindings(CRM, { deals: '/sales/pipeline/', deal: 'opportunity' }, SALES)
  assert.ok(planned.ok)
  assert.deepEqual(planned.ok && planned.value, { deals: 'sales/pipeline', deal: 'Opportunity' })
  assert.equal(planBindings(CRM, { nope: 'x' }, SALES).ok, false)
  assert.equal(planBindings(CRM, { deal: 'Invoice' }, SALES).ok, false)
  const kept = planBindings(CRM, { crm: '' }, SALES, { deals: 'sales', crm: 'hubspot-2' })
  assert.deepEqual(kept.ok && kept.value, { deals: 'sales' }, 'an empty value clears an optional slot; the rest keep theirs')
})

test('defaultBindings takes a suggestion only when the space has that thing', () => {
  const here: BindableSpace = { folders: [], types: { Deal: ['stage'] }, connectors: [], agents: [] }
  assert.deepEqual(defaultBindings(CRM, here), { deals: 'deals', deal: 'Deal' })
  assert.deepEqual(defaultBindings(CRM, SALES), { deals: 'deals' }, 'no Deal type in SALES — left unbound')
  assert.deepEqual(defaultBindings(CRM, SALES, { deal: 'Opportunity' }), { deals: 'deals', deal: 'Opportunity' })
})

test('the picker offers what fits the slot', () => {
  assert.deepEqual(bindingChoices(CRM.bindings.crm, SALES), ['hubspot-2'])
  assert.deepEqual(bindingChoices(CRM.bindings.deal, SALES), ['Opportunity'])
  assert.ok(bindingChoices(CRM.bindings.deals, SALES).includes('sales/pipeline'))
})

test('a $type claim follows the slot; an unbound one claims nothing', () => {
  const claims = [{ type: '$deal', mode: 'page' as const }, { type: 'person', mode: 'tab' as const }]
  assert.deepEqual(boundTypeClaims(claims, CRM, { deal: 'Opportunity' }), [
    { type: 'Opportunity', mode: 'page' },
    { type: 'person', mode: 'tab' },
  ])
  assert.deepEqual(boundTypeClaims(claims, CRM, {}), [{ type: 'person', mode: 'tab' }])
})

test('settings are checked against their spec; an unset one keeps its default', () => {
  assert.deepEqual(planSettings(CRM, {}), { ok: true, value: {} })
  assert.deepEqual(planSettings(CRM, { currency: 'EUR' }), { ok: true, value: { currency: 'EUR' } })
  assert.equal(planSettings(CRM, { currency: 'JPY' }).ok, false)
  assert.equal(planSettings(CRM, { colour: 'red' }).ok, false)
})

test('a file is read by its place under resources/', () => {
  const { reach } = resolveReach(facts({ permissions: { resources: { read: ['resources/contracts/**'] } } }), {})
  assert.equal(refuseResourceRead(reach, 'resources/contracts/nda/index.md'), null)
  assert.ok(refuseResourceRead(reach, 'resources/design/logo/index.md'))
  assert.ok(refuseResourceRead(reach, null))
})

test('ranges: the grammar a manifest needs', () => {
  assert.ok(rangeAdmits('^4', '4.3.6'))
  assert.ok(rangeAdmits('^4.1.0', '4.3.6'))
  assert.ok(!rangeAdmits('^4.4.0', '4.3.6'))
  assert.ok(!rangeAdmits('^3', '4.3.6'))
  assert.ok(rangeAdmits('~4.3', '4.3.6'))
  assert.ok(!rangeAdmits('~4.2', '4.3.6'))
  assert.ok(rangeAdmits('4.x', '4.1.0'))
  assert.ok(rangeAdmits('>=4.0.0', '4.1.0'))
  assert.ok(rangeAdmits('^0.3.1', '0.3.9') && !rangeAdmits('^0.3.1', '0.4.0'))
  assert.ok(rangeAdmits('^3 || ^4', '4.1.0'))
  assert.ok(rangeAdmits('*', '1.0.0'))
})

test('a dependency is one the server serves, at a version it serves', () => {
  assert.equal(dependencyDenial('zod', '^4'), null)
  assert.match(dependencyDenial('lodash', '^4') ?? '', /not a module tools may import/)
  assert.match(dependencyDenial('zod', '^3') ?? '', /serves zod/)
})

test('the curated table is the version on disk — what the vendor build serves', () => {
  for (const [name, dep] of Object.entries(CURATED_DEPENDENCIES)) {
    assert.equal(installedVersion(name), dep.version, `${name} on disk`)
  }
})
