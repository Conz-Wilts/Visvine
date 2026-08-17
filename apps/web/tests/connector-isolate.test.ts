/**
 * The connector isolate: what code inside it can and cannot do.
 *
 * The escape battery below is deliberately one assertion per global rather than
 * a loop — when one of them starts passing, the failure should name the thing
 * that became reachable.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { runInIsolate, type SandboxPerimeter } from '@/lib/connectors/isolate'
import { parseAllowRule } from '@/lib/connectors/config'

function perimeter(over: Partial<SandboxPerimeter> = {}): SandboxPerimeter {
  return { hosts: [], allow: [], env: {}, timeoutMs: 5_000, allowPrivate: false, ...over }
}

/** A throwaway upstream on loopback, so egress tests need no network. */
async function upstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ host: string; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    host: `127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// ── the basics ────────────────────────────────────────────────────────────────

test('returns the value the code returns, with console output alongside', async () => {
  const r = await runInIsolate(perimeter(), `console.log('working'); return { n: 41 + 1 }`)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { n: 42 })
  assert.equal(r.logs, 'working')
  assert.equal(r.timedOut, false)
  assert.equal(r.error, null)
})

test('the health probe the connector page runs still returns its marker', async () => {
  const r = await runInIsolate(perimeter(), `return 'connector ok'`)
  assert.equal(r.ok, true)
  assert.equal(r.value, 'connector ok')
})

test('perimeter env is readable and the server env is not', async () => {
  process.env.VISVINE_LEAK_CANARY = 'do-not-leak'
  try {
    const r = await runInIsolate(
      perimeter({ env: { FOO: 'bar' } }),
      `return { foo: env.FOO, proc: typeof process, canary: typeof VISVINE_LEAK_CANARY }`,
      // No secrets here, so say so — the default redacts every env VALUE, which
      // is the safe direction when a caller doesn't distinguish them.
      { redact: [] },
    )
    assert.deepEqual(r.value, { foo: 'bar', proc: 'undefined', canary: 'undefined' })
  } finally {
    delete process.env.VISVINE_LEAK_CANARY
  }
})

test('with no explicit redact list, every env value is scrubbed anyway', async () => {
  const r = await runInIsolate(perimeter({ env: { FOO: 'bar' } }), `return env.FOO`)
  assert.equal(r.value, '[redacted]')
})

test('top-level await works inside the run', async () => {
  const r = await runInIsolate(perimeter(), `const v = await Promise.resolve(7); return v * 2`)
  assert.equal(r.value, 14)
})

// ── escape battery ────────────────────────────────────────────────────────────

test('escape: process is not reachable', async () => {
  assert.equal((await runInIsolate(perimeter(), `return typeof process`)).value, 'undefined')
})

test('escape: require is not reachable', async () => {
  assert.equal((await runInIsolate(perimeter(), `return typeof require`)).value, 'undefined')
})

test('escape: import() has no module loader behind it', async () => {
  const r = await runInIsolate(perimeter(), `try { await import('node:fs'); return 'LOADED' } catch { return 'blocked' }`)
  assert.equal(r.value, 'blocked')
})

test('escape: Function constructor reaches only the isolate global', async () => {
  const r = await runInIsolate(perimeter(), `return typeof Function('return this')().process`)
  assert.equal(r.value, 'undefined')
})

test('escape: the constructor-of-constructor trick finds nothing', async () => {
  const r = await runInIsolate(
    perimeter(),
    `try { return typeof globalThis.constructor.constructor('return process')() } catch { return 'undefined' }`,
  )
  assert.equal(r.value, 'undefined')
})

test('escape: quickjs-libc std and os are absent', async () => {
  const r = await runInIsolate(perimeter(), `return typeof std + '|' + typeof os`)
  assert.equal(r.value, 'undefined|undefined')
})

test('escape: timers are absent, so nothing outlives the run', async () => {
  const r = await runInIsolate(perimeter(), `return typeof setTimeout + '|' + typeof setInterval`)
  assert.equal(r.value, 'undefined|undefined')
})

test('escape: Buffer and WebAssembly are absent', async () => {
  const r = await runInIsolate(perimeter(), `return typeof Buffer + '|' + typeof WebAssembly`)
  assert.equal(r.value, 'undefined|undefined')
})

// ── errors ────────────────────────────────────────────────────────────────────

test('an uncaught error is reported, not thrown at the host', async () => {
  const r = await runInIsolate(perimeter(), `throw new Error('kaboom')`)
  assert.equal(r.ok, false)
  assert.equal(r.error?.message, 'kaboom')
  assert.equal(r.timedOut, false)
})

test('a thrown non-Error does not crash the host', async () => {
  const r = await runInIsolate(perimeter(), `throw 42`)
  assert.equal(r.ok, false)
  assert.equal(r.error?.message, '42')
})

test('secrets are redacted from the error message and the stack', async () => {
  const r = await runInIsolate(
    perimeter({ env: { TOKEN: 'sk_live_abc' } }),
    `throw new Error('failed with ' + env.TOKEN)`,
    { redact: ['sk_live_abc'] },
  )
  assert.equal(r.error?.message, 'failed with [redacted]')
  assert.ok(!(r.error?.stack ?? '').includes('sk_live_abc'))
})

test('a returned secret comes back redacted, however deeply nested', async () => {
  const r = await runInIsolate(
    perimeter({ env: { TOKEN: 'sk_live_abc' } }),
    `return { a: [{ b: env.TOKEN }], c: 'clean' }`,
    { redact: ['sk_live_abc'] },
  )
  assert.deepEqual(r.value, { a: [{ b: '[redacted]' }], c: 'clean' })
})

// ── limits ────────────────────────────────────────────────────────────────────

test('a busy loop is interrupted at the timeout', async () => {
  const started = Date.now()
  const r = await runInIsolate(perimeter({ timeoutMs: 1_000 }), `while (true) {}`)
  assert.equal(r.timedOut, true)
  assert.equal(r.ok, false)
  assert.ok(Date.now() - started < 5_000, 'must not run past its deadline')
})

test('a catastrophic regex is interrupted too', async () => {
  const r = await runInIsolate(
    perimeter({ timeoutMs: 1_000 }),
    `return /^(a+)+$/.test('a'.repeat(60) + 'b')`,
  )
  assert.equal(r.timedOut, true)
})

test('runaway console output is capped and the run still ends', async () => {
  const r = await runInIsolate(
    perimeter({ timeoutMs: 3_000 }),
    `for (let i = 0; i < 100000; i++) console.log('x'.repeat(1000)); return 'done'`,
  )
  assert.equal(r.truncated, true)
  assert.ok(r.logs.length <= 256 * 1024 + 1024)
})

test('unbounded allocation fails the run, and the next run still works', async () => {
  const r = await runInIsolate(
    perimeter({ timeoutMs: 5_000 }),
    `const a = []; for (;;) a.push('x'.repeat(100000)); `,
  )
  assert.equal(r.ok, false)
  // Disposal has to survive an out-of-memory isolate, or every later run dies.
  const after = await runInIsolate(perimeter(), `return 'still here'`)
  assert.equal(after.value, 'still here')
})

test('many sequential runs neither leak handles nor throw on disposal', async () => {
  for (let i = 0; i < 50; i++) {
    const r = await runInIsolate(perimeter(), `return ${i}`)
    assert.equal(r.value, i)
  }
})

// ── egress: the perimeter ─────────────────────────────────────────────────────

test('fetch reaches a listed host and returns plain data', async () => {
  const server = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ hello: 'world' }))
  })
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], allowPrivate: true }),
      `const res = await fetch('http://${server.host}/things'); return JSON.parse(res.body)`,
    )
    assert.equal(r.ok, true, r.error?.message)
    assert.deepEqual(r.value, { hello: 'world' })
  } finally {
    await server.close()
  }
})

test('an unlisted host is refused, and the code can catch the reason', async () => {
  const r = await runInIsolate(
    perimeter({ hosts: ['api.example.com'] }),
    `try { await fetch('https://evil.example/x') } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /evil\.example is not in this connector's hosts \(api\.example\.com\)/)
  // The operator sees it on the run as well, not only the model.
  assert.equal(r.denials.length, 1)
})

