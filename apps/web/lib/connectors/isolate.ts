/**
 * The connector runtime: one QuickJS isolate per run, holding the connector's
 * secrets and nothing else of ours.
 *
 * This replaces the v2 sandboxed shell. The shell needed a microVM to be safe
 * in production, because a bash command can open a raw socket and ignore any
 * proxy we ask it to use. Isolate code cannot: it has no sockets, no
 * filesystem, and no host objects at all. Its ONLY way out is the capability
 * functions installed below, each of which judges the request against the
 * note's perimeter before anything leaves the process.
 *
 * That inversion is also what makes `allow:` rules real. Under the proxy,
 * HTTPS was an opaque CONNECT tunnel, so method and path were invisible and the
 * rules went unenforced. Here the request is an argument.
 *
 * What the isolate can reach, in full:
 *   env      frozen strings — the connector's resolved secrets
 *   fetch    hostFetch, perimeter-gated
 *   sql      hostSql, perimeter-gated, read-only
 *   mcp      hostMcp, built on hostFetch so it inherits the same gate
 *   sleep    a pause bounded by the run deadline, for backing off a 429
 *   console  log/warn/error into a capped buffer
 *
 * Everything else standard JS provides (Date, JSON, Math, RegExp, Proxy…) is
 * pure computation and stays. `process`, `require`, `import`, timers, Buffer
 * and the real `fetch` are absent by construction — tests assert each one.
 */
import { newQuickJSWASMModuleFromVariant, Scope } from 'quickjs-emscripten-core'
import type {
  QuickJSContext,
  QuickJSRuntime,
  QuickJSWASMModule,
  QuickJSHandle,
} from 'quickjs-emscripten-core'
import releaseVariant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { ConnectorError, redactSecrets, SANDBOX_LIMITS } from './config'
import { MAX_DENIALS, type GatePerimeter } from './perimeter'
import { marshalValue, redactDeep, type MarshalReport } from './marshal'
import { hostFetch, hostSleep, type HostContext } from './hostFetch'
import { hostSql } from './hostSql'
import { mcpCallTool, mcpListTools } from './hostMcp'
import type { AllowRule } from './config'

/** Memory and stack ceilings for one run. Generous against a 256KB output cap. */
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024
const MAX_STACK_BYTES = 1024 * 1024

/**
 * Concurrent runs allowed process-wide.
 *
 * Under the shell each run was its own OS process; now every run is CPU and
 * heap inside the one Node process that also serves every HTTP request. This
 * is the backstop against a handful of connector calls starving the app.
 */
const MAX_CONCURRENT_RUNS = 4

export interface SandboxPerimeter extends GatePerimeter {
  /** Already-resolved env vars — secret VALUES, visible only inside the run. */
  env: Readonly<Record<string, string>>
  timeoutMs: number
  allow: readonly AllowRule[]
}

export interface IsolateRunResult {
  /** True when the code finished without an uncaught error and without timing out. */
  ok: boolean
  /** Whatever the code returned, marshalled to JSON-safe data. */
  value: unknown
  /** console.log/warn/error, in emission order, capped. */
  logs: string
  error: { name: string; message: string; stack: string | null } | null
  truncated: boolean
  timedOut: boolean
  /** Perimeter refusals — from fetch and sql alike. */
  denials: string[]
  durationMs: number
}

export interface IsolateRunOptions {
  /**
   * Values to scrub from everything the run emits — pass the secret plaintexts,
   * not every env value (redacting a literal like "on" would riddle ordinary
   * output with holes).
   */
  redact?: readonly string[]
}

function clampTimeout(ms: number): number {
  const { min, max, default: dflt } = SANDBOX_LIMITS.timeoutMs
  const n = Number.isFinite(ms) ? Math.floor(ms) : dflt
  return Math.min(max, Math.max(min, n))
}

// ── the WASM module, loaded once ──────────────────────────────────────────────
// The singlefile CJS variant base64-inlines its wasm, so there is no sidecar
// file for `output: "standalone"` to fail to trace. That is the whole reason
// this variant is pinned rather than the meta-package's default.

let modulePromise: Promise<QuickJSWASMModule> | null = null

function quickjsModule(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(releaseVariant)
  return modulePromise
}

