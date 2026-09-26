/**
 * The headless preview capture (lib/tools/screenshot.ts) — the parts that are
 * decisions rather than a browser: when it may run at all, and that a refusal
 * is an answer, never a throw. The live capture is exercised by the scripted
 * verification against a dev server, not from here (it needs Chromium).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-screenshot.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  captureToolPreview,
  previewNavigationAllowed,
  previewPageUrl,
  PREVIEW_SESSION_TTL_S,
  screenshotEnabled,
  SCREENSHOT_BUDGET_MS,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_WIDTH,
} from '@/lib/tools/screenshot'

test('dev always may render; production only behind TOOLS_SCREENSHOT=on', () => {
  assert.equal(screenshotEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).ok, true)
  assert.equal(screenshotEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).ok, true)
  const off = screenshotEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
  assert.equal(off.ok, false)
  assert.match(!off.ok ? off.reason : '', /TOOLS_SCREENSHOT=on/)
  assert.equal(screenshotEnabled({ NODE_ENV: 'production', TOOLS_SCREENSHOT: 'on' } as NodeJS.ProcessEnv).ok, true)
  assert.equal(screenshotEnabled({ NODE_ENV: 'production', TOOLS_SCREENSHOT: 'yes' } as NodeJS.ProcessEnv).ok, false)
})

test('a production capture without the flag answers unavailable without touching a browser', async () => {
  const before = { NODE_ENV: process.env.NODE_ENV, TOOLS_SCREENSHOT: process.env.TOOLS_SCREENSHOT }
  Object.assign(process.env, { NODE_ENV: 'production' })
  delete process.env.TOOLS_SCREENSHOT
  try {
    const result = await captureToolPreview({
      appOrigin: 'https://visvine.test',
      spaceId: 'space_1',
      name: 'board',
      viewer: { userId: 'u1', name: 'Ada', email: 'ada@local.dev' },
    })
    assert.equal(result.available, false)
    assert.match(!result.available ? result.reason : '', /off in this deployment/)
  } finally {
    if (before.NODE_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else Object.assign(process.env, { NODE_ENV: before.NODE_ENV })
    if (before.TOOLS_SCREENSHOT !== undefined) process.env.TOOLS_SCREENSHOT = before.TOOLS_SCREENSHOT
  }
})

test('the page is pinned to the preview URL: same origin + path only, for main-frame navigations', () => {
  const preview = previewPageUrl('https://visvine.test/', 'my board')
  assert.equal(preview, 'https://visvine.test/tools/preview/my%20board')
  // The preview itself, reloads, a query, a hash, a trailing slash.
  assert.equal(previewNavigationAllowed(preview, preview), true)
  assert.equal(previewNavigationAllowed(preview, `${preview}?x=1`), true)
  assert.equal(previewNavigationAllowed(preview, `${preview}#top`), true)
  assert.equal(previewNavigationAllowed(preview, `${preview}/`), true)
  // Anywhere else the caller's session could see.
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/admin?section=members'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/tools/preview/other'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/tools/preview/my%20board/../../admin'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/'), false)
  // Another origin, another scheme, garbage.
  assert.equal(previewNavigationAllowed(preview, 'https://tools.visvine.test/tools/preview/my%20board'), false)
  assert.equal(previewNavigationAllowed(preview, 'http://visvine.test/tools/preview/my%20board'), false)
  assert.equal(previewNavigationAllowed(preview, 'javascript:alert(1)'), false)
  assert.equal(previewNavigationAllowed(preview, 'about:blank'), false)
  assert.equal(previewNavigationAllowed(preview, 'not a url'), false)
  assert.equal(previewNavigationAllowed('nope', preview), false)
})

test('the capture opens the preview in its space, and follows a room to its house and no further', () => {
  const preview = previewPageUrl('https://visvine.test', 'board', 'votes', 'deals')
  assert.equal(preview, 'https://visvine.test/s/deals/tools/preview/board?section=votes')
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/deals/tools/preview/board'), true)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/house/deals/tools/preview/board?section=votes'), true)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/other/tools/preview/board'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/house/other/tools/preview/board'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/deals/admin'), false)
  assert.equal(previewNavigationAllowed(preview, 'https://visvine.test/s/../deals/tools/preview/board'), false)
})

test('the minted preview session is minutes long, not the 30-day web session', () => {
  assert.ok(PREVIEW_SESSION_TTL_S <= 300)
  assert.ok(PREVIEW_SESSION_TTL_S * 1000 >= SCREENSHOT_BUDGET_MS)
})

test('the capture contract the MCP descriptions quote', () => {
  assert.equal(SCREENSHOT_WIDTH, 1024)
  assert.equal(SCREENSHOT_HEIGHT, 768)
  assert.equal(SCREENSHOT_BUDGET_MS, 10_000)
  assert.equal(SCREENSHOT_MAX_BYTES, 300_000)
})