test('an unlisted host is named as such even when allow rules would also refuse', async () => {
  // Both gates fail here. Reporting the allow rules would send the reader off
  // to edit `allow:` when the thing to fix is `hosts:`.
  const r = await runInIsolate(
    perimeter({ hosts: ['api.example.com'], allow: [parseAllowRule('GET /v1/things')!] }),
    `try { await fetch('https://evil.example/') } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /evil\.example is not in this connector's hosts/)
  assert.ok(!String(r.value).includes('allow rules'))
})

test('a connector with no hosts has no network at all', async () => {
  const r = await runInIsolate(perimeter(), `try { await fetch('https://api.example.com/') } catch (e) { return e.message }`)
  assert.match(String(r.value), /lists no hosts/)
})

test('allow rules gate the method and path — the thing the proxy could not do', async () => {
  const server = await upstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  try {
    const p = perimeter({
      hosts: [server.host],
      allow: [parseAllowRule('GET /v1/things*')!],
      allowPrivate: true,
    })
    const allowed = await runInIsolate(p, `return (await fetch('http://${server.host}/v1/things')).body`)
    assert.equal(allowed.value, 'ok')

    // Same host, wrong method: under the CONNECT tunnel this was invisible.
    const wrongMethod = await runInIsolate(
      p,
      `try { await fetch('http://${server.host}/v1/things', { method: 'POST', body: '{}' }) } catch (e) { return e.message }`,
    )
    assert.match(String(wrongMethod.value), /POST \/v1\/things is not in this connector's allow rules/)

    const wrongPath = await runInIsolate(
      p,
      `try { await fetch('http://${server.host}/v1/secrets') } catch (e) { return e.message }`,
    )
    assert.match(String(wrongPath.value), /GET \/v1\/secrets is not in this connector's allow rules/)
  } finally {
    await server.close()
  }
})

test('an empty allow list means host-gated only, not deny-all', async () => {
  const server = await upstream((_req, res) => res.end('reachable'))
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], allow: [], allowPrivate: true }),
      `return (await fetch('http://${server.host}/anything')).body`,
    )
    assert.equal(r.value, 'reachable')
  } finally {
    await server.close()
  }
})

test('a secret reflected by an upstream is redacted on the way back', async () => {
  const server = await upstream((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`you sent ${req.headers.authorization}`)
  })
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], env: { KEY: 'sk_live_reflected' }, allowPrivate: true }),
      `return (await fetch('http://${server.host}/whoami', { headers: { authorization: env.KEY } })).body`,
      { redact: ['sk_live_reflected'] },
    )
    assert.equal(r.value, 'you sent [redacted]')
  } finally {
    await server.close()
  }
})

test('redirects are returned, not followed', async () => {
  const server = await upstream((req, res) => {
    if (req.url === '/go') {
      res.writeHead(302, { location: 'https://elsewhere.example/landed' })
      res.end()
      return
    }
    res.end('should not be reached')
  })
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], allowPrivate: true }),
      `const res = await fetch('http://${server.host}/go'); return { status: res.status, location: res.location }`,
    )
    assert.deepEqual(r.value, { status: 302, location: 'https://elsewhere.example/landed' })
  } finally {
    await server.close()
  }
})

test('non-http schemes are refused', async () => {
  const r = await runInIsolate(
    perimeter({ hosts: ['example.com'] }),
    `try { await fetch('file:///etc/passwd') } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /file: is not an allowed scheme/)
})

