/**
 * The agent run/tick routes export `maxDuration` as a literal (Next needs a
 * statically analysable segment config — a computed value fails `next build`).
 * This keeps those literals from drifting below MAX_RUN_MS in lib/agents/limits.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-route-limits.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_RUN_MS } from '@/lib/agents/limits'

const ROUTES = [
  'app/api/internal/agents/tick/route.ts',
  'app/api/internal/agents/run/route.ts',
  'app/api/communities/[spaceId]/agents/[name]/run/route.ts',
]

for (const route of ROUTES) {
  test(`${route} maxDuration is a literal ≥ MAX_RUN_MS`, () => {
    const src = readFileSync(new URL(`../${route}`, import.meta.url), 'utf8')
    const m = /^export const maxDuration = (\d+)$/m.exec(src)
    assert.ok(m, 'maxDuration must be exported as a bare integer literal')
    assert.ok(Number(m[1]) >= MAX_RUN_MS / 1000, `maxDuration ${m[1]}s < MAX_RUN_MS ${MAX_RUN_MS / 1000}s`)
  })
}
