// The pure half of the space's nightly clean (lib/notes/cleanSchedule.ts): what
// a schedule may say, when it next fires, and where a schedule may exist at all.
// Pure — no Prisma/Node/DOM imports, so the rules are unit-testable.
//
// The clean itself is the existing role-aware pass (./clean.ts + ./review.ts)
// run on a clock. Nothing here widens what it may touch: a schedule chooses the
// hour, the mode, the folder and WHICH of the safe fixes get applied — never
// who the pass acts as, and never a fix outside the mechanical allow-list.

import { nextOccurrence } from '@/lib/agents/config'
import type { AutoFix } from './review'
import { SUBSPACE_FOLDER } from '@/lib/spaces/subspaces'

export type CleanFixKind = AutoFix['kind']

/**
 * The mechanical fixes a schedule may apply, in the order the dashboard lists
 * them. This IS the ceiling: `sanitizeCleanSchedule` drops anything else, so a
 * hand-edited row can never teach the nightly pass a new trick. Judgment work
 * (duplicates, contradictions, orphans) is never applied by a schedule — it
 * comes back as the worklist for a person or an agent.
 */
export const CLEAN_FIX_KINDS: ReadonlyArray<{ kind: CleanFixKind; label: string; detail: string }> = [
  {
    kind: 'addMissingFrontmatter',
    label: 'Fill in missing frontmatter',
    detail: 'Only fields with no value — an existing one is never overwritten.',
  },
  {
    kind: 'fixBrokenLink',
    label: 'Repair broken links',
    detail: 'Only where the dead link resolves to exactly one note.',
  },
  {
    kind: 'linkMention',
    label: 'Link unambiguous mentions',
    detail: "A note's title in another note's prose, where only one note owns that name.",
  },
  {
    kind: 'setStale',
    label: 'Mark long-untouched notes stale',
    detail: 'Never entity or index notes — a person is not neglected for sitting still.',
  },
  {
    kind: 'setExpired',
    label: 'Retire notes past their own expiry',
    detail: 'Carries out the `expires:` date the author wrote down.',
  },
  {
    kind: 'linkSupersession',
    label: 'Record supersession back-pointers',
    detail: 'When another note declares `supersedes:` this one, stamp `superseded_by` and retire it.',
  },
]

const KIND_SET = new Set<string>(CLEAN_FIX_KINDS.map((k) => k.kind))

export interface CleanScheduleSettings {
  enabled: boolean
  hour: number
  minute: number
  mode: 'light' | 'full'
  targetPath: string | null
  applyFixes: boolean
  /** Empty = every kind in CLEAN_FIX_KINDS. */
  fixKinds: CleanFixKind[]
  /**
   * Whether this space's notes are embedded at all. Off stops the nightly
   * sweep, the query-time catch-up and the post-clean pass alike; search
   * reports `semantic: 'off'`. Independent of `enabled` — a space may embed
   * without cleaning, or clean without embedding.
   */
  embedEnabled: boolean
  /** Re-embed what a pass changed, in the same pass. Needs `embedEnabled`. */
  embedAfterClean: boolean
}

export const DEFAULT_CLEAN_SETTINGS: CleanScheduleSettings = {
  enabled: false,
  hour: 3,
  minute: 30,
  mode: 'light',
  targetPath: null,
  applyFixes: true,
  fixKinds: [],
  embedEnabled: true,
  embedAfterClean: true,
}

/** How the pass after a clean decides whether to embed, and what to record when it does not. */
export type CleanEmbedStatus = 'off' | 'no-key' | 'skipped' | 'succeeded' | 'failed'

/**
 * Whether a pass embeds afterwards, and if not, the status the run row keeps.
 * Pure so the dashboard can say "this schedule will never embed" before the
 * first run rather than after it.
 */
export function embedAfterCleanStatus(
  settings: Pick<CleanScheduleSettings, 'embedEnabled' | 'embedAfterClean'>,
  keyed: boolean,
): { embed: boolean; status: CleanEmbedStatus } {
  if (!settings.embedEnabled) return { embed: false, status: 'off' }
  if (!settings.embedAfterClean) return { embed: false, status: 'skipped' }
  if (!keyed) return { embed: false, status: 'no-key' }
  return { embed: true, status: 'succeeded' }
}

/**
 * The most schedules one tick runs. A claim advances `next_run_at` before
 * the pass, so anything left over is still due and the next minute's tick
 * takes it — the cap bounds one request, never the night's work.
 */