test('private address space is refused unless the escape hatch is on', async () => {
  const server = await upstream((_req, res) => res.end('loopback'))
  try {
    const refused = await runInIsolate(
      perimeter({ hosts: [server.host], allowPrivate: false }),
      `try { await fetch('http://${server.host}/') } catch (e) { return e.message }`,
    )
    assert.match(String(refused.value), /egress denied/)
  } finally {
    await server.close()
  }
})

test('header injection through a header value is refused', async () => {
  const r = await runInIsolate(
    perimeter({ hosts: ['example.com'] }),
    `try { await fetch('https://example.com/', { headers: { 'x-a': 'b\\r\\nx-evil: 1' } }) } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /may not contain a newline/)
})

// ── sql ───────────────────────────────────────────────────────────────────────

test('a DSN outside the perimeter is refused without naming its host', async () => {
  const r = await runInIsolate(
    perimeter({ hosts: ['db.allowed.example'], env: { DSN: 'postgres://u:pw@db.secret.internal:5432/app' } }),
    `try { await sql(env.DSN, 'select 1') } catch (e) { return e.message }`,
    { redact: ['postgres://u:pw@db.secret.internal:5432/app'] },
  )
  const message = String(r.value)
  assert.match(message, /sql denied/)
  assert.match(message, /db\.allowed\.example/) // the allowed hosts are public
  assert.ok(!message.includes('db.secret.internal'), 'must not echo the DSN host')
  assert.ok(!message.includes('pw'), 'must not echo the DSN password')
})

test('a connector with no hosts is told how to get a database host', async () => {
  const r = await runInIsolate(
    perimeter({ env: { DSN: 'postgres://u:pw@db.example:5432/app' } }),
    `try { await sql(env.DSN, 'select 1') } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /lists no hosts/)
  assert.match(String(r.value), /db:connectors:migrate/)
})