// ── concurrency gate ──────────────────────────────────────────────────────────

let running = 0
const waiting: Array<() => void> = []

async function acquireSlot(): Promise<() => void> {
  if (running >= MAX_CONCURRENT_RUNS) {
    // Queue rather than refuse: a connector call is already slow enough that
    // waiting behind three others beats failing outright.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  running++
  let released = false
  return () => {
    if (released) return
    released = true
    running--
    waiting.shift()?.()
  }
}

// ── value bridge ──────────────────────────────────────────────────────────────

/**
 * `undefined`, `true` and `false` are singletons owned by the context. They are
 * handed out, never handed back: disposing one, or letting the isolate take
 * ownership of one, drops a reference nobody held and aborts the whole runtime
 * on a refcount assertion.
 */
function isSingleton(ctx: QuickJSContext, h: QuickJSHandle): boolean {
  return h === ctx.undefined || h === ctx.true || h === ctx.false || h === ctx.null
}

/**
 * Build an isolate-side value from host data. Only JSON shapes cross; anything
 * else has already been flattened by marshalValue.
 *
 * The returned handle is OWNED by the caller, which must either dispose it or
 * hand it to the isolate as a capability's return value. Children are disposed
 * here as they go, because `setProp` takes its own reference — holding them in
 * a scope instead means the same value is managed twice, and the second host
 * call in a run trips over it.
 */
function toHandle(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return ctx.undefined
  switch (typeof value) {
    case 'boolean':
      return value ? ctx.true : ctx.false
    case 'number':
      return ctx.newNumber(value)
    case 'string':
      return ctx.newString(value)
  }
  if (Array.isArray(value)) {
    const arr = ctx.newArray()
    value.forEach((item, i) => {
      const h = toHandle(ctx, item)
      ctx.setProp(arr, String(i), h)
      if (!isSingleton(ctx, h)) h.dispose()
    })
    return arr
  }
  const obj = ctx.newObject()
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    const h = toHandle(ctx, v)
    ctx.setProp(obj, key, h)
    if (!isSingleton(ctx, h)) h.dispose()
  }
  return obj
}

/**
 * Work a host capability has started and not yet finished. The driver loop
 * waits on these; without it, it would spin the job queue against an isolate
 * that has nothing left to do until a fetch comes back.
 */
type PendingWork = Set<Promise<unknown>>

/**
 * Install one async capability.
 *
 * The isolate gets a normal function that returns a promise. The host resolves
 * that promise later and pumps the job queue, which is what lets the isolate's
 * `await` continue.
 *
 * This deliberately does NOT use the asyncify transform, which suspends the VM
 * and unwinds the WASM stack for the duration of a host call. Asyncify breaks
 * down after two or three suspensions in one run — as a refcount abort, an
 * out-of-bounds access, or a wrong value, depending on the shape of the code —
 * and connectors need many calls (an OAuth dance is two before it does anything
 * useful; pagination is unbounded). Deferred promises have no such limit, and
 * as a bonus `Promise.all` is genuinely concurrent rather than serialised.
 */
function installCapability(
  ctx: QuickJSContext,
  scope: Scope,
  name: string,
  pending: PendingWork,
  impl: (args: unknown[]) => Promise<unknown>,
): void {
  const fn = ctx.newFunction(name, (...argHandles) => {
    const args = argHandles.map((h) => ctx.dump(h))
    const deferred = ctx.newPromise()

    const work = impl(args).then(
      (result) => {
        const h = toHandle(ctx, marshalValue(result))
        deferred.resolve(h)
        if (!isSingleton(ctx, h)) h.dispose()
      },
      (e: unknown) => {
        // Reject with a real Error so connector code can `catch (e)` and read
        // `e.message` — that message is how a perimeter refusal explains itself.
        const message = e instanceof Error ? e.message : String(e)
        const h = ctx.newError(message)
        deferred.reject(h)
        h.dispose()
      },
    )
    pending.add(work)
    void work.finally(() => pending.delete(work))
    // Settling enqueues the isolate's continuation; something has to run it.
    void deferred.settled.then(() => ctx.runtime.executePendingJobs())
    return deferred.handle
  })
  ctx.setProp(ctx.global, name, fn)
  // Deliberately NOT disposed here. The handle owns the host reference the WASM
  // side calls back through; dropping it works for the first call or two and
  // then fails once the reference is collected — as a refcount abort or an
  // out-of-bounds access, never as anything that names the cause. The scope
  // releases it when the run ends.
  scope.manage(fn)
}

