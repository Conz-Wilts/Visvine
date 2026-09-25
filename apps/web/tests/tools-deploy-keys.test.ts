/**
 * Deploy keys and pushing from files: the key's shape and its narrow reach,
 * enforced in `runAction` before any action body; and `checkPackage`, which
 * builds a package exactly as a working copy is built, writing nothing.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-deploy-keys.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEPLOY_KEY_PREFIX,
  deployKeyDenial,
  deployKeyHash,
  deployKeyLabel,
  deployKeyPrefix,
  isDeployKey,
  newDeployKey,
} from '@/lib/tools/shared/deployKeys'
import { runAction } from '@/lib/actions/run'
import { ActionError, type ActionCaller } from '@/lib/actions/types'
import { checkPackage } from '@/lib/tools/package'
import { checksumsText, encodePackage, fileDigests, PACKAGE_CHECKSUMS } from '@/lib/tools/package/shared/layout'

const KEY = { spaceId: 'space-1', tool: 'poll' }

test('a key is vvtk_ and 43 characters of randomness, stored as its hash', () => {
  const key = newDeployKey()
  assert.ok(key.startsWith(DEPLOY_KEY_PREFIX))
  assert.equal(key.length, DEPLOY_KEY_PREFIX.length + 43)
  assert.ok(isDeployKey(key))
  assert.notEqual(newDeployKey(), key)
  assert.equal(deployKeyHash(key), deployKeyHash(key))
  assert.match(deployKeyHash(key), /^[0-9a-f]{64}$/)
  assert.equal(deployKeyPrefix(key), key.slice(0, 13))
  for (const other of ['vvtk_', 'vvtk_short', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', `vvtk_${'a'.repeat(30)}!`, '']) {
    assert.equal(isDeployKey(other), false, other)
  }
})

test('a label is one line of at most 40 characters, "Deploy key" when blank', () => {
  assert.deepEqual(deployKeyLabel('  GitHub   Actions '), { ok: true, label: 'GitHub Actions' })
  assert.deepEqual(deployKeyLabel(''), { ok: true, label: 'Deploy key' })
  assert.deepEqual(deployKeyLabel(undefined), { ok: true, label: 'Deploy key' })
  assert.equal(deployKeyLabel('x'.repeat(41)).ok, false)
})

test('a key asks only its own Tool’s actions, in its own space', () => {
  assert.equal(deployKeyDenial(KEY, 'push_tool', { space_id: 'space-1', name: 'poll', content_base64: '' }), null)
  assert.equal(deployKeyDenial(KEY, 'publish_tool', { space_id: 'space-1', name: 'poll' }), null)
  assert.equal(deployKeyDenial(KEY, 'check_tool', { space_id: 'space-1', name: 'poll' }), null)
  assert.equal(deployKeyDenial(KEY, 'check_package', { space_id: 'space-1', content_base64: '' }), null)
  assert.match(deployKeyDenial(KEY, 'push_tool', { space_id: 'space-1', name: 'board' }) ?? '', /for the tool poll/)
  assert.match(deployKeyDenial(KEY, 'push_tool', { space_id: 'space-1' }) ?? '', /for the tool poll/)
  assert.match(deployKeyDenial(KEY, 'publish_tool', { space_id: 'space-2', name: 'poll' }) ?? '', /another space/)
  assert.match(deployKeyDenial(KEY, 'check_package', { content_base64: '' }) ?? '', /another space/)
  for (const action of ['write_tool', 'create_tool', 'install_tool', 'edit_context', 'read_context', 'submit_tool', 'export_tool', 'list_spaces']) {
    assert.match(deployKeyDenial(KEY, action, { space_id: 'space-1', name: 'poll' }) ?? '', /needs you signed in/, action)
  }
  assert.match(deployKeyDenial(KEY, 'toString', {}) ?? '', /needs you signed in/)
})

test('runAction refuses a key’s call outside its reach before any action body runs', async () => {
  const caller: ActionCaller = {
    userId: 'user-1',
    name: 'Ada',
    email: 'ada@local.dev',
    scopes: ['context:read', 'tools:author'],
    via: 'mcp',
    deployKey: { id: 'key-1', label: 'CI', ...KEY },
  }
  // write_tool is inside the key's scopes, so only the key's own gate can refuse it.
  await assert.rejects(
    runAction(caller, 'write_tool', { space_id: 'space-1', name: 'poll', file: 'ui.tsx', content: 'x' }),
    (err: unknown) => err instanceof ActionError && err.status === 403 && /needs you signed in/.test(err.message),
  )
  await assert.rejects(
    runAction(caller, 'publish_tool', { space_id: 'space-1', name: 'board' }),
    (err: unknown) => err instanceof ActionError && err.status === 403 && /for the tool poll/.test(err.message),
  )
})

// ── a package, checked ───────────────────────────────────────────────────────

function pack(files: Record<string, string>): Uint8Array {
  return encodePackage({ ...files, [PACKAGE_CHECKSUMS]: checksumsText(fileDigests(files)) })
}

const MANIFEST = {
  manifestVersion: 2,
  name: 'hello-pack',
  title: 'Hello',
  description: 'Says hello',
  sdk: '^2',
  platforms: ['web', 'desktop'],
  entry: { ui: 'src/ui.tsx' },
  surfaces: { rail: { label: 'Hello', icon: 'grid' }, types: [] },
  permissions: {},
}

test('checkPackage builds a package the way a working copy is built, and runs the checks', async () => {
  const good = await checkPackage(
    pack({
      'visvine-tool.json': JSON.stringify(MANIFEST),
      'README.md': '# Hello\n\nSays hello.\n',
      'src/ui.tsx': "import { Text } from './text'\nexport default function App() { return <Text /> }\n",
      'src/text.tsx': "export function Text() { return <p>Hello</p> }\n",
    }),
  )
  assert.equal(good.ok, true, good.ok ? '' : good.error)
  if (good.ok) {
    assert.equal(good.name, 'hello-pack')
    assert.equal(good.build.ok, true, JSON.stringify(good.build.errors))
    assert.equal(good.build.config?.title, 'Hello')
    assert.ok(good.build.sizeBytes > 0)
    assert.notEqual(good.report.compatibility.status, 'blocked')
  }

  const broken = await checkPackage(
    pack({
      'visvine-tool.json': JSON.stringify(MANIFEST),
      'src/ui.tsx': 'export default function App() {\n  return <p>Hello</div>\n}\n',
    }),
  )
  assert.equal(broken.ok, true)
  if (broken.ok) {
    assert.equal(broken.build.ok, false)
    const first = broken.build.errors[0]
    assert.equal(first?.file, 'ui.tsx')
    assert.equal(first?.line, 2)
  }

  const renamed = await checkPackage(pack({ 'visvine-tool.json': JSON.stringify(MANIFEST), 'src/ui.tsx': 'export default () => null\n' }), { name: 'other' })
  assert.equal(renamed.ok && renamed.name, 'other')
})

test('checkPackage refuses what a package may not be, before building', async () => {
  const tampered = await checkPackage(
    encodePackage({
      'visvine-tool.json': JSON.stringify(MANIFEST),
      'src/ui.tsx': 'export default () => null\n',
      [PACKAGE_CHECKSUMS]: checksumsText(fileDigests({ 'visvine-tool.json': JSON.stringify(MANIFEST), 'src/ui.tsx': 'x' })),
    }),
  )
  assert.equal(tampered.ok, false)
  assert.match(!tampered.ok ? tampered.error : '', /changed after the package was made/)
  const notZip = await checkPackage(new TextEncoder().encode('hello'))
  assert.equal(notZip.ok, false)
})
