/**
 * The Content-Security-Policy the app serves.
 *
 * Worth pinning in a test because every failure mode here is silent in one
 * direction or catastrophic in the other: a policy that quietly regains
 * `'unsafe-inline'` on scripts looks fine and defends nothing, and a policy that
 * loses the nonce takes every script on the page down with it. Neither shows up
 * in a typecheck.
 *
 * test runner: node --import tsx --test tests/csp.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCsp, newNonce } from '../lib/security/csp'

/** Pull one directive's sources out of a policy string. */
function directive(csp: string, name: string): string[] {
  const found = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `))
  assert.ok(found !== undefined, `policy has no ${name} directive: ${csp}`)
  return found.split(/\s+/).slice(1)
}

const PROD = { nonce: 'TEST_NONCE', isDev: false }

test('production script-src carries the nonce and NOT unsafe-inline or unsafe-eval', () => {
  const csp = buildCsp(PROD)
  const scripts = directive(csp, 'script-src')

  assert.ok(scripts.includes("'nonce-TEST_NONCE'"), 'the nonce must be present')
  assert.ok(scripts.includes("'strict-dynamic'"))
  // `'self'` stays as the fallback for browsers that do not implement
  // strict-dynamic; those that do will ignore it.
  assert.ok(scripts.includes("'self'"))

  // The entire point of the nonce.
  assert.ok(!scripts.includes("'unsafe-inline'"), "script-src must never allow 'unsafe-inline'")
  assert.ok(!scripts.includes("'unsafe-eval'"), "production script-src must not allow 'unsafe-eval'")
})

test('development gets unsafe-eval, because React uses eval to rebuild stacks', () => {
  const scripts = directive(buildCsp({ ...PROD, isDev: true }), 'script-src')
  assert.ok(scripts.includes("'unsafe-eval'"))
  // Still never inline, even in dev — a policy that differs there teaches the
  // wrong thing and hides breakage until production.
  assert.ok(!scripts.includes("'unsafe-inline'"))
})

test('upgrade-insecure-requests follows the SCHEME, not the build mode', () => {
  assert.ok(buildCsp({ ...PROD, isSecureOrigin: true }).includes('upgrade-insecure-requests'))
  // A production build served over plaintext localhost (`pnpm start`) would
  // otherwise rewrite its own asset URLs to https and fail every one of them.
  assert.ok(!buildCsp({ ...PROD, isSecureOrigin: false }).includes('upgrade-insecure-requests'))
  assert.ok(!buildCsp(PROD).includes('upgrade-insecure-requests'))
})

test('frame-src names the Tool origin when one is configured, and only then', () => {
  assert.deepEqual(directive(buildCsp(PROD), 'frame-src'), ["'self'"])
  assert.deepEqual(
    directive(buildCsp({ ...PROD, toolsOrigin: 'https://tools.visvine.com' }), 'frame-src'),
    ["'self'", 'https://tools.visvine.com'],
  )
  // An unset origin must not leave an empty token behind — `frame-src 'self' `
  // with a trailing blank is not the same policy.
  assert.deepEqual(directive(buildCsp({ ...PROD, toolsOrigin: '' }), 'frame-src'), ["'self'"])
})

test('form-action widens only for the OAuth consent endpoint', () => {
  assert.deepEqual(directive(buildCsp(PROD), 'form-action'), ["'self'"])
  // The approve response is a 303 to the client's registered callback on
  // another origin; under 'self' the browser kills that hop.
  assert.deepEqual(
    directive(buildCsp({ ...PROD, allowCrossOriginFormPost: true }), 'form-action'),
    ["'self'", 'https:'],
  )
})

test('the directives the app depends on are all present', () => {
  const csp = buildCsp(PROD)
  for (const name of [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'frame-ancestors',
    'frame-src',
    'object-src',
    'base-uri',
    'form-action',
  ]) {
    directive(csp, name)
  }
  // This app is never framed; the Tool runtime mints its own policy and never
  // reaches this builder.
  assert.deepEqual(directive(csp, 'frame-ancestors'), ["'none'"])
  assert.deepEqual(directive(csp, 'object-src'), ["'none'"])
  // Google avatars and GCS-served media.
  assert.ok(directive(csp, 'img-src').includes('https:'))
})

test('the Open Sauce One font can actually load', () => {
  // Both hosts or neither: googleapis serves the @font-face stylesheet,
  // gstatic serves the files it points at. Blocking either one silently drops
  // the app to the system font stack, which is a change nobody reports.
  const csp = buildCsp(PROD)
  assert.ok(
    directive(csp, 'style-src').includes('https://fonts.googleapis.com'),
    'style-src must allow the Google Fonts stylesheet',
  )
  assert.ok(
    directive(csp, 'font-src').includes('https://fonts.gstatic.com'),
    'font-src must allow the font files that stylesheet references',
  )
})

test('nonces are unguessable and never repeat', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const n = newNonce()
    assert.ok(!seen.has(n), 'a nonce must never repeat')
    seen.add(n)
    // Base64 of a UUID: long enough that guessing is not a strategy.
    assert.ok(n.length >= 32, `nonce too short: ${n}`)
  }
})
