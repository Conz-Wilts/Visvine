/**
 * The agent-facing public page fetch (lib/connectors/publicFetch.ts): per-hop
 * SSRF re-judgement on redirects, the hop budget, scheme refusals, and the
 * streamed body cap.
 *
 * Runs entirely on fakes — no network, no DNS, no DB.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/public-fetch.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SsrfError } from '@/lib/net/ssrf'
import { fetchPublicBytes, fetchPublicText, type PublicFetchIo } from '@/lib/connectors/publicFetch'

interface Call {
  url: string
}

function io(responses: (Response | Error)[], allowedHosts: Set<string> | null = null) {
  const calls: Call[] = []
  const checked: string[] = []
  const impl: PublicFetchIo = {
    fetchImpl: (async (_input: RequestInfo | URL) => {
      const url = String(_input)
      calls.push({ url })
      const next = responses[calls.length - 1]
      if (next instanceof Error) throw next
      return next
    }) as typeof fetch,
    assertHost: async (hostname: string) => {
      checked.push(hostname)
      if (allowedHosts && !allowedHosts.has(hostname)) throw new SsrfError(`'${hostname}' is not a publicly routable address`)
    },
  }
  return { impl, calls, checked }
}

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } })
}

test('follows a redirect chain and re-checks every hop', async () => {
  const { impl, calls, checked } = io([
    redirect(302, 'https://next.example/page'),
    redirect(307, '/relative'),
    new Response('hello', { status: 200 }),
  ])
  const out = await fetchPublicText('https://start.example/a', impl)
  assert.equal(out, 'status 200\nhello')
  assert.deepEqual(calls.map((c) => c.url), [
    'https://start.example/a',
    'https://next.example/page',
    'https://next.example/relative',
  ])
  // Three hops, three host checks — including the relative redirect's host.
  assert.deepEqual(checked, ['start.example', 'next.example', 'next.example'])
})

test('a redirect to a host that fails the check is refused, not followed', async () => {
  const { impl, calls } = io(
    [redirect(302, 'https://169.254.169.254/latest/meta-data')],
    new Set(['public.example']),
  )
  const out = await fetchPublicText('https://public.example/a', impl)
  assert.match(out, /error: .*not a publicly routable/)
  assert.equal(calls.length, 1, 'the second hop never reaches fetch')
})

test('the hop budget stops an endless redirect loop', async () => {
  const { impl, calls } = io(Array.from({ length: 10 }, () => redirect(302, 'https://loop.example/again')))
  const out = await fetchPublicText('https://loop.example/start', impl)
  assert.match(out, /too many redirects/)
  assert.equal(calls.length, 4)
})

test('a redirect off https is refused at the gate', async () => {
  const { impl, calls } = io([redirect(302, 'http://downgrade.example/x')])
  const out = await fetchPublicText('https://public.example/a', impl)
  assert.equal(out, 'error: only https URLs can be fetched')
  assert.equal(calls.length, 1)
})

test('http is refused outside development', async () => {
  const { impl, calls } = io([])
  assert.notEqual(process.env.NODE_ENV, 'development')
  const out = await fetchPublicText('http://public.example/a', impl)
  assert.equal(out, 'error: only https URLs can be fetched')
  assert.equal(calls.length, 0)
})

test('an oversized body is truncated by the stream cap, not buffered whole', async () => {
  const big = 'x'.repeat(80_000)
  const { impl } = io([new Response(big, { status: 200 })])
  const out = await fetchPublicText('https://public.example/big', impl)
  assert.ok(out.startsWith('status 200\n'))
  assert.ok(out.endsWith('…[truncated]'))
  assert.ok(out.length < big.length + 100, 'the body was cut near the cap, not returned whole')
})

test('a non-3xx with a location header is body, not a redirect', async () => {
  const { impl, calls } = io([new Response('see location', { status: 200, headers: { location: 'https://elsewhere.example/' } })])
  const out = await fetchPublicText('https://public.example/a', impl)
  assert.equal(out, 'status 200\nsee location')
  assert.equal(calls.length, 1)
})

// ── The byte read: a file a person pointed at, or a chat attachment's link ──

test('a file is fetched whole, with its type and a name from the URL', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const { impl } = io([new Response(png, { status: 200, headers: { 'content-type': 'image/png; charset=binary' } })])
  const out = await fetchPublicBytes('https://cdn.example/assets/logo%20v2.png?x=1', 1024, impl)
  assert.ok(out.ok)
  assert.deepEqual([...out.bytes], [...png])
  assert.equal(out.contentType, 'image/png')
  assert.equal(out.filename, 'logo v2.png')
})

test('content-disposition names the file over the URL', async () => {
  const { impl } = io([
    new Response('x', { status: 200, headers: { 'content-disposition': "attachment; filename*=UTF-8''Run%20sheet.pdf" } }),
  ])
  const out = await fetchPublicBytes('https://files.example/download/abc123', 1024, impl)
  assert.ok(out.ok)
  assert.equal(out.filename, 'Run sheet.pdf')
})

test('a file over the cap is refused, not truncated', async () => {
  const { impl } = io([new Response(new Uint8Array(2048), { status: 200 })])
  const out = await fetchPublicBytes('https://files.example/big.bin', 1024, impl)
  assert.equal(out.ok, false)
  assert.match(!out.ok ? out.error : '', /larger than/)
})

test('a byte read gates every redirect hop like the text read', async () => {
  const { impl, calls } = io([redirect(302, 'https://internal.example/secret')], new Set(['start.example']))
  const out = await fetchPublicBytes('https://start.example/file', 1024, impl)
  assert.equal(out.ok, false)
  assert.equal(calls.length, 1)
})

test('an error status is a refusal, not a file', async () => {
  const { impl } = io([new Response('nope', { status: 404 })])
  const out = await fetchPublicBytes('https://files.example/missing.png', 1024, impl)
  assert.equal(out.ok, false)
})
