/**
 * The JSON Schema a collection declares its rows by — a small subset, checked
 * twice: once when the manifest is parsed (`schemaDenial`: is this a schema we
 * can hold a Tool to?), and on every write (`rowDenial`: does this row fit?).
 * Pure.
 *
 * The subset: `type` (object, string, number, integer, boolean, array, null,
 * or a list of them), `properties`, `required`, `additionalProperties`
 * (true or false), `enum`, `const`, `minimum` / `maximum`, `minLength` /
 * `maxLength`, `items`, `minItems` / `maxItems`, and the words `title`,
 * `description`, `default`, `format` that decide nothing. A row's root is
 * always an object. No `pattern`: an author's regular expression run by the
 * server over every write is a way to stall it.
 */

type Schema = Record<string, unknown>

const TYPES = ['object', 'string', 'number', 'integer', 'boolean', 'array', 'null'] as const
const KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'items',
  'minItems',
  'maxItems',
  'title',
  'description',
  'default',
  'format',
])

/** How deep a schema may nest — a row is a record, not a document. */
const MAX_DEPTH = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typesOf(schema: Schema): string[] | null {
  if (schema.type === undefined) return null
  return Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)]
}

/** Why a schema cannot be held to, or null when it can. */
export function schemaDenial(schema: unknown, at = 'schema', depth = 0): string | null {
  if (!isRecord(schema)) return `${at} must be an object`
  if (depth > MAX_DEPTH) return `${at} nests too deep`
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) return `${at} uses "${key}", which collections do not support`
  }
  const types = typesOf(schema)
  if (depth === 0 && (!types || types.length !== 1 || types[0] !== 'object')) return 'A collection’s schema is `type: object`'
  if (types && types.some((t) => !(TYPES as readonly string[]).includes(t))) return `${at}: unknown type ${types.join(', ')}`
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) return `${at}.properties must be a map`
    for (const [name, sub] of Object.entries(schema.properties)) {
      const denial = schemaDenial(sub, `${at}.properties.${name}`, depth + 1)
      if (denial) return denial
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((r) => typeof r !== 'string'))) {
    return `${at}.required must be a list of names`
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    return `${at}.additionalProperties is true or false`
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) return `${at}.enum must be a list`
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && typeof schema[key] !== 'number') return `${at}.${key} must be a number`
  }
  if (schema.items !== undefined) {
    const denial = schemaDenial(schema.items, `${at}.items`, depth + 1)
    if (denial) return denial
  }
  return null
}

function typeOfValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Why a value does not fit its schema, naming where; null when it fits. */
export function rowDenial(schema: Schema, value: unknown, at = 'row'): string | null {
  const types = typesOf(schema)
  if (types) {
    const actual = typeOfValue(value)
    const fits = types.some((t) => t === actual || (t === 'number' && actual === 'integer'))
    if (!fits) return `${at} must be ${types.join(' or ')}`
  }
  if (schema.const !== undefined && !sameValue(schema.const, value)) return `${at} must be ${JSON.stringify(schema.const)}`
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => sameValue(option, value))) {
    return `${at} must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(', ')}`
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${at} must be at least ${schema.minimum}`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${at} must be at most ${schema.maximum}`
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${at} is shorter than ${schema.minLength}`
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${at} is longer than ${schema.maxLength}`
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${at} needs at least ${schema.minItems} items`
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${at} holds at most ${schema.maxItems} items`
    if (isRecord(schema.items)) {
      for (let i = 0; i < value.length; i++) {
        const denial = rowDenial(schema.items, value[i], `${at}[${i}]`)
        if (denial) return denial
      }
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    for (const name of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(name in value)) return `${at}.${name} is required`
    }
    for (const [name, sub] of Object.entries(value)) {
      const spec = properties[name]
      if (spec === undefined) {
        if (schema.additionalProperties === false) return `${at}.${name} is not in the schema`
        continue
      }
      if (isRecord(spec)) {
        const denial = rowDenial(spec, sub, `${at}.${name}`)
        if (denial) return denial
      }
    }
  }
  return null
}
