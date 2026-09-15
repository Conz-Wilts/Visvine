import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedFetch, inflightFetch, invalidateRequestCache, invalidateRequestCachePrefix,
  peekRequestCache, primeRequestCache, swrFetch, watchRequestCache,
} from '@/features/shared/lib/requestCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('slow reads remain shared and become fresh when they finish', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const key = t.name
  const read = deferred<string>()
  const first = cachedFetch(key, () => read.promise)
  now = 61_000
  assert.equal(cachedFetch(key, () => Promise.resolve('duplicate')), first)
  read.resolve('fresh')
  await first
  now = 90_000
  assert.equal(await cachedFetch(key, () => Promise.resolve('duplicate')), 'fresh')
  invalidateRequestCache(key)
})

test('concurrent revalidation paints stale data for every panel and fetches once', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const key = t.name
  primeRequestCache(key, 'old')
  now = 61_000
  const read = deferred<string>()
  let calls = 0
  const fetch = () => { calls++; return read.promise }
  const a: string[] = []
  const b: string[] = []
  const first = swrFetch(key, fetch, (value) => a.push(value))
  const second = swrFetch(key, fetch, (value) => b.push(value))
  assert.deepEqual(a, ['old'])
  assert.deepEqual(b, ['old'])
  assert.equal(peekRequestCache(key), 'old')
  assert.equal(calls, 1)
  read.resolve('new')
  await Promise.all([first, second])
  assert.deepEqual(a, ['old', 'new'])
  assert.deepEqual(b, ['old', 'new'])
  invalidateRequestCache(key)
})

test('failed revalidation retains stale data but retries on the next read', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const key = t.name
  primeRequestCache(key, 'old')
  now = 61_000
  assert.equal(await swrFetch(key, async () => { throw new Error('offline') }, () => {}), 'old')
  assert.equal(peekRequestCache(key), 'old')
  const values: string[] = []
  await swrFetch(key, async () => 'new', (value) => values.push(value))
  assert.deepEqual(values, ['old', 'new'])
  invalidateRequestCache(key)
})

test('expired stale data is not retained after a failed refresh', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const key = t.name
  primeRequestCache(key, 'old')
  now = 600_000
  await assert.rejects(swrFetch(key, async () => { throw new Error('offline') }, () => {}), /offline/)
  assert.equal(peekRequestCache(key), undefined)
  assert.equal(await cachedFetch(key, async () => 'new'), 'new')
  invalidateRequestCache(key)
})

for (const prefix of [false, true]) {
  test(`invalidation detaches pending reads before notifying watchers (prefix=${prefix})`, async (t) => {
    const key = `${t.name}/list`
    const old = deferred<string>()
    const fresh = deferred<string>()
    const first = inflightFetch(key, () => old.promise)
    let next: Promise<string> | undefined
    const unsubscribe = watchRequestCache([key], () => {
      next = inflightFetch(key, () => fresh.promise)
    })
    if (prefix) invalidateRequestCachePrefix(t.name)
    else invalidateRequestCache(key)
    assert.ok(next)
    assert.notEqual(next, first)
    old.resolve('old')
    await first
    assert.equal(inflightFetch(key, async () => 'duplicate'), next)
    fresh.resolve('new')
    assert.equal(await next, 'new')
    unsubscribe()
  })
}

test('prefix invalidation includes unwatched in-flight keys and notifies shared watchers once', async (t) => {
  const firstKey = `${t.name}/first`
  const secondKey = `${t.name}/second`
  primeRequestCache(firstKey, 'old')
  const old = deferred<string>()
  const first = inflightFetch(secondKey, () => old.promise)
  let notifications = 0
  const unsubscribe = watchRequestCache([firstKey, `${t.name}/third`], () => notifications++)
  invalidateRequestCachePrefix(t.name)
  assert.equal(notifications, 1)
  assert.equal(peekRequestCache(firstKey), undefined)
  assert.equal(await inflightFetch(secondKey, async () => 'new'), 'new')
  old.resolve('old')
  await first
  unsubscribe()
})

test('invalidated reads cannot replace newly primed values when they settle', async (t) => {
  const key = t.name
  const old = deferred<string>()
  const first = cachedFetch(key, () => old.promise)
  invalidateRequestCache(key)
  primeRequestCache(key, 'new')
  old.reject(new Error('old request failed'))
  await assert.rejects(first, /old request failed/)
  assert.equal(peekRequestCache(key), 'new')
  invalidateRequestCache(key)
})