test('an unsupported DSN scheme is a config error', async () => {
  const r = await runInIsolate(
    perimeter({ hosts: ['redis.example'], env: { DSN: 'redis://redis.example:6379' } }),
    `try { await sql(env.DSN, 'get x') } catch (e) { return e.message }`,
  )
  assert.match(String(r.value), /postgres:\/\/ and mysql:\/\/ DSNs only/)
})

// ── concurrency ───────────────────────────────────────────────────────────────

test('a run may make many sequential host calls', async () => {
  // The reason this file exists in its current form: the asyncify transport
  // corrupted after two or three calls, and an OAuth dance plus pagination is
  // routinely more than that.
  const server = await upstream((_req, res) => res.end('x'))
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], allowPrivate: true, timeoutMs: 30_000 }),
      `let n = 0
       for (let i = 0; i < 25; i++) n += (await fetch('http://${server.host}/')).status
       return n`,
    )
    assert.equal(r.ok, true, r.error?.message)
    assert.equal(r.value, 200 * 25)
  } finally {
    await server.close()
  }
})

test('Promise.all over two host calls works', async () => {
  const server = await upstream((req, res) => res.end(`hit ${req.url}`))
  try {
    const r = await runInIsolate(
      perimeter({ hosts: [server.host], allowPrivate: true }),
      `const [a, b] = await Promise.all([
         fetch('http://${server.host}/a'),
         fetch('http://${server.host}/b'),
       ])
       return [a.body, b.body]`,
    )
    assert.equal(r.ok, true, r.error?.message)
    assert.deepEqual(r.value, ['hit /a', 'hit /b'])
  } finally {
    await server.close()
  }
})

test('concurrent runs all complete under the process-wide slot limit', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => runInIsolate(perimeter(), `return ${i} * 2`)),
  )
  assert.deepEqual(results.map((r) => r.value), Array.from({ length: 12 }, (_, i) => i * 2))
})

// ── extra capabilities (Tool data.js) ────────────────────────────────────────

test('a custom capability is callable and its result is awaited', async () => {
  const r = await runInIsolate(perimeter(), `return await visvine.read('a', 1)`, {
    capabilities: { read: async (args) => ({ echoed: args }) },
  })
  assert.equal(r.ok, true, r.error?.message)
  assert.deepEqual(r.value, { echoed: ['a', 1] })
})

test('a dotted capability name builds a nested namespace object', async () => {
  const r = await runInIsolate(
    perimeter(),
    `const a = await visvine.context.read('x'); const b = await visvine.context.write('y'); return [a, b]`,
    {
      capabilities: {
        'context.read': async (args) => `read:${String(args[0])}`,
        'context.write': async (args) => `write:${String(args[0])}`,
      },
    },
  )
  assert.equal(r.ok, true, r.error?.message)
  assert.deepEqual(r.value, ['read:x', 'write:y'])
})

test('omitDefaults removes fetch entirely — Tools data.js gets no raw fetch/sql/mcp', async () => {
  const r = await runInIsolate(
    perimeter(),
    `return typeof fetch + '|' + typeof sql + '|' + typeof mcp + '|' + typeof sleep`,
    { omitDefaults: ['fetch', 'sql', 'mcp'] },
  )
  assert.equal(r.value, 'undefined|undefined|undefined|function')
})

test('a rejected capability surfaces inside the isolate with the host error message', async () => {
  const r = await runInIsolate(perimeter(), `try { await visvine.boom() } catch (e) { return e.message }`, {
    capabilities: { boom: async () => { throw new Error('perimeter refused this') } },
  })
  assert.equal(r.ok, true, r.error?.message)
  assert.equal(r.value, 'perimeter refused this')
})

test('globals are installed frozen and cannot be reassigned', async () => {
  const r = await runInIsolate(
    perimeter(),
    `subject.name = 'hacked'; subject.nested.n = 999; return subject`,
    { globals: { subject: { name: 'original', nested: { n: 1 } } } },
  )
  assert.equal(r.ok, true, r.error?.message)
  assert.deepEqual(r.value, { name: 'original', nested: { n: 1 } })
})

test('the visvine namespace itself is frozen', async () => {
  const r = await runInIsolate(perimeter(), `visvine.read = () => 'evil'; return typeof visvine.read`, {
    capabilities: { read: async () => 'original' },
  })
  assert.equal(r.ok, true, r.error?.message)
  assert.equal(r.value, 'function')
  const called = await runInIsolate(perimeter(), `return await visvine.read()`, {
    capabilities: { read: async () => 'original' },
  })
  assert.equal(called.value, 'original')
})
