/**
 * An agent's inputs — the values that are each person's own. Pure.
 *
 * One run acts as one person, on that person's accounts. What differs between
 * the people an agent runs for is not only whose Slack it posts with but WHERE
 * it posts: my DM, your team's channel. That is an input: the record declares
 * it, each identity holds its own value, and the run is handed the values of
 * the person it acts as. A brief names an input as `{{key}}`.
 *
 *   inputs:
 *     - key: slack_channel
 *       label: Slack channel
 *     - key: tone
 *       label: Tone
 *       kind: select
 *       options: [brief, detailed]
 *       required: false
 *   input_values:                     the agent's own identity (author / runs_as)
 *     slack_channel: D0123
 *   for:
 *     - user: u2
 *       inputs: { slack_channel: C0456 }
 *
 * A value for a key no longer declared is kept and ignored, like a tracked
 * field's: removing an input never loses what people typed.
 */

export interface AgentInput {
  key: string
  label: string
  kind: 'text' | 'select'
  /** The choices of a `select`; empty for `text`. */
  options: string[]
  required: boolean
}

export type InputValues = Record<string, string>

export const MAX_AGENT_INPUTS = 8
export const MAX_INPUT_VALUE = 500
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseAgentInputs(raw: unknown): Parsed<AgentInput[]> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: [] }
  if (!Array.isArray(raw)) return { ok: false, error: '`inputs` must be a list' }
  if (raw.length > MAX_AGENT_INPUTS) return { ok: false, error: `\`inputs\` holds at most ${MAX_AGENT_INPUTS}` }
  const out: AgentInput[] = []
  for (const item of raw) {
    const row: Record<string, unknown> = typeof item === 'string' ? { key: item } : item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    if (!KEY_RE.test(key)) return { ok: false, error: `input key "${key}" must be lowercase letters, digits and _` }
    if (out.some((i) => i.key === key)) return { ok: false, error: `\`inputs\` names ${key} twice` }
    const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 60) : key
    const kindRaw = typeof row.kind === 'string' ? row.kind.trim().toLowerCase() : 'text'
    if (kindRaw !== 'text' && kindRaw !== 'select') return { ok: false, error: `input ${key}: \`kind\` must be text or select` }
    const options = Array.isArray(row.options) ? [...new Set(row.options.map((o) => String(o).trim()).filter(Boolean))] : []
    if (kindRaw === 'select' && options.length === 0) return { ok: false, error: `input ${key}: a select needs \`options\`` }
    const required = row.required === undefined || row.required === null ? true : row.required === true || row.required === 'true'
    out.push({ key, label, kind: kindRaw, options: kindRaw === 'select' ? options : [], required })
  }
  return { ok: true, value: out }
}

export function parseInputValues(raw: unknown, what = '`input_values`'): Parsed<InputValues> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `${what} must be a map of input to value` }
  const out: InputValues = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_RE.test(k)) return { ok: false, error: `${what}: "${k}" is not an input key` }
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return { ok: false, error: `${what}: ${k} must be text` }
    const s = String(v).trim()
    if (s.length > MAX_INPUT_VALUE) return { ok: false, error: `${what}: ${k} is longer than ${MAX_INPUT_VALUE} characters` }
    if (s) out[k] = s
  }
  return { ok: true, value: out }
}

/** Why `values` break a declared input, or null. Undeclared keys are not checked. */
export function inputValuesDenial(decls: AgentInput[], values: InputValues): string | null {
  for (const d of decls) {
    const v = values[d.key]
    if (v !== undefined && d.kind === 'select' && !d.options.includes(v)) return `${d.label} must be one of ${d.options.join(', ')}`
  }
  return null
}

/** The required inputs `values` leave empty. */
export function missingInputs(decls: AgentInput[], values: InputValues): AgentInput[] {
  return decls.filter((d) => d.required && !values[d.key])
}

/** The values a run acting as `userId` uses: theirs for a runs-for person, the agent's own otherwise. */
export function inputValuesFor(
  record: { inputValues: InputValues; runsFor: { userId: string; inputs: InputValues }[] },
  userId: string | null,
  agentUserId: string | null,
): InputValues {
  if (!userId || userId === agentUserId) return record.inputValues
  return record.runsFor.find((e) => e.userId === userId)?.inputs ?? {}
}

/** `body` with every `{{key}}` of a declared input replaced by its value; an unset one stays as written. */
export function applyInputs(body: string, decls: AgentInput[], values: InputValues): string {
  if (decls.length === 0) return body
  const declared = new Set(decls.map((d) => d.key))
  return body.replace(/\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g, (whole, key: string) => (declared.has(key) && values[key] ? values[key] : whole))
}

/** The run's inputs as a system message, or null when the agent declares none. */
export function inputsMessage(decls: AgentInput[], values: InputValues, who: string | null): string | null {
  if (decls.length === 0) return null
  const lines = decls.map((d) => `- ${d.key} (${d.label}): ${values[d.key] ?? '(not set)'}`)
  return `This run is for ${who ?? 'the agent’s own identity'}. Their inputs — use these, never another person's:\n${lines.join('\n')}`
}

/** The declarations as frontmatter writes them; undefined when there are none. */
export function inputsFrontmatter(decls: AgentInput[]): Record<string, unknown>[] | undefined {
  if (decls.length === 0) return undefined
  return decls.map((d) => ({
    key: d.key,
    ...(d.label !== d.key ? { label: d.label } : {}),
    ...(d.kind === 'select' ? { kind: 'select', options: [...d.options] } : {}),
    ...(d.required ? {} : { required: false }),
  }))
}

/**
 * Declarations from labels a person typed (`Slack channel, Recipient`): each
 * keeps its existing declaration when its label matches one, else becomes a
 * required text input keyed from the label.
 */
export function inputsFromLabels(labels: string[], current: AgentInput[]): AgentInput[] {
  const out: AgentInput[] = []
  for (const raw of labels) {
    const label = raw.trim().slice(0, 60)
    if (!label) continue
    const kept = current.find((i) => i.label.toLowerCase() === label.toLowerCase() || i.key === label)
    const key = kept?.key ?? inputKeyOf(label)
    if (!key || out.some((i) => i.key === key)) continue
    out.push(kept ?? { key, label, kind: 'text', options: [], required: true })
  }
  return out.slice(0, MAX_AGENT_INPUTS)
}

/** `Slack channel` → `slack_channel`; empty when nothing usable is left. */
export function inputKeyOf(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40)
  return KEY_RE.test(key) ? key : ''
}