/**
 * Pure-JS shims for the two web globals a connector reliably reaches for.
 *
 * QuickJS is an ECMAScript engine, not a browser: `URLSearchParams` and `URL`
 * are web platform APIs and simply aren't there. Every OAuth example ever
 * written builds its form body with `new URLSearchParams(...)`, so leaving
 * that out means every model's first attempt fails on a missing global rather
 * than on anything real.
 *
 * These are ordinary objects defined inside the isolate — no host access, no
 * capability, nothing to gate. They are conveniences, not doors.
 */
const PRELUDE = `
globalThis.URLSearchParams = class URLSearchParams {
  #pairs = []
  constructor(init) {
    if (typeof init === 'string') {
      for (const part of init.replace(/^\\?/, '').split('&')) {
        if (!part) continue
        const eq = part.indexOf('=')
        const k = eq === -1 ? part : part.slice(0, eq)
        const v = eq === -1 ? '' : part.slice(eq + 1)
        this.#pairs.push([decode(k), decode(v)])
      }
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) this.#pairs.push([String(k), String(v)])
    } else if (init && typeof init === 'object') {
      for (const k of Object.keys(init)) this.#pairs.push([k, String(init[k])])
    }
  }
  append(k, v) { this.#pairs.push([String(k), String(v)]) }
  set(k, v) {
    const i = this.#pairs.findIndex((p) => p[0] === String(k))
    if (i === -1) this.append(k, v)
    else { this.#pairs[i][1] = String(v); this.#pairs = this.#pairs.filter((p, j) => j <= i || p[0] !== String(k)) }
  }
  get(k) { const p = this.#pairs.find((p) => p[0] === String(k)); return p ? p[1] : null }
  getAll(k) { return this.#pairs.filter((p) => p[0] === String(k)).map((p) => p[1]) }
  has(k) { return this.#pairs.some((p) => p[0] === String(k)) }
  delete(k) { this.#pairs = this.#pairs.filter((p) => p[0] !== String(k)) }
  keys() { return this.#pairs.map((p) => p[0])[Symbol.iterator]() }
  values() { return this.#pairs.map((p) => p[1])[Symbol.iterator]() }
  entries() { return this.#pairs.map((p) => [p[0], p[1]])[Symbol.iterator]() }
  forEach(fn, thisArg) { for (const [k, v] of this.#pairs) fn.call(thisArg, v, k, this) }
  [Symbol.iterator]() { return this.entries() }
  get size() { return this.#pairs.length }
  toString() { return this.#pairs.map(([k, v]) => encode(k) + '=' + encode(v)).join('&') }
}

// application/x-www-form-urlencoded: percent-encoding with space as '+'.
function encode(s) {
  return encodeURIComponent(String(s)).replace(/%20/g, '+').replace(/[!'()~]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
function decode(s) {
  try { return decodeURIComponent(String(s).replace(/\\+/g, ' ')) } catch { return String(s) }
}
`

// ── the run ───────────────────────────────────────────────────────────────────

/**
 * Run one connector script inside its perimeter, with secret values redacted
 * out of everything that comes back. Belt and braces on top of "secrets only
 * exist inside the isolate": code that returns its own env, or an upstream that
 * reflects a header, still can't show the model a credential.
 */
