/**
 * An action's parameter contract, rendered from its Zod schema.
 *
 * Pure, and deliberately so. This is what keeps the Visvine space's Context honest: the
 * `params:` an action's note advertises are GENERATED from the one schema that
 * actually validates a call, written into the note between machine markers, and
 * regenerated on every sync. Prose an admin writes around the block survives
 * untouched — the same bargain `lib/global/shared/aggregate.ts` strikes with a
 * person's own record — but the contract itself is never hand-written and so
 * can never drift from what the action will accept.
 */
import type { z } from 'zod'

export const CONTRACT_OPEN = '<!-- action:contract -->'
export const CONTRACT_CLOSE = '<!-- /action:contract -->'

export interface ParamDoc {
  name: string
  type: string
  required: boolean
  description: string | null
}

interface ZodInternals {
  type: string
  innerType?: unknown
  element?: unknown
  entries?: Record<string, unknown>
  options?: unknown[]
  valueType?: unknown
  defaultValue?: unknown
  shape?: Record<string, unknown>
}

function internals(schema: unknown): ZodInternals | null {
  const def = (schema as { def?: unknown } | null)?.def
  return def && typeof def === 'object' ? (def as ZodInternals) : null
}

function descriptionOf(schema: unknown): string | null {
  const d = (schema as { description?: unknown } | null)?.description
  return typeof d === 'string' && d.length > 0 ? d : null
}

/**
 * A human-readable type for one schema, unwrapping the wrappers that only say
 * "and it may be absent" — the required/optional split is reported separately,
 * so repeating it inside the type would be noise.
 */
export function typeNameOf(schema: unknown, depth = 0): string {
  const def = internals(schema)
  if (!def || depth > 4) return 'value'
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      return typeNameOf(def.innerType, depth + 1)
    case 'enum':
      return Object.keys(def.entries ?? {})
        .map((v) => `'${v}'`)
        .join(' | ')
    case 'array':
      return `${typeNameOf(def.element, depth + 1)}[]`
    case 'record':
      return `object`
    case 'union':
      return (def.options ?? []).map((o) => typeNameOf(o, depth + 1)).join(' | ')
    case 'object':
      return `{ ${Object.keys(def.shape ?? {}).join(', ')} }`
    case 'unknown':
    case 'any':
      return 'value'
    default:
      return def.type
  }
}

function isOptional(schema: unknown): boolean {
  const def = internals(schema)
  if (!def) return true
  return def.type === 'optional' || def.type === 'default'
}

/**
 * The description, preferring the outermost one. `x.describe('…').optional()`
 * and `x.optional().describe('…')` both read the same way to an author, so both
 * must read the same way here.
 */
function describeChain(schema: unknown, depth = 0): string | null {
  const own = descriptionOf(schema)
  if (own) return own
  const def = internals(schema)
  if (!def || depth > 4) return null
  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') {
    return describeChain(def.innerType, depth + 1)
  }
  return null
}

export function paramsOf(shape: z.ZodRawShape): ParamDoc[] {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    type: typeNameOf(schema),
    required: !isOptional(schema),
    description: describeChain(schema),
  }))
}

export interface ContractInput {
  action: string
  scope: string
  readOnly: boolean
  destructive: boolean
  params: ParamDoc[]
}

/** Escape a cell so a description containing a pipe cannot break the table. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

/**
 * The generated half of an action note: how to call it, and every argument it
 * takes. Wrapped in markers so a sync can replace exactly this and nothing else.
 */
export function renderContract(input: ContractInput): string {
  const lines: string[] = [CONTRACT_OPEN, '']
  lines.push(`**Run it:** \`visvine({ action: "${input.action}", input: { … } })\``)
  lines.push('')
  lines.push(`**Endpoint:** \`POST /api/actions/${input.action}\``)
  lines.push(`**Scope:** \`${input.scope}\``)
  if (input.readOnly) lines.push('**Reads only.** It changes nothing.')
  if (input.destructive) lines.push('**Destructive.** Confirm with the person before calling it.')
  lines.push('')
  if (input.params.length === 0) {
    lines.push('Takes no arguments — call it with `input: {}`.')
  } else {
    lines.push('| Parameter | Type | Required | What it is |')
    lines.push('| --- | --- | --- | --- |')
    for (const p of input.params) {
      lines.push(
        `| \`${p.name}\` | \`${cell(p.type)}\` | ${p.required ? 'yes' : 'no'} | ${
          p.description ? cell(p.description) : '—'
        } |`,
      )
    }
  }
  lines.push('', CONTRACT_CLOSE)
  return lines.join('\n')
}

/**
 * Replace the contract block in a body, or append one when the body has none.
 * Everything outside the markers is returned verbatim — that text is the
 * admin's, and a sync is not an edit of it.
 */
export function applyContract(body: string, block: string): string {
  const open = body.indexOf(CONTRACT_OPEN)
  const close = body.indexOf(CONTRACT_CLOSE)
  if (open === -1 || close === -1 || close < open) {
    const trimmed = body.replace(/\s+$/, '')
    return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`
  }
  const before = body.slice(0, open)
  const after = body.slice(close + CONTRACT_CLOSE.length)
  return `${before}${block}${after}`
}

/** The admin's prose — everything the sync must not touch. */
export function proseOutsideContract(body: string): string {
  const open = body.indexOf(CONTRACT_OPEN)
  const close = body.indexOf(CONTRACT_CLOSE)
  if (open === -1 || close === -1 || close < open) return body.trim()
  return `${body.slice(0, open)}${body.slice(close + CONTRACT_CLOSE.length)}`.trim()
}
