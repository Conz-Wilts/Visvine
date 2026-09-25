/**
 * The version diff sees every field that grants or places — and so a trusted
 * publisher can never widen a Tool without a person reading it.
 *
 * `shouldAutoApprove` lists a trusted publisher's new version unread when the
 * manifest diff (`lib/tools/manifestDiff.ts`) is empty. Whatever that diff
 * cannot see is therefore unreviewed reach. This suite parses the fullest
 * manifest the parser knows, walks EVERY key it produces, and fails when one is
 * neither reviewed nor named descriptive — so a new field (permissions,
 * bindings, collections) cannot land without deciding which it is. Then it
 * widens each reviewed field alone and proves the fast path refuses it.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-diff-coverage.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseToolConfig, type ToolConfig } from '@/lib/tools/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { DESCRIPTIVE_FIELDS, diffManifest, REVIEWED_FIELDS, type ReviewedField } from '@/lib/tools/manifestDiff'
import { shouldAutoApprove } from '@/lib/tools/registry'

/** Every key the parser knows, set. */
const FULLEST = [
  '---',
  'type: tool',
  'title: Deals',
  'description: Deals by stage',
  'version: 3',
  'tags: [crm]',
  'preview: /api/media/abc.png',
  'surfaces:',
  '  rail: { label: Deals, icon: kanban }',
  '  types: [{ type: deal, mode: page }]',
  '  nav:',
  '    style: tabs',
  '    sections: [{ id: board, label: Board }]',
  '  actions: [{ id: new-deal, label: New deal }]',
  'perimeter:',
  '  read: ["deals/**"]',
  '  write: ["deals/**"]',
  '  types: [deal]',
  '  connectors: [hubspot]',
  '  agents: [deal-digest]',
  '---',
  '',
].join('\n')

function fullest(): ToolConfig {
  const parsed = parseToolConfig(parseFrontmatter(FULLEST), 'deals')
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.config
}

/** One widening per reviewed field — each a change a reviewer must read. */
const WIDEN: Record<ReviewedField, (c: ToolConfig) => ToolConfig> = {
  'perimeter.read': (c) => ({ ...c, perimeter: { ...c.perimeter, read: [...c.perimeter.read, '**'] } }),
  'perimeter.write': (c) => ({ ...c, perimeter: { ...c.perimeter, write: [...c.perimeter.write, 'people/**'] } }),
  'perimeter.types': (c) => ({ ...c, perimeter: { ...c.perimeter, types: [...c.perimeter.types, 'person'] } }),
  'perimeter.connectors': (c) => ({ ...c, perimeter: { ...c.perimeter, connectors: [...c.perimeter.connectors, 'slack'] } }),
  'perimeter.agents': (c) => ({ ...c, perimeter: { ...c.perimeter, agents: ['*'] } }),
  'surfaces.rail': (c) => ({ ...c, surfaces: { ...c.surfaces, rail: { label: 'Deals', icon: 'sparkle' } } }),
  'surfaces.types': (c) => ({ ...c, surfaces: { ...c.surfaces, types: [...c.surfaces.types, { type: 'person', mode: 'tab' }] } }),
  'surfaces.nav': (c) => ({
    ...c,
    surfaces: { ...c.surfaces, nav: { style: 'tabs', sections: [...(c.surfaces.nav?.sections ?? []), { id: 'admin', label: 'Admin' }] } },
  }),
  'surfaces.actions': (c) => ({ ...c, surfaces: { ...c.surfaces, actions: [...(c.surfaces.actions ?? []), { id: 'export', label: 'Export' }] } }),
}

test('every key a manifest carries is reviewed or named descriptive', () => {
  const config = fullest()
  const reviewed = new Set<string>(Object.keys(REVIEWED_FIELDS))
  const descriptive = new Set<string>(DESCRIPTIVE_FIELDS)
  const unclassified: string[] = []
  for (const [key, value] of Object.entries(config)) {
    if (descriptive.has(key)) continue
    // A container of reviewed fields: each of its keys must be reviewed itself.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) {
        if (!reviewed.has(`${key}.${inner}`)) unclassified.push(`${key}.${inner}`)
      }
      continue
    }
    unclassified.push(key)
  }
  assert.deepEqual(
    unclassified,
    [],
    'A manifest field is neither in manifestDiff.ts#REVIEWED_FIELDS nor DESCRIPTIVE_FIELDS. ' +
      'If it grants reach or places UI, review it — the trusted-publisher fast path lists whatever the diff does not see.',
  )
})

test('every reviewed field exists on a parsed manifest — none is reviewing nothing', () => {
  const config = fullest() as unknown as Record<string, Record<string, unknown>>
  for (const field of Object.keys(REVIEWED_FIELDS)) {
    const [container, key] = field.split('.')
    assert.ok(key in (config[container] ?? {}), `${field} is reviewed but the parser never produces it`)
  }
})

test('widening any reviewed field alone shows in the diff, and only that field', () => {
  const base = fullest()
  for (const [field, widen] of Object.entries(WIDEN) as Array<[ReviewedField, (c: ToolConfig) => ToolConfig]>) {
    assert.deepEqual(diffManifest(base, widen(base)), [field], field)
  }
  // Every reviewed field has a widening here, so none is left untested.
  assert.deepEqual(Object.keys(WIDEN).sort(), Object.keys(REVIEWED_FIELDS).sort())
})

test("a trusted publisher's widened reach or placement is never auto-approved", () => {
  const base = fullest()
  const trusted = new Set(['space_trusted'])
  const approve = (next: ToolConfig) =>
    shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_trusted', previous: base, next, securityFindings: [] })
  // The control: nothing granting changed, so the fast path applies.
  assert.equal(approve({ ...base, version: 4, description: 'New copy', title: 'Deal board', tags: ['sales'] }), true)
  for (const [field, widen] of Object.entries(WIDEN) as Array<[ReviewedField, (c: ToolConfig) => ToolConfig]>) {
    assert.equal(approve(widen(base)), false, `${field} widened and was auto-approved`)
  }
})

test('narrowing is a change too — a reviewer sees every edit to what was approved', () => {
  const base = fullest()
  assert.deepEqual(diffManifest(base, { ...base, perimeter: { ...base.perimeter, connectors: [] } }), ['perimeter.connectors'])
  assert.deepEqual(diffManifest(base, { ...base, surfaces: { ...base.surfaces, nav: null } }), ['surfaces.nav'])
  // Order that means nothing is not a change.
  assert.deepEqual(
    diffManifest(
      { ...base, perimeter: { ...base.perimeter, read: ['a/**', 'b/**'] } },
      { ...base, perimeter: { ...base.perimeter, read: ['b/**', 'a/**'] } },
    ),
    [],
  )
})
