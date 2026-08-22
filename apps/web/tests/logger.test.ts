/**
 * The production log record's shape.
 *
 * These fields are not cosmetic: `severity` is what makes an error an error in
 * Cloud Logging, `@type` is what routes it to Error Reporting (and therefore to
 * alerting), and Error Reporting reads the stack out of `message`. Get any of
 * them wrong and errors keep being logged and stop being noticed — the exact
 * failure mode that is invisible until it matters.
 *
 * test runner: node --import tsx --test tests/logger.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const ERROR_EVENT_TYPE =
  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent'

/**
 * Load the logger with a chosen environment and capture what it writes.
 * Re-imported per case with a cache-busting query because the module reads
 * NODE_ENV and the project id once, at import.
 */
async function capture(
  env: Record<string, string | undefined>,
  run: (logger: typeof import('@/lib/logger').logger) => void,
): Promise<Record<string, unknown>[]> {
  const saved: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  const lines: string[] = []
  const realLog = console.log
  const realError = console.error
  console.log = (...args: unknown[]) => void lines.push(String(args[0]))
  console.error = (...args: unknown[]) => void lines.push(String(args[0]))

  try {
    const mod = await import(`../lib/logger?case=${Math.random()}`)
    run(mod.logger)
  } finally {
    console.log = realLog
    console.error = realError
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }

  return lines.map((l) => JSON.parse(l) as Record<string, unknown>)
}

const PROD = { NODE_ENV: 'production', K_SERVICE: 'visvine-web', K_REVISION: 'visvine-web-abc123' }

test('an error record is tagged for Error Reporting and carries the stack in message', async () => {
  const [record] = await capture(PROD, (logger) => {
    logger.error('auth.callback.failed', { err: new Error('token exchange refused'), userId: 'u1' })
  })

  assert.equal(record.severity, 'ERROR')
  assert.equal(record['@type'], ERROR_EVENT_TYPE)
  assert.deepEqual(record.serviceContext, { service: 'visvine-web', version: 'visvine-web-abc123' })
  // Error Reporting groups on the stack, and it reads it from `message`.
  assert.match(String(record.message), /token exchange refused/)
  assert.match(String(record.message), /\n\s+at /)
  // The event name stays greppable and the context survives alongside it.
  assert.equal(record.event, 'auth.callback.failed')
  assert.equal(record.userId, 'u1')
})

test('a thrown non-Error still produces a groupable record', async () => {
  const [record] = await capture(PROD, (logger) => {
    logger.error('connector.run_failed', { err: 'boom' })
  })

  assert.equal(record['@type'], ERROR_EVENT_TYPE)
  // No stack to borrow, so the event name has to be the discriminator — one
  // group per event rather than every stackless failure in one heap.
  assert.match(String(record.message), /^connector\.run_failed/)
  assert.match(String(record.message), /\n\s+at /)
})

test('info and warn are NOT routed to Error Reporting', async () => {
  const records = await capture(PROD, (logger) => {
    logger.info('message.sent', { conversationId: 'c1' })
    logger.warn('notes.nightly.storage_drift', { orphans: 3 })
  })

  assert.equal(records[0].severity, 'INFO')
  assert.equal(records[1].severity, 'WARNING')
  for (const r of records) {
    // A warn is the app working as designed. Reporting it would bury the real
    // failures in the same feed.
    assert.equal(r['@type'], undefined)
    assert.equal(r.serviceContext, undefined)
  }
})

test('a trace name is built only when it can be fully qualified', async () => {
  const { traceFieldFrom } = await import('@/lib/logger')
  const HEADER = '105445aa7843bc8bf206b12000100000/1;o=1'

  // Off Cloud Run there is no project to qualify the trace with. Omitting the
  // field is right; emitting a half-formed resource name is not.
  delete process.env.GOOGLE_CLOUD_PROJECT
  assert.equal(traceFieldFrom(HEADER), null)

  process.env.GOOGLE_CLOUD_PROJECT = 'visvine-platform'
  try {
    assert.equal(
      traceFieldFrom(HEADER),
      'projects/visvine-platform/traces/105445aa7843bc8bf206b12000100000',
    )
    assert.equal(traceFieldFrom(null), null)
    // Junk in a caller-supplied header must not become a malformed name.
    assert.equal(traceFieldFrom('not-a-trace/1'), null)
    assert.equal(traceFieldFrom('/1;o=1'), null)
  } finally {
    delete process.env.GOOGLE_CLOUD_PROJECT
  }
})

test('the trace lands on the record under the key Cloud Logging reads', async () => {
  const [record] = await capture({ ...PROD, GOOGLE_CLOUD_PROJECT: 'visvine-platform' }, (logger) => {
    logger.error('next.request.route_failed', {
      err: new Error('nope'),
      trace: 'projects/visvine-platform/traces/abc',
    })
  })

  assert.equal(record['logging.googleapis.com/trace'], 'projects/visvine-platform/traces/abc')
  // The raw field is consumed, not duplicated.
  assert.equal(record.trace, undefined)
})
