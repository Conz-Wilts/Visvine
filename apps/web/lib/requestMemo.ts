// Per-request memoization for server reads.
//
// React's `cache()` only dedupes inside a React render pass; in a Route Handler
// it is a no-op, so the auth gates (space row, alias rows, membership) were
// re-queried by every helper in the chain. Next hands out ONE headers object per
// request, so that object is the request's identity: results live in a WeakMap
// keyed on it and are collected with the request. Outside a request scope
// (`headers()` throws — the agent tick, scripts, tests) the function simply runs.
//
// Only reads that are stable for the life of one request belong here. A handler
// that writes what it memoized must call `.forget(...)` before reading again.
// Some requests are long — the agent tick holds one for up to half an hour — so
// an entry also expires after MAX_AGE_MS, which keeps an authority read from
// outliving a membership change made while such a request runs.

import { headers } from 'next/headers'

type Entry = { at: number; value: Promise<unknown> }
type Store = Map<string, Entry>
const MAX_AGE_MS = 5_000
const stores = new WeakMap<object, Store>()

async function requestStore(): Promise<Store | null> {
  let key: object
  try {
    key = await headers()
  } catch {
    return null
  }
  let store = stores.get(key)
  if (!store) {
    store = new Map()
    stores.set(key, store)
  }
  return store
}

type Primitive = string | number | boolean | null | undefined

export interface RequestMemoized<A extends Primitive[], R> {
  (...args: A): Promise<R>
  /** Drop the memoized value for these arguments in the current request. */
  forget(...args: A): Promise<void>
}

export function requestMemo<A extends Primitive[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): RequestMemoized<A, R> {
  const keyOf = (args: A) => `${name} ${JSON.stringify(args)}`
  const memoized = (async (...args: A): Promise<R> => {
    const store = await requestStore()
    if (!store) return fn(...args)
    const key = keyOf(args)
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.value as Promise<R>
    const pending = fn(...args)
    store.set(key, { at: Date.now(), value: pending })
    // A rejected read is not a fact about the request: let the next caller retry.
    pending.catch(() => store.delete(key))
    return pending
  }) as RequestMemoized<A, R>
  memoized.forget = async (...args: A) => {
    const store = await requestStore()
    store?.delete(keyOf(args))
  }
  return memoized
}
