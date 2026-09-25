/**
 * Tools run on the web and in the desktop shell, never in the phone apps
 * (lib/tools/clientClass.ts). The phones are the only clients that send their
 * session as a Bearer token, so the transport decides; a phone door's
 * `cl: 'mobile'` claim decides too.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spaceForPhone, toolClientOf, toolRunDenial } from '@/lib/tools/clientClass'
import { resolveBridgeTarget, type TargetDeps } from '@/lib/tools/target'
import type { SessionPayload } from '@/lib/session'

const SESSION: SessionPayload = { userId: 'u1', name: 'A', email: 'a@b.c' }

test('a Bearer session is a phone, whatever it claims; a cookie is the app unless a phone door minted it', () => {
  assert.equal(toolClientOf({ transport: 'bearer', session: {} }), 'mobile')
  assert.equal(toolClientOf({ transport: 'bearer', session: { cl: 'mobile' } }), 'mobile')
  assert.equal(toolClientOf({ transport: 'cookie', session: {} }), 'app')
  assert.equal(toolClientOf({ transport: 'cookie', session: { cl: 'mobile' } }), 'mobile')
})

test('only a phone is refused', () => {
  assert.equal(toolRunDenial('app'), null)
  assert.equal(toolRunDenial(undefined), null)
  assert.deepEqual(toolRunDenial('mobile'), { code: 'forbidden', message: 'Tools run on the web and in the desktop app.' })
})

test('a phone is refused at the door before anything is read', async () => {
  const trap = () => {
    throw new Error('nothing may be read for a phone')
  }
  const deps = {
    findInstall: trap,
    findBuild: trap,
    resolveContext: trap,
    principalOf: trap,
    readVisible: trap,
    featureAccessForbidden: trap,
  } as unknown as TargetDeps
  for (const target of [
    { kind: 'install', installId: 'i1' },
    { kind: 'preview', spaceId: 's1', name: 'deals' },
  ]) {
    const answer = await resolveBridgeTarget(SESSION, target, deps, 'mobile')
    assert.ok('code' in answer && answer.code === 'forbidden', JSON.stringify(answer))
  }
})

test('a phone is sent no installed Tools and no tool:* rail keys', () => {
  const space = {
    id: 's1',
    installedTools: [{ slug: 'deals' }],
    featureConfig: {
      order: ['directory', 'tool:deals', 'channels'],
      more: ['tool:polls'],
      adminOnly: ['tool:deals', 'channels'],
      enabled: { 'tool:deals': true, channels: true },
    },
  }
  const phone = spaceForPhone(space)
  assert.deepEqual(phone.installedTools, [])
  assert.deepEqual(phone.featureConfig.order, ['directory', 'channels'])
  assert.deepEqual(phone.featureConfig.more, [])
  assert.deepEqual(phone.featureConfig.adminOnly, ['channels'])
  assert.deepEqual(phone.featureConfig.enabled, { channels: true })
  assert.equal(space.installedTools.length, 1, 'the original is untouched')
  assert.deepEqual(spaceForPhone({ id: 's2', installedTools: [{ slug: 'x' }], featureConfig: null }).installedTools, [])
})

/** Every source file of the phone apps. */
function mobileSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'build' || name === 'node_modules' || name.startsWith('.') || name.endsWith('.xcodeproj')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...mobileSources(path))
    else if (/\.(swift|kt|kts|xml|plist)$/.test(name)) out.push(path)
  }
  return out
}

test('nothing in the phone apps names a Tool door, a Tool page or list_tools', () => {
  const root = join(__dirname, '..', '..', 'mobile')
  const files = mobileSources(root)
  assert.ok(files.length > 50, `found only ${files.length} mobile source files — the walk has stopped working`)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const needle of ['/api/tools/', '/t/', 'list_tools']) {
      assert.ok(!text.includes(needle), `${file.slice(root.length)} names ${needle}`)
    }
  }
})
