/**
 * The dynamic run's honeypot, as a plan, and what the run's evidence says —
 * pure (tests/tools-review.test.ts).
 *
 * A version offered for listing runs once, for real, in a throwaway space
 * made for it and seeded with CANARIES: notes carrying a token no person
 * would type. Two kinds, each asking one question:
 *
 *   in reach    notes the Tool may read (its bound folders and the literal
 *               paths it names), half of them readable by admins only. The
 *               runner is the honeypot's admin, so the Tool reads them all —
 *               the question is where their contents GO.
 *   the vault   notes OUTSIDE everything the Tool declares. The bridge never
 *               hands them over, so a vault token showing up anywhere means
 *               the perimeter did not hold.
 *
 * Nothing a door out of the space is asked to do is performed during the run
 * — a connector call, an agent run, an action, the AI are recorded and
 * answered as unavailable — so the evidence is everything the Tool TRIED.
 * What blocks the listing: any egress attempt, CSP violation or navigation
 * (a Tool has no legitimate reason for any), an admins-only canary written
 * where more people can read it or sent through a door, and a vault token
 * anywhere. Member-visible content sent through a door the Tool declared is
 * flagged for the reviewer rather than blocked: that is what a sync tool is.
 */
import { bindingRef, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { normalizeFolder, type BindingValues } from '@visvine/tool-protocol/bindings'
import type { CheckFinding } from '../../checks/findings'

export const DYNAMIC_ANALYZER = 'dynamic@1'

/** One planted note. */
interface CanaryNote {
  path: string
  token: string
  /** Readable by the space's admins only. */
  restricted: boolean
  /** Outside everything the Tool declares. */
  vault: boolean
  content: string
}

/** A record planted for a type the Tool reads or edits. */
interface CanaryRecord {
  path: string
  type: string
  token: string
  fields: string[]
  content: string
}

export interface HoneypotPlan {
  /** What each slot is bound to in the honeypot. */
  bindings: BindingValues
  notes: CanaryNote[]
  records: CanaryRecord[]
  /** Invented types to add, with the fields to track. */
  types: Array<{ name: string; fields: string[] }>
}

/** What `canaries` on a run row holds: token → where it was planted. */
export type CanaryIndex = Record<string, { path: string; restricted: boolean; vault: boolean }>

const VAULT = 'vault'

function note(title: string, token: string): string {
  return ['---', `title: "${title}"`, '---', '', `${title}. Reference ${token} — keep this private.`, ''].join('\n')
}

/** A concrete note path a read glob matches — `people/*\/index.md` → `people/review-canary/index.md`. */
export function concretePathOf(glob: string): string | null {
  const trimmed = glob.trim().replace(/^\/+/, '')
  if (!trimmed || trimmed.startsWith('$')) return null
  let path = trimmed.replace(/\*\*/g, 'review').replace(/\*/g, 'review-canary')
  if (path.endsWith('/') || !path.endsWith('.md')) path = `${path.replace(/\/+$/, '')}/review-canary.md`
  return path
}

/** What each slot is bound to in a honeypot: its suggestion, or a `review-<slot>` stand-in. */
export function honeypotBindings(facts: ToolManifestFacts): BindingValues {
  const bindings: BindingValues = {}
  for (const [slot, spec] of Object.entries(facts.bindings)) {
    if (spec.kind === 'folder') bindings[slot] = normalizeFolder(spec.suggest ?? `review-${slot}`)
    else bindings[slot] = spec.suggest?.trim() || `review-${slot}`
  }
  return bindings
}

/**
 * The honeypot for one version: each slot bound to its suggestion (or a
 * `review-<slot>` stand-in), two canaries in every folder the Tool may read —
 * one for everyone, one for admins — a record of each type it reads, and the
 * vault. `mint` makes a token; tests pass a counter.
 */
export function planHoneypot(facts: ToolManifestFacts, mint: () => string): HoneypotPlan {
  const bindings = honeypotBindings(facts)

  const folders = new Set<string>()
  const literal = new Set<string>()
  for (const glob of [...facts.permissions.context.read, ...facts.permissions.context.write]) {
    const ref = bindingRef(glob)
    if (ref) {
      const slot = facts.bindings[ref.slot]
      if (slot?.kind === 'folder' && bindings[ref.slot]) folders.add(bindings[ref.slot])
      continue
    }
    const path = concretePathOf(glob)
    if (path && !path.startsWith(`${VAULT}/`)) literal.add(path)
  }

  const notes: CanaryNote[] = []
  for (const folder of [...folders].sort()) {
    for (const restricted of [false, true]) {
      const token = mint()
      const title = restricted ? 'Board minutes' : 'Account plan'
      notes.push({ path: `${folder}/${restricted ? 'board-minutes' : 'account-plan'}.md`, token, restricted, vault: false, content: note(title, token) })
    }
  }
  for (const path of [...literal].sort()) {
    const token = mint()
    notes.push({ path, token, restricted: false, vault: false, content: note('Account plan', token) })
  }
  for (const restricted of [false, true]) {
    const token = mint()
    notes.push({
      path: `${VAULT}/${restricted ? 'keys' : 'contacts'}.md`,
      token,
      restricted,
      vault: true,
      content: note(restricted ? 'Signing keys' : 'Private contacts', token),
    })
  }

  // Records of every type the Tool reads or edits, bound.
  const types = new Map<string, Set<string>>()
  const typeOf = (entry: string): string | null => {
    const ref = bindingRef(entry)
    if (!ref) return entry.trim() || null
    const slot = facts.bindings[ref.slot]
    return slot?.kind === 'type' ? (bindings[ref.slot] ?? null) : null
  }
  for (const entry of facts.permissions.records.read) {
    const type = typeOf(entry)
    if (type) types.set(type, types.get(type) ?? new Set())
  }
  for (const entry of facts.permissions.records.write) {
    const type = typeOf(entry.type)
    if (!type) continue
    const fields = types.get(type) ?? new Set<string>()
    for (const field of entry.fields) fields.add(field)
    types.set(type, fields)
  }
  for (const [slot, spec] of Object.entries(facts.bindings)) {
    if (spec.kind !== 'type' || !bindings[slot]) continue
    const fields = types.get(bindings[slot])
    if (fields) for (const field of spec.fields ?? []) fields.add(field)
  }
  const records: CanaryRecord[] = []
  for (const [type, fieldSet] of [...types].sort(([a], [b]) => a.localeCompare(b))) {
    const token = mint()
    const fields = [...fieldSet].sort()
    const slug = type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'record'
    const path = `review-records/${slug}/northwind.md`
    const front = ['---', `type: ${type}`, 'title: "Northwind"', ...fields.map((field) => `${field}: "${token}"`), '---']
    records.push({ path, type, token, fields, content: [...front, '', `Northwind. Reference ${token}.`, ''].join('\n') })
  }

  return { bindings, notes, records, types: [...types].map(([name, fields]) => ({ name, fields: [...fields].sort() })) }
}

/** The run row's record of what was planted. */
export function canaryIndexOf(plan: HoneypotPlan): CanaryIndex {
  const index: CanaryIndex = {}
  for (const n of plan.notes) index[n.token] = { path: n.path, restricted: n.restricted, vault: n.vault }
  for (const r of plan.records) index[r.token] = { path: r.path, restricted: false, vault: false }
  return index
}

// ── the evidence ─────────────────────────────────────────────────────────────

/** What the run saw, as the scan reads it. */
export interface RunEvidence {
  canaries: CanaryIndex
  /** Every note in the honeypot after the run, with whether only admins can read it. */
  notes: Array<{ path: string; content: string; restricted: boolean }>
  events: Array<{ kind: string; method?: string | null; detail: Record<string, unknown> }>
  /** Did the Tool's frame load and make any call at all? */
  rendered: boolean
}

function tokensIn(text: string, canaries: CanaryIndex): string[] {
  return Object.keys(canaries).filter((token) => text.includes(token))
}

function hostOf(url: unknown): string {
  if (typeof url !== 'string') return 'somewhere'
  try {
    return new URL(url).host || url.slice(0, 80)
  } catch {
    return url.slice(0, 80)
  }
}

const DOOR_WORD: Record<string, string> = {
  'connectors.call': 'a connector',
  'agents.run': 'an agent',
  'actions.run': 'an action',
  'ai.complete': 'the space’s AI',
  'ai.decide': 'the space’s judge',
}

/** The dynamic stage's findings from one run's evidence. */
export function scanEvidence(evidence: RunEvidence): CheckFinding[] {
  const findings: CheckFinding[] = []
  const { canaries } = evidence
  const vaultHit = (text: string) => tokensIn(text, canaries).filter((t) => canaries[t].vault)

  for (const event of evidence.events) {
    const text = JSON.stringify(event.detail ?? {})
    const carried = tokensIn(text, canaries).length > 0 ? ' — carrying planted data' : ''
    if (event.kind === 'egress') {
      findings.push({ rule: 'dynamic.egress', severity: 'high', message: `Tried to reach ${hostOf(event.detail.url)}${carried}` })
    } else if (event.kind === 'csp') {
      const directive = typeof event.detail.directive === 'string' ? event.detail.directive : 'its policy'
      findings.push({ rule: 'dynamic.csp', severity: 'high', message: `Broke ${directive} reaching ${hostOf(event.detail.blocked)}${carried}` })
    } else if (event.kind === 'navigation') {
      findings.push({ rule: 'dynamic.navigation', severity: 'high', message: `Navigated its frame to ${hostOf(event.detail.url)}${carried}` })
    } else if (event.kind === 'door') {
      const method = event.method ?? ''
      const door = DOOR_WORD[method] ?? 'a door out of the space'
      const named = typeof event.detail.name === 'string' ? ` (${event.detail.name})` : ''
      for (const token of tokensIn(text, canaries)) {
        const planted = canaries[token]
        if (planted.vault) continue
        const ai = method === 'ai.complete' || method === 'ai.decide'
        findings.push({
          rule: 'dynamic.canary-door',
          severity: ai ? 'low' : planted.restricted ? 'high' : 'medium',
          message: `Sent ${planted.restricted ? 'an admins-only note' : 'a note'} (${planted.path}) to ${door}${named}`,
        })
      }
    } else if (event.kind === 'bridge' && event.method === 'state.set') {
      const scope = event.detail.scope === 'user' ? 'user' : 'install'
      if (scope === 'install') {
        for (const token of tokensIn(text, canaries)) {
          if (canaries[token].restricted && !canaries[token].vault) {
            findings.push({
              rule: 'dynamic.canary-write-out',
              severity: 'high',
              message: `Kept an admins-only note (${canaries[token].path}) in state every viewer shares`,
            })
          }
        }
      }
    }
    for (const token of vaultHit(text)) {
      findings.push({ rule: 'dynamic.canary-read', severity: 'high', message: `Got hold of ${canaries[token].path}, which it never declared` })
    }
  }

  for (const note of evidence.notes) {
    for (const token of tokensIn(note.content, canaries)) {
      const planted = canaries[token]
      if (planted.path === note.path) continue
      if (planted.vault) {
        findings.push({ rule: 'dynamic.canary-read', severity: 'high', message: `Got hold of ${planted.path}, which it never declared, and wrote it to ${note.path}` })
      } else if (planted.restricted && !note.restricted) {
        findings.push({
          rule: 'dynamic.canary-write-out',
          severity: 'high',
          message: `Copied an admins-only note (${planted.path}) into ${note.path}, which everyone in the space can read`,
        })
      }
    }
  }

  if (!evidence.rendered) {
    findings.push({ rule: 'dynamic.no-render', severity: 'low', message: 'It made no call in the run — nothing it does was seen' })
  }
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.rule}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
