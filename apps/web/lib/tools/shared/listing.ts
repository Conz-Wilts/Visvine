/**
 * Going global, as rules — pure (tests/tools-listing.test.ts).
 *
 *   the request       a space admin asks Visvine to list an approved version,
 *                     and the author co-signs it under a license; only then is
 *                     it in Visvine's queue (`listingRequestState`)
 *   the license       an SPDX id or `proprietary` (`parseLicense`)
 *   staged reach      a publisher's first listing, and every listing from a
 *                     publisher Visvine has not verified, may be installed in
 *                     at most 25 spaces outside its family for its first 14
 *                     days, at half the bridge's per-viewer rate
 *   first use         a Tool from outside the space asks each member once
 *                     before it first acts as them — writes notes or records,
 *                     calls a connector, runs an agent or an action, uses AI —
 *                     and again only when an upgrade widens that
 */
import type { ToolReach } from '@visvine/tool-protocol/bindings'
import type { BridgeMethod } from '../protocol'

// ── the request ──────────────────────────────────────────────────────────────

export type ListingRequestState = 'none' | 'awaiting_cosign' | 'in_review' | 'listed' | 'rejected' | 'withdrawn'

/** Where one version's listing stands, read off its columns. */
export function listingRequestState(v: {
  listingRequestedAt: Date | string | null
  cosignedAt: Date | string | null
  marketplaceStatus: string | null
}): ListingRequestState {
  if (v.marketplaceStatus === 'approved') return 'listed'
  if (v.marketplaceStatus === 'pending') return 'in_review'
  if (v.marketplaceStatus === 'rejected') return 'rejected'
  if (v.marketplaceStatus === 'withdrawn') return 'withdrawn'
  if (v.listingRequestedAt && !v.cosignedAt) return 'awaiting_cosign'
  return 'none'
}

// ── the license ──────────────────────────────────────────────────────────────

/** The licenses a picker offers first; any other SPDX id is accepted too. */
export const COMMON_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'ISC',
  'MPL-2.0',
  'GPL-3.0-only',
  'LGPL-3.0-only',
  'AGPL-3.0-only',
  'Unlicense',
  'CC0-1.0',
  'proprietary',
] as const

/** An SPDX license id (optionally `-or-later`, `+`), or an `AND` / `OR` of them. */
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}\+?$/

export function parseLicense(raw: unknown): { ok: true; license: string } | { ok: false; error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, error: 'A listed tool needs a license — an SPDX id such as MIT, or proprietary.' }
  if (text.toLowerCase() === 'proprietary') return { ok: true, license: 'proprietary' }
  const parts = text.replace(/[()]/g, ' ').split(/\s+(?:AND|OR|WITH)\s+/)
  if (text.length > 128 || parts.some((part) => !SPDX_ID.test(part.trim()))) {
    return { ok: false, error: `"${text}" is not an SPDX license id — use one such as MIT or Apache-2.0, or proprietary.` }
  }
  const known = COMMON_LICENSES.find((id) => id.toLowerCase() === text.toLowerCase())
  return { ok: true, license: known ?? text }
}

// ── staged reach ─────────────────────────────────────────────────────────────

export const STAGED_DAYS = 14
export const STAGED_CAP = 25

/**
 * The stage a listing starts in when Visvine first lists it, or null when it
 * starts at full reach: a verified publisher's listing after its first.
 */
export function initialStage(input: { verified: boolean; publisherListings: number; now: Date }): {
  stagedUntil: Date
  stagedCap: number
} | null {
  if (input.verified && input.publisherListings > 0) return null
  return { stagedUntil: new Date(input.now.getTime() + STAGED_DAYS * 86_400_000), stagedCap: STAGED_CAP }
}

/** Whether a listing is still in its stage. */
export function isStaged(listing: { stagedUntil: Date | string | null } | null, now: Date): boolean {
  if (!listing?.stagedUntil) return false
  return new Date(listing.stagedUntil).getTime() > now.getTime()
}

/**
 * Whether one more space outside the publisher's family may install a staged
 * listing, and the sentence when not. `spaces` counts the spaces outside the
 * family that run it now.
 */
export function stagedInstallDenial(input: {
  listing: { stagedUntil: Date | string | null; stagedCap: number | null } | null
  spaces: number
  now: Date
}): string | null {
  if (!input.listing || !isStaged(input.listing, input.now)) return null
  const cap = input.listing.stagedCap ?? STAGED_CAP
  if (input.spaces < cap) return null
  const until = new Date(input.listing.stagedUntil as Date | string).toISOString().slice(0, 10)
  return `This tool is new: it can be installed in ${cap} ${cap === 1 ? 'space' : 'spaces'} until ${until}, and it is in ${input.spaces}.`
}