export async function runInIsolate(
  perimeter: SandboxPerimeter,
  code: string,
  options: IsolateRunOptions = {},
): Promise<IsolateRunResult> {
  const started = Date.now()
  const timeoutMs = clampTimeout(perimeter.timeoutMs)
  const deadline = started + timeoutMs
  const redact = options.redact ?? Object.values(perimeter.env)

  const release = await acquireSlot()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()

  const denials: string[] = []
  const logs: string[] = []
  const report: MarshalReport = { truncated: false }
  let logBytes = 0
  let timedOut = false

  const ctxShared: HostContext = {
    perimeter,
    redact,
    deadline,
    signal: controller.signal,
    deny(reason) {
      if (denials.length < MAX_DENIALS) denials.push(reason)
      return reason
    },
  }

  try {
    const wasm = await quickjsModule()
    // newContext() rather than newRuntime()+newContext(): the context then owns
    // its runtime and one dispose() unwinds both in the right order. Owning the
    // runtime separately means disposing it after the context, which frees the
    // host references behind our capability functions once the runtime they
    // belong to is already deregistered — an abort inside WASM, not an
    // exception we could handle.
    const ctx = wasm.newContext() as QuickJSContext
    const runtime = ctx.runtime
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
    runtime.setMaxStackSize(MAX_STACK_BYTES)
    // The only thing that stops a busy loop or a catastrophic regex. It
    // cannot fire while suspended in a host call, which is why the abort
    // signal above exists as well — the two together cover both states.
    runtime.setInterruptHandler(() => Date.now() > deadline)

    try {
      return await Scope.withScopeAsync(async (scope) => {
      const pending: PendingWork = new Set()

      // env — frozen so code can't confuse itself, though nothing depends on it.
      {
        const envHandle = toHandle(ctx, { ...perimeter.env })
        ctx.setProp(ctx.global, 'env', envHandle)
        envHandle.dispose()
      }
      ctx.unwrapResult(ctx.evalCode('Object.freeze(globalThis.env)')).dispose()

      // console — a capped buffer, not a stream. Output is a run artifact.
      {
        // Same lifetime rule as the capabilities: these handles own the host
        // references QuickJS calls back through, so they live as long as the
        // context does. The run's scope releases them at the end.
        const consoleObj = scope.manage(ctx.newObject())
        for (const level of ['log', 'warn', 'error'] as const) {
          const fn = scope.manage(
            ctx.newFunction(level, (...args) => {
              const line = args
                .map((h) => {
                  const v = ctx.dump(h)
                  return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)
                })
                .join(' ')
              const remaining = SANDBOX_LIMITS.outputCapBytes - logBytes
              if (remaining <= 0) {
                report.truncated = true
                return ctx.undefined
              }
              // Redact before the cap so a secret cut by it can't leak its head.
              const safe = redactSecrets(line, redact)
              const text = safe.length > remaining ? safe.slice(0, remaining) : safe
              if (text.length < line.length) report.truncated = true
              logs.push(text)
              logBytes += text.length + 1
              return ctx.undefined
            }),
          )
          ctx.setProp(consoleObj, level, fn)
        }
        ctx.setProp(ctx.global, 'console', consoleObj)
      }

      installCapability(ctx, scope, 'fetch', pending, (args) => hostFetch(ctxShared, args[0], (args[1] ?? {}) as never))
      installCapability(ctx, scope, 'sql', pending, (args) => hostSql(ctxShared, args[0], args[1]))
      // Not a timer: it cannot schedule anything, only pause inside the run's
      // own deadline. Backing off a 429 is otherwise impossible to write.
      installCapability(ctx, scope, 'sleep', pending, (args) => hostSleep(ctxShared, args[0]))
      installCapability(ctx, scope, '__mcpListTools', pending, (args) => mcpListTools(ctxShared, args[0], args[1]))
      installCapability(ctx, scope, '__mcpCallTool', pending, (args) =>
        mcpCallTool(ctxShared, args[0], args[1], args[2], args[3]),
      )
      // mcp(url, headers?) — a namespace built in-isolate over the two calls
      // above, so no host object ever crosses the boundary.
      ctx.unwrapResult(
        ctx.evalCode(`globalThis.mcp = (url, headers) => ({
          listTools: () => __mcpListTools(url, headers),
          callTool: (name, args) => __mcpCallTool(url, name, args, headers),
        })`),
      ).dispose()

      ctx.unwrapResult(ctx.evalCode(PRELUDE)).dispose()

      // No module loader is installed, so `import` is a non-starter. Wrapping
      // in an async IIFE is what gives top-level await without needing one.
      const wrapped = `(async () => {\n${code}\n})()`

      let value: unknown
      let error: IsolateRunResult['error'] = null
      try {
        // Sync eval: the async IIFE runs to its first await and hands back a
        // promise. Everything after that is driven by the loop below.
        const evaluated = ctx.evalCode(wrapped)
        if (evaluated.error) {
          const dumped = ctx.dump(evaluated.error)
          evaluated.error.dispose()
          error = toRunError(dumped)
        } else {
          const promise = evaluated.value
          const settling = ctx.resolvePromise(promise)
          let settled = false
          void settling.finally(() => {
            settled = true
          })

          // The driver. Each pass runs whatever the isolate has queued, then
          // waits for the earliest outstanding host call to come back. When
          // nothing is queued and nothing is outstanding, the run is as far
          // along as it will ever get.
          while (!settled) {
            drainJobs(runtime)
            if (settled) break
            if (Date.now() > deadline) {
              timedOut = true
              break
            }
            if (pending.size === 0) break
            await Promise.race([...pending, deadlineTick(deadline)])
          }
          // Only when the run finished on its own. Pumping the queue after a
          // timeout — with a promise that will never settle still resolved
          // against — leaves objects alive that JS_FreeRuntime then asserts on,
          // which aborts the process rather than failing the run.
          if (!timedOut) {
            drainJobs(runtime)
            const resolved = await settling
            if (resolved.error) {
              const dumped = ctx.dump(resolved.error)
              resolved.error.dispose()
              error = toRunError(dumped)
            } else {
              value = marshalValue(ctx.dump(resolved.value), report, redact)
              resolved.value.dispose()
            }
          }
          // After the settled value, not before: it is reachable through the
          // promise, and dropping the promise first can leave it dangling.
          promise.dispose()
        }
      } catch (e) {
        // An interrupt unwinds out here rather than arriving as a QuickJS error.
        if (Date.now() > deadline || controller.signal.aborted) {
          timedOut = true
        } else if (e instanceof ConnectorError) {
          throw e
        } else {
          error = toRunError(e)
        }
      }

      if (Date.now() > deadline) timedOut = true

      return {
        ok: !timedOut && error === null,
        value: redactDeep(value, redact),
        logs: redactSecrets(logs.join('\n'), redact),
        error: error
          ? {
              name: redactSecrets(error.name, redact),
              message: redactSecrets(error.message, redact),
              stack: error.stack ? redactSecrets(error.stack, redact) : null,
            }
          : null,
        truncated: report.truncated,
        timedOut,
        denials: denials.map((d) => redactSecrets(d, redact)),
        durationMs: Date.now() - started,
      }
      })
    } finally {
      // Drop the interrupt first so it cannot re-fire mid-teardown.
      runtime.removeInterruptHandler()
      try {
        // Drops the runtime with it, which is why the context owns it.
        ctx.dispose()
      } catch {
        // An interrupted run can leave QuickJS holding live objects that
        // JS_FreeRuntime asserts on — and that assertion aborts the WASM module,
        // not just this context. Leaking one context is bounded and survivable;
        // taking the process down is not. Drop the cached module so the next run
        // builds a clean one rather than inheriting a poisoned heap.
        modulePromise = null
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
    release()
  }
}

/** Resolves when the run's clock runs out, so the driver can't wait past it. */
function deadlineTick(deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()))
    timer.unref?.()
  })
}

/**
 * Run the VM's microtask queue to exhaustion.
 *
 * QuickJS does not pump its own job queue; that is the host's job, and skipping
 * it leaves a settled-looking promise that never resolves. Each pass can enqueue
 * more jobs, so this loops until a pass does nothing — bounded, because a
 * promise chain that keeps enqueueing forever is isolate code the interrupt
 * handler already owns.
 *
 */
function drainJobs(runtime: QuickJSRuntime): void {
  for (let pass = 0; pass < 1_000; pass++) {
    const executed = runtime.executePendingJobs()
    // A failed pass carries an error handle we neither own nor need: the error
    // reaches the run through the promise it rejected.
    if ('error' in executed && executed.error) {
      executed.error.dispose()
      return
    }
    if (!('value' in executed) || executed.value === 0) return
  }
}

/** Whatever the isolate threw, shaped into the result's error field. */
function toRunError(raw: unknown): IsolateRunResult['error'] {
  if (raw && typeof raw === 'object') {
    const e = raw as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : JSON.stringify(raw) ?? 'Unknown error',
      stack: typeof e.stack === 'string' ? e.stack : null,
    }
  }
  // `throw 42` is legal JS and must not crash the host.
  return { name: 'Error', message: String(raw), stack: null }
}
