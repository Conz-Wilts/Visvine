/**
 * Running one `data.js` handler.
 *
 * `data.js` is the half of a Tool that should not happen in the viewer's
 * browser: a connector call with a large response, a sweep over many notes, a
 * computation the laptop would rather not do. It runs in the SAME QuickJS
 * isolate connectors and agents use (lib/connectors/isolate.ts), with the
 * network capabilities taken away and the bridge's own handlers put in their
 * place — so a handler reaches exactly what the frame reaches, through the same
 * perimeter, and nothing more.
 *
 * What the isolate sees:
 *
 *   handlers   the object data.js assigns onto (`handlers.summary = …`)
 *   args       the marshalled call arguments
 *   visvine    the bridge capabilities, as `visvine.context.read(path)` etc.
 *   subject    what the Tool is being shown about, or null
 *   install    which Tool this is
 *   sleep      the isolate's own bounded pause; `fetch`/`sql`/`mcp` are ABSENT
 *
 * `fetch` is omitted rather than gated: a Tool's egress is a connector, which is
 * declared, reviewable and secret-bearing. Leaving a raw fetch in would let any
 * installed Tool post the space's notes anywhere, with nothing in the frontmatter
 * to show for it.
 *
 * Capabilities are INJECTED rather than imported, which keeps this file free of
 * the bridge (no import cycle) and lets a test run a real isolate against a fake
 * `context.read`.
 */
import { runInIsolate, type IsolateRunResult } from '@/lib/connectors/isolate'
import { marshalValue } from '@/lib/connectors/marshal'
import { BRIDGE_LIMITS, type BridgeResponse } from './protocol'
import type { ResolvedTarget } from './target'

/** The isolate's capability shape: positional args in, a JSON-safe value out. */
export type IsolateCapabilities = Record<string, (args: unknown[]) => Promise<unknown>>

export interface DataRunDeps {
  /** Installed as `visvine.<dotted.key>` — the bridge passes its own handlers. */
  capabilities?: IsolateCapabilities
  /** The isolate runner, injectable so a test can assert what it was handed. */
  run?: typeof runInIsolate
}

/** A JS identifier, which is what `handlers.<name> = …` can actually define. */
const HANDLER_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/

/**
 * Sentinels for the two failures that are worth their own error code. Both are
 * thrown INSIDE the isolate, so the only thing that crosses back is the message
 * — matching on it is how the code is recovered.
 */
const NO_HANDLER_PREFIX = 'no data.js handler named '
/** Every perimeter refusal starts here (lib/tools/perimeter.ts#refuse). */
const PERIMETER_PREFIX = 'tool perimeter denied:'

/**
 * A JSON value as a JS literal safe to paste into source. U+2028/U+2029 are
 * legal inside a JSON string but are line terminators to some parsers, so they
 * are escaped rather than embedded.
 */
function jsLiteral(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) return 'undefined'
  return json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * The script the isolate evaluates. runInIsolate already wraps this in an async
 * IIFE, so `return` and top-level `await` both work.
 *
 * The prelude is one line on purpose: `data.js` diagnostics are the author's,
 * and a multi-line preamble would shift every line number in the stack traces
 * they read.
 */
function isolateSource(dataBundle: string, fn: string, args: unknown): string {
  const name = jsLiteral(fn)
  const prelude =
    `const handlers = Object.create(null), args = ${jsLiteral(args)}, ` +
    `visvine = globalThis.visvine ?? Object.create(null);`
  const call =
    `;if (typeof handlers[${name}] !== 'function') ` +
    `throw new Error(${jsLiteral(NO_HANDLER_PREFIX)} + ${name});\n` +
    `return await handlers[${name}](args, visvine)`
  return `${prelude}\n${dataBundle}\n${call}`
}

/** A finished isolate run → the bridge's answer. */
function responseOf(result: IsolateRunResult, fn: string): BridgeResponse {
  if (result.timedOut) {
    return {
      ok: false,
      error: {
        code: 'timeout',
        message: `data.js handler "${fn}" ran longer than ${Math.round(
          BRIDGE_LIMITS.dataCallTimeoutMs / 1000,
        )}s and was stopped.`,
      },
    }
  }
  if (result.ok) return { ok: true, value: result.value }

  // A denial recorded by the gate outranks whatever the code then threw: the
  // refusal is the cause, and a handler that swallowed it in a catch would
  // otherwise report its own confusion instead.
  if (result.denials.length > 0) {
    return { ok: false, error: { code: 'perimeter', message: result.denials[0] } }
  }
  const message = result.error?.message ?? 'the handler failed'
  if (message.startsWith(PERIMETER_PREFIX)) {
    return { ok: false, error: { code: 'perimeter', message } }
  }
  if (message.startsWith(NO_HANDLER_PREFIX)) {
    return {
      ok: false,
      error: { code: 'not_found', message: `${message} — data.js defines no such handler.` },
    }
  }
  // Not `internal`: the isolate did its job and the Tool's own code threw. The
  // author is the one who can fix it, so they get the message verbatim.
  return { ok: false, error: { code: 'invalid', message: `data.js handler "${fn}" failed: ${message}` } }
}

/**
 * Run `handlers[fn](args, visvine)` in the isolate and shape the outcome as a
 * BridgeResponse. Never throws: a host failure is an `internal` error like any
 * other refusal, because the frame has one way to hear about anything.
 */
export async function runDataHandler(
  t: ResolvedTarget,
  fn: string,
  args: unknown,
  deps: DataRunDeps = {},
): Promise<BridgeResponse> {
  if (!HANDLER_NAME_RE.test(fn)) {
    return { ok: false, error: { code: 'invalid', message: `"${fn}" is not a handler name.` } }
  }
  if (!t.dataBundle.trim()) {
    return {
      ok: false,
      error: { code: 'not_found', message: 'This tool has no data.js, so there is nothing to call.' },
    }
  }

  const run = deps.run ?? runInIsolate
  try {
    const result = await run(
      // No hosts, no allow rules, no env: with fetch/sql/mcp omitted there is no
      // egress for the gate to judge. The perimeter that matters to a Tool is
      // applied inside the capabilities, one call at a time.
      { hosts: [], allow: [], allowPrivate: false, env: {}, timeoutMs: BRIDGE_LIMITS.dataCallTimeoutMs },
      isolateSource(t.dataBundle, fn, marshalValue(args)),
      {
        omitDefaults: ['fetch', 'sql', 'mcp'],
        capabilities: deps.capabilities ?? {},
        globals: { subject: t.subject, install: t.install },
      },
    )
    return responseOf(result, fn)
  } catch (e) {
    console.error('[tools] data.call failed', e)
    return { ok: false, error: { code: 'internal', message: 'The data handler could not be run.' } }
  }
}