/** A viewer's per-minute bridge budget for a Tool, halved while its listing is staged. */
export function stagedRate(limit: number, staged: boolean): number {
  return staged ? Math.max(1, Math.floor(limit / 2)) : limit
}

// ── first use ────────────────────────────────────────────────────────────────

/** What a Tool may do AS its viewer — the part of its reach a member is asked about. */
export interface ActingReach {
  /** Note globs it may write. */
  notes: string[]
  /** Record types it may edit, with the fields. */
  records: Array<{ type: string; fields: string[] }>
  connectors: string[]
  agents: string[]
  /** Actions it may run that change something. */
  actions: string[]
  ai: boolean
}

/**
 * The acting part of a bound reach. `actsAction` says which declared actions
 * change something — the allowlist knows (lib/tools/actionAllowlist.ts).
 */
export function actingReachOf(reach: ToolReach, actsAction: (name: string) => boolean): ActingReach {
  const sorted = (list: readonly string[]) => [...new Set(list)].sort()
  return {
    notes: sorted(reach.write),
    records: [...reach.records.write]
      .map((entry) => ({ type: entry.type, fields: sorted(entry.fields) }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    connectors: sorted(reach.connectors),
    agents: sorted(reach.agents),
    actions: sorted(reach.actions.filter(actsAction)),
    ai: reach.ai.complete || reach.ai.decide,
  }
}

/** Whether the Tool can act as its viewer at all — a read-only Tool never asks. */
export function actsAsViewer(acting: ActingReach): boolean {
  return (
    acting.notes.length > 0 ||
    acting.records.length > 0 ||
    acting.connectors.length > 0 ||
    acting.agents.length > 0 ||
    acting.actions.length > 0 ||
    acting.ai
  )
}

/**
 * Whether a consent given for `given` still covers `now`: everything the Tool
 * does as its viewer now, it did then. A narrower upgrade is covered; a wider
 * one asks again.
 */
export function consentCovers(given: ActingReach, now: ActingReach): boolean {
  const within = (a: readonly string[], b: readonly string[]) => a.every((x) => b.includes(x))
  const recordsWithin = now.records.every((entry) => {
    const had = given.records.find((g) => g.type === entry.type)
    return !!had && within(entry.fields, had.fields)
  })
  return (
    within(now.notes, given.notes) &&
    recordsWithin &&
    within(now.connectors, given.connectors) &&
    within(now.agents, given.agents) &&
    within(now.actions, given.actions) &&
    (!now.ai || given.ai)
  )
}

/** Bridge methods that act as the viewer — or may, like `data.call`, whose handlers use the same reach. */
const ACTING_METHODS: ReadonlySet<BridgeMethod> = new Set<BridgeMethod>([
  'context.write',
  'context.append',
  'records.update',
  'connectors.call',
  'agents.run',
  'actions.run',
  'ai.complete',
  'ai.decide',
  'data.call',
])

export function isActingMethod(method: BridgeMethod): boolean {
  return ACTING_METHODS.has(method)
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function folderOf(glob: string): string {
  const trimmed = glob.replace(/\/?\*\*?$/, '').replace(/\/\*[^/]*$/, '')
  return trimmed ? `${trimmed}/` : 'the space'
}

/** The one sentence a member reads before a Tool from outside the space first acts as them. */
export function consentSentence(input: { title: string; publisher: string | null; acting: ActingReach }): string {
  const a = input.acting
  const does: string[] = []
  if (a.notes.length) does.push(`edit notes in ${listWords([...new Set(a.notes.map(folderOf))])}`)
  if (a.records.length) does.push(`edit ${listWords(a.records.map((r) => r.type))} records`)
  if (a.connectors.length) does.push(`call ${listWords(a.connectors)}`)
  if (a.agents.length) does.push(`run ${listWords(a.agents)}`)
  if (a.actions.length) does.push(`run ${listWords(a.actions.map((name) => name.replace(/_/g, ' ')))}`)
  if (a.ai) does.push('use the space’s AI')
  const who = input.publisher ? `${input.title} from ${input.publisher}` : input.title
  return `${who} will ${listWords(does)} as you.`
}
