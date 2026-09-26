/**
 * The host's own services to a Tool (`ui.*`): answered by the page around the
 * frame, never the server. The rules: a download needs the Tool's declaration
 * and the viewer's yes, one question is open at a time, and nothing a Tool
 * names becomes a path off the app.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-host-services.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DOWNLOAD_MAX_CHARS, hostServiceCall, safeFilename, type HostServiceEnv } from '@/features/tools/lib/hostServices'
import { HOST_METHODS, isFrameMessage, isHostMethod } from '@/lib/tools/protocol'

function env(over: Partial<HostServiceEnv> = {}): HostServiceEnv & { toasts: string[]; saved: string[]; went: string[]; scrims: boolean[] } {
  const toasts: string[] = []
  const scrims: boolean[] = []
  const saved: string[] = []
  const went: string[] = []
  return {
    mayDownload: false,
    toast: (tone, message) => toasts.push(`${tone}:${message}`),
    confirm: () => Promise.resolve(true),
    save: (file) => saved.push(file.filename),
    navigate: (path) => went.push(path),
    scrim: (open) => scrims.push(open),
    scrims,
    toasts,
    saved,
    went,
    ...over,
  }
}

test('a frame may call the host methods, and only those beside the bridge\'s', () => {
  for (const method of HOST_METHODS) assert.ok(isFrameMessage({ type: 'visvine:call', id: '1', method, params: {} }))
  assert.equal(isHostMethod('ui.eval'), false)
  assert.equal(isFrameMessage({ type: 'visvine:call', id: '1', method: 'ui.eval', params: {} }), false)
})

test('a download needs the declaration, then the viewer\'s yes', async () => {
  const refused = env()
  const denied = await hostServiceCall('ui.download', { filename: 'deals.csv', content: 'a,b' }, refused)
  assert.equal(denied.ok, false)
  assert.equal(!denied.ok && denied.error.code, 'perimeter')
  assert.deepEqual(refused.saved, [])

  const declined = env({ mayDownload: true, confirm: () => Promise.resolve(false) })
  assert.deepEqual(await hostServiceCall('ui.download', { filename: 'deals.csv', content: 'a,b' }, declined), { ok: true, value: { saved: false } })
  assert.deepEqual(declined.saved, [])

  const yes = env({ mayDownload: true })
  assert.deepEqual(await hostServiceCall('ui.download', { filename: '../../etc/passwd', content: 'x' }, yes), { ok: true, value: { saved: true } })
  assert.deepEqual(yes.saved, ['passwd'])

  const big = await hostServiceCall('ui.download', { filename: 'x.txt', content: 'x'.repeat(DOWNLOAD_MAX_CHARS + 1) }, env({ mayDownload: true }))
  assert.equal(!big.ok && big.error.code, 'too_large')
})

test('one question at a time', async () => {
  const busy = await hostServiceCall('ui.confirm', { title: 'Sure?' }, env({ confirm: () => null }))
  assert.equal(!busy.ok && busy.error.code, 'rate_limited')
  assert.deepEqual(await hostServiceCall('ui.confirm', { title: 'Sure?' }, env()), { ok: true, value: { confirmed: true } })
})

test('toasts are plain text, clipped; opening goes to the app\'s own pages', async () => {
  const e = env()
  await hostServiceCall('ui.toast', { message: 'Saved', tone: 'success' }, e)
  await hostServiceCall('ui.toast', { message: 'x'.repeat(500), tone: 'rainbow' }, e)
  assert.equal(e.toasts[0], 'success:Saved')
  assert.equal(e.toasts[1].length, 'info:'.length + 200)
  await hostServiceCall('ui.openRecord', { nodeId: 'person:ada' }, e)
  await hostServiceCall('ui.openRecord', { path: 'deals/acme.md' }, e)
  await hostServiceCall('ui.openResource', { id: 'res 1' }, e)
  assert.deepEqual(e.went, ['/directory/person%3Aada', '/directory/note/deals/acme.md', '/directory?view=resources&resource=res%201'])
  const escape = await hostServiceCall('ui.openRecord', { path: '../admin' }, e)
  assert.equal(escape.ok, false)
})

test('a file name never carries a folder or a control character', () => {
  assert.equal(safeFilename('report.csv'), 'report.csv')
  assert.equal(safeFilename('a/b\\c.txt'), 'c.txt')
  assert.equal(safeFilename('q?1.csv'), 'q-1.csv')
  assert.equal(safeFilename('\u0000\u0007.hidden'), 'hidden')
  assert.equal(safeFilename('   '), 'download.txt')
})

test('a dialog in the frame dims the app around it, and only a real true opens it', async () => {
  const e = env()
  await hostServiceCall('ui.scrim', { open: true }, e)
  await hostServiceCall('ui.scrim', { open: 'yes' }, e)
  await hostServiceCall('ui.scrim', { open: false }, e)
  assert.deepEqual(e.scrims, [true, false, false])
})
