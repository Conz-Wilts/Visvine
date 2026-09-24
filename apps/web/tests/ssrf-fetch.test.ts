// The unfurler fetches whatever URL a member pastes, so it is the SSRF front
// door. Every hop's host is checked before the request, every socket's address
// at connect time, redirects are followed by hand and capped, bodies are
// capped, and time is bounded.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetch as undiciFetch } from 'undici'
import { isPrivateAddress, publicDispatcher } from '../lib/net/ssrf'
import { readText, ssrfSafeFetch } from '../lib/linkPreview'
import { readBounded } from '../lib/resources/unfurlFetch'

type Init = { signal: AbortSignal; redirect: 'manual'; headers: Record<string, string> }

/** A fake network: records every URL asked for and answers from a script. */
function network(answer: (url: string) => Response) {
  const asked: string[] = []
  const fetcher = async (url: string, _init: Init) => {
    asked.push(url)
    return answer(url)
  }
  return { asked, fetcher }
}

const PUBLIC = 'http://93.184.216.34'
const ok = () => new Response('<html><head><title>ok</title></head></html>', { status: 200 })
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })
const signal = () => new AbortController().signal

test('private, loopback, link-local and metadata addresses are refused before any request', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://172.16.0.9/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f.1/',
  ]) {
    const { asked, fetcher } = network(ok)
    assert.equal(await ssrfSafeFetch(url, signal(), fetcher), null, url)
    assert.deepEqual(asked, [], `${url} must not be requested`)
  }
})

test('only http(s), and never a URL carrying credentials', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://93.184.216.34/', 'gopher://93.184.216.34/', 'http://user:pw@93.184.216.34/']) {
    const { asked, fetcher } = network(ok)
    assert.equal(await ssrfSafeFetch(url, signal(), fetcher), null, url)
    assert.deepEqual(asked, [])
  }
})

test('a public first hop cannot redirect inside', async () => {
  for (const inside of ['http://169.254.169.254/', 'http://127.0.0.1:8080/admin', 'http://[::ffff:7f00:1]/', 'file:///etc/passwd']) {
    const { asked, fetcher } = network((url) => (url.startsWith(PUBLIC) ? redirect(inside) : ok()))
    assert.equal(await ssrfSafeFetch(`${PUBLIC}/start`, signal(), fetcher), null, inside)
    assert.deepEqual(asked, [`${PUBLIC}/start`], `${inside} must not be requested`)
  }
})

test('redirects are followed by hand, relative ones resolved, and capped', async () => {
  const hops = network((url) => (url.endsWith('/final') ? ok() : redirect('/final')))
  const res = await ssrfSafeFetch(`${PUBLIC}/a`, signal(), hops.fetcher)
  assert.equal(res?.status, 200)
  assert.deepEqual(hops.asked, [`${PUBLIC}/a`, `${PUBLIC}/final`])

  let n = 0
  const loop = network(() => redirect(`${PUBLIC}/hop${++n}`))
  assert.equal(await ssrfSafeFetch(`${PUBLIC}/hop0`, signal(), loop.fetcher), null)
  assert.equal(loop.asked.length, 5, 'the first request and four redirects, then it stops')
})

test('time is bounded: an abort ends the fetch', async () => {
  const controller = new AbortController()
  const hang = async (_url: string, init: Init) =>
    new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(ssrfSafeFetch(`${PUBLIC}/slow`, controller.signal, hang), /aborted/)
})

test('bodies are capped: a head read stops, a file larger than allowed is refused whole', async () => {
  const huge = 'x'.repeat(1_000_000)
  const text = await readText(new Response(`<head>${huge}`), 10_000)
  assert.ok(text !== null && text.length < 100_000)
  assert.equal(await readBounded(new Response(huge), 10_000), null)
  assert.equal(await readBounded(new Response('x'.repeat(50), { headers: { 'content-length': '99999999' } }), 10_000), null)
  assert.equal((await readBounded(new Response('small'), 10_000))?.toString(), 'small')
})

test('every embedded-IPv4 spelling of an inside address is inside', () => {
  for (const address of [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:a9fe:a9fe::1',
    '::ffff:0:10.0.0.1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '2001:db8::1',
  ]) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  for (const address of ['93.184.216.34', '2606:4700::1111', '::ffff:93.184.216.34']) {
    assert.equal(isPrivateAddress(address), false, address)
  }
})

test('the connect-time check refuses a name that resolves inside (DNS rebinding)', async () => {
  const server = createServer((_req, res) => res.end('inside')).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const port = (server.address() as { port: number }).port
  try {
    // `localhost` passes no literal-IP check; only the socket's address gives it away.
    await assert.rejects(undiciFetch(`http://localhost:${port}/`, { dispatcher: publicDispatcher() }), (err: Error) => {
      const cause = (err as { cause?: Error }).cause
      return /private address/.test(`${err.message} ${cause?.message ?? ''}`)
    })
  } finally {
    server.close()
  }
})
