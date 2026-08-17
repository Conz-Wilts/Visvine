/**
 * Values crossing the isolate boundary, and secrets not crossing back.
 *
 * Two rules govern everything here:
 *
 *   • Nothing is passed by reference. A host object handed into the isolate
 *     would be a hole straight through the boundary, so every value is rebuilt
 *     from JSON-shaped parts on the far side. That is also why the caps below
 *     exist in BOTH directions: isolate code can build a 10M-element array and
 *     hand it to a host function just as easily as an upstream can return one.
 *
 *   • Redaction runs on data, never on text that has to be re-parsed. The v1
 *     MCP executor redacted by `JSON.parse(redactSecrets(JSON.stringify(x)))`,
 *     which is unsound: a secret ending in a backslash serialises with that
 *     backslash escaped, the raw variant matches the first of the pair, and the
 *     survivor escapes the closing quote — `JSON.parse` then throws and the
 *     whole call dies. Walking the structure has no such failure mode, keeps
 *     types intact, and doesn't double peak memory.
 */
import { redactSecrets } from './config'

/** Structural limits, applied identically in both directions. */
export const MARSHAL_LIMITS = {
  /** Nesting past this is replaced with a marker rather than followed. */
  maxDepth: 64,
  /** Total values visited before the rest of the structure is dropped. */
  maxNodes: 100_000,
  /** Longest single string kept intact. */
  maxStringChars: 256 * 1024,
} as const

const TRUNCATED = '[truncated]'

/** What a walk had to give up on, so the caller can set `truncated`. */
export interface MarshalReport {
  truncated: boolean
}

/**
 * JSON-shaped deep copy with depth, node and string caps. Anything JSON can't
 * carry (functions, symbols, undefined) becomes undefined in an object — the
 * same thing JSON.stringify does — and null in an array, so positions hold.
 *
 * Cycles cannot survive: a repeated reference is followed until the depth cap
 * stops it, and the seen-set catches the common self-referential case first so
 * the usual shapes report cleanly rather than exhausting the node budget.
 */
export function marshalValue(
  value: unknown,
  report: MarshalReport = { truncated: false },
  redact: readonly string[] = [],
): unknown {
  return walk(value, 0, report, new WeakSet(), { count: 0 }, redact)
}

function walk(
  value: unknown,
  depth: number,
  report: MarshalReport,
  seen: WeakSet<object>,
  nodes: { count: number },
  redact: readonly string[],
): unknown {
  if (++nodes.count > MARSHAL_LIMITS.maxNodes) {
    report.truncated = true
    return TRUNCATED
  }
  if (value === null) return null

  switch (typeof value) {
    case 'boolean':
      return value
    case 'number':
      // NaN and ±Infinity have no JSON form; null is what stringify picks.
      return Number.isFinite(value) ? value : null
    case 'bigint':
      return value.toString()
    case 'string': {
      // Redact BEFORE capping: a secret straddling the cap boundary would
      // otherwise leave its prefix in the truncated string.
      const text = redactSecrets(value, redact)
      if (text.length > MARSHAL_LIMITS.maxStringChars) {
        report.truncated = true
        return text.slice(0, MARSHAL_LIMITS.maxStringChars)
      }
      return text
    }
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }

  const obj = value as object
  if (depth >= MARSHAL_LIMITS.maxDepth) {
    report.truncated = true
    return TRUNCATED
  }
  if (seen.has(obj)) {
    report.truncated = true
    return TRUNCATED
  }
  seen.add(obj)
  try {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    if (Array.isArray(value)) {
      // Array holes and unserialisable entries both become null so indices hold.
      return value.map((v) => walk(v, depth + 1, report, seen, nodes, redact) ?? null)
    }
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const marshalled = walk(v, depth + 1, report, seen, nodes, redact)
      if (marshalled !== undefined) out[key] = marshalled
    }
    return out
  } finally {
    // Sibling references to one object are fine — only ancestors are cycles.
    seen.delete(obj)
  }
}

/**
 * Replace every occurrence of each secret value inside a marshalled structure.
 * Strings go through `redactSecrets`; numbers and booleans are left alone,
 * because a secret is never a number and shredding digits would corrupt data
 * for nothing.
 *
 * Object KEYS are redacted too. A key containing a credential is already
 * pathological, but leaving it would defeat the whole point of this pass.
 */
export function redactDeep(value: unknown, values: readonly string[]): unknown {
  if (values.length === 0) return value
  return redactWalk(value, values, 0)
}

function redactWalk(value: unknown, values: readonly string[], depth: number): unknown {
  if (typeof value === 'string') return redactSecrets(value, values)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MARSHAL_LIMITS.maxDepth) return TRUNCATED
  if (Array.isArray(value)) return value.map((v) => redactWalk(v, values, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[redactSecrets(key, values)] = redactWalk(v, values, depth + 1)
  }
  return out
}