export const MAX_CLEANS_PER_TICK = 5
/** Stale notes the post-clean embed takes in one pass; the rest wait for the nightly. */
export const POST_CLEAN_EMBED_NOTES = 400
/** Worklist items kept on the run row, per kind — enough to act on, never the whole space. */
export const WORKLIST_ITEMS_KEPT = 25

/**
 * WHERE a schedule may exist. Cleaning always happens in the space that OWNS
 * the notes, at the top level:
 *
 * - A sub-space's context is not the parent's to clean — it is read into the
 *   parent as the read-only `subspaces/<id>/` folder (lib/notes/federation.ts) and
 *   every write there is already refused (subspaceWriteDenial). Giving a
 *   sub-space its own nightly pass would make the parent's admins responsible
 *   for a tenant whose members they are not, so it holds none either.
 * - A personal space is one person's own context; they clean it themselves
 *   with clean_context. Nothing runs unattended inside someone's private notes.
 */
export function cleanScheduleDenial(space: {
  parentId?: string | null
  personalOwnerId?: string | null
}): string | null {
  if (space.parentId) {
    return 'A sub-space has no nightly clean of its own. Its context is this space’s to write and the parent reads it only — clean it here, in the space that owns the notes.'
  }
  if (space.personalOwnerId) {
    return 'A personal space is cleaned by its owner, not on a schedule.'
  }
  return null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(n) || n < min || n > max) return fallback
  return n
}

/** A folder path the pass may target: trimmed, slash-free at both ends, never a sub-space's. */
export function normalizeCleanTarget(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const path = input.trim().replace(/^\/+|\/+$/g, '')
  if (!path) return null
  // `subspaces/` is the federated read of this space's public sub-spaces. Even
  // targeted by hand it is never cleaned from here.
  if (path === SUBSPACE_FOLDER || path.startsWith(`${SUBSPACE_FOLDER}/`)) return null
  return path
}

/**
 * Coerce whatever a client (or an old row) supplies into settings the runner
 * can act on. Every field falls back rather than throwing: a schedule that
 * cannot be read must keep running on its defaults, not stop.
 */
export function sanitizeCleanSchedule(input: Partial<Record<keyof CleanScheduleSettings, unknown>>): CleanScheduleSettings {
  const kinds = Array.isArray(input.fixKinds)
    ? [...new Set(input.fixKinds.filter((k): k is CleanFixKind => typeof k === 'string' && KIND_SET.has(k)))]
    : DEFAULT_CLEAN_SETTINGS.fixKinds
  return {
    enabled: input.enabled === true,
    hour: clampInt(input.hour, 0, 23, DEFAULT_CLEAN_SETTINGS.hour),
    minute: clampInt(input.minute, 0, 59, DEFAULT_CLEAN_SETTINGS.minute),
    mode: input.mode === 'full' ? 'full' : 'light',
    targetPath: normalizeCleanTarget(input.targetPath),
    applyFixes: input.applyFixes !== false,
    fixKinds: kinds,
    embedEnabled: input.embedEnabled !== false,
    embedAfterClean: input.embedAfterClean !== false,
  }
}

/** The fix kinds a schedule actually applies — empty `fixKinds` means all of them. */
export function effectiveFixKinds(settings: Pick<CleanScheduleSettings, 'applyFixes' | 'fixKinds'>): CleanFixKind[] {
  if (!settings.applyFixes) return []
  if (settings.fixKinds.length === 0) return CLEAN_FIX_KINDS.map((k) => k.kind)
  return settings.fixKinds
}

/**
 * The next fire strictly after `after`, in the space's zone. Never backfills —
 * a night the deployment was down is skipped, not replayed, exactly like an
 * agent's schedule.
 */
export function nextCleanRunAt(
  settings: Pick<CleanScheduleSettings, 'hour' | 'minute'>,
  after: Date,
  timezone: string | null,
): Date {
  return nextOccurrence({ kind: 'daily', hour: settings.hour, minute: settings.minute }, after, timezone || 'UTC')
}

/** "3:30am each night (Pacific/Auckland)" — the one sentence every surface says. */
export function describeCleanSchedule(
  settings: Pick<CleanScheduleSettings, 'hour' | 'minute'>,
  timezone: string | null,
): string {
  const suffix = settings.hour < 12 ? 'am' : 'pm'
  const h = settings.hour % 12 === 0 ? 12 : settings.hour % 12
  const m = String(settings.minute).padStart(2, '0')
  return `${h}:${m}${suffix} each night (${timezone || 'UTC'})`
}
