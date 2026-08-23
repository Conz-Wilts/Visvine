// The tokenless local MCP path (lib/mcp/devIdentity.ts). What is worth pinning
// here is not the happy path — `pnpm mcp:dev` plus a client exercises that on
// every use — but the two ways it must NOT fire:
//
//   1. Anywhere NODE_ENV is production, whatever ENABLE_DEV_AUTH says. This is
//      the guard that stands between "no auth locally" and "no auth at all",
//      and `next build` bakes NODE_ENV=production into every deployed artifact.
//   2. When a bearer token IS presented. A garbage or expired token must be
//      refused, not quietly upgraded to the seeded dev user — otherwise the
//      401/insufficient_scope paths would be untestable locally, and a client
//      holding a stale token would silently act as somebody else.
//
// The identity lookup itself needs a database, so it lives in the flow, not here.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-dev-bypass.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { isDevMcpBypassEnabled } from '@/lib/mcp/devIdentity'
import { mcpBearerVerifier } from '@/lib/mcp/auth'
import { MCP_SERVER_KINDS } from '@/lib/mcp/config'

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const before: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) before[k] = process.env[k]
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return (async () => {
    try {
      await fn()
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })()
}

test('the bypass is off in a production build even with ENABLE_DEV_AUTH=true', () =>
  withEnv({ NODE_ENV: 'production', ENABLE_DEV_AUTH: 'true' }, () => {
    assert.equal(isDevMcpBypassEnabled(), false)
  }))

test('the bypass is off in development unless ENABLE_DEV_AUTH is exactly "true"', () =>
  withEnv({ NODE_ENV: 'development', ENABLE_DEV_AUTH: '1' }, () => {
    assert.equal(isDevMcpBypassEnabled(), false)
  }))

test('the bypass is on for local development', () =>
  withEnv({ NODE_ENV: 'development', ENABLE_DEV_AUTH: 'true' }, () => {
    assert.equal(isDevMcpBypassEnabled(), true)
  }))

test('a tokenless request is refused on both servers when the bypass is off', () =>
  withEnv({ NODE_ENV: 'production', ENABLE_DEV_AUTH: 'true' }, async () => {
    for (const kind of MCP_SERVER_KINDS) {
      const verify = mcpBearerVerifier(kind)
      assert.equal(await verify(new Request('https://visvine.com/api/mcp')), undefined)
    }
  }))

test('a bogus token is refused even where the bypass is on', () =>
  withEnv({ NODE_ENV: 'development', ENABLE_DEV_AUTH: 'true', AUTH_SECRET: 'test-secret' }, async () => {
    for (const kind of MCP_SERVER_KINDS) {
      const verify = mcpBearerVerifier(kind)
      assert.equal(await verify(new Request('http://localhost:3000/api/mcp'), 'not-a-jwt'), undefined)
    }
  }))
