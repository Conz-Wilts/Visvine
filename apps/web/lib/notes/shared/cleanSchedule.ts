// The pure half of the space's nightly pass (lib/notes/cleanSchedule.ts): what
// a schedule may say, when it next fires, and where a schedule may exist at all.
// Pure — no Prisma/Node/DOM imports, so the rules are unit-testable.
//
// A schedule is three answers: whether to clean, whether to embed, and when.
// Clean on runs the existing role-aware pass (./clean.ts + ./review.ts) over the
// whole space with every safe fix, then embeds if embedding is on too. Embed on
// alone embeds only what is new or edited since its last vector — no clean.
// Nothing here widens what a pass may touch: never who it acts as, and never a
// fix outside the mechanical allow-list.

import { nextOccurrence } from '@/lib/agents/config'
import type { AutoFix } from './review'

export type CleanFixKind = AutoFix['kind']

/**
 * The mechanical fixes a scheduled clean applies — all of them. This IS the
 * ceiling: the runner passes exactly this set, so no stored value can teach
 * the nightly pass a new trick. Judgment work (duplicates, contradictions,
 * orphans) is never applied by a schedule — it comes back as the worklist.
 */
export const CLEAN_FIX_KINDS: ReadonlyArray<{ kind: CleanFixKind; label: string }> = [
  { kind: 'addMissingFrontmatter', label: 'Fill missing frontmatter' },
  { kind: 'fixBrokenLink', label: 'Repair broken links' },
  { kind: 'linkMention', label: 'Link mentions' },
  { kind: 'setStale', label: 'Mark stale notes' },
  { kind: 'setExpired', label: 'Retire expired notes' },
  { kind: 'linkSupersession', label: 'Retire superseded notes' },
]

export interface CleanScheduleSettings {
  /** Run the clean at `hour:minute`. */
  enabled: boolean
  hour: number
  minute: number
  /**
   * Whether this space's notes are embedded at all, and — when there is a
   * schedule — embed new or edited notes at `hour:minute`, after the clean if
   * that is on too. Off stops the nightly sweep and the query-time catch-up
   * alike; search reports `semantic: 'off'`. No row = on.
   */
  embedEnabled: boolean
}

export const DEFAULT_CLEAN_SETTINGS: CleanScheduleSettings = {
  enabled: false,
  hour: 3,
  minute: 30,
  embedEnabled: true,
}

/** What a pass's embed did, as the run row records it. */
export type CleanEmbedStatus = 'off' | 'no-key' | 'succeeded' | 'failed'

/** Whether a pass embeds, and if not, the status the run row keeps. */
export function embedDecision(embedEnabled: boolean, keyed: boolean): { embed: boolean; status: CleanEmbedStatus } {
  if (!embedEnabled) return { embed: false, status: 'off' }
  if (!keyed) return { embed: false, status: 'no-key' }
  return { embed: true, status: 'succeeded' }
}

/** Whether a schedule fires at all: something has to be switched on. */
export function scheduleActive(settings: Pick<CleanScheduleSettings, 'enabled' | 'embedEnabled'>): boolean {
  return settings.enabled || settings.embedEnabled
}

/**
 * The most schedules one tick runs. A claim advances `next_run_at` before
 * the pass, so anything left over is still due and the next minute's tick
 * takes it — the cap bounds one request, never the night's work.
 */
export const MAX_CLEANS_PER_TICK = 5
/** Stale notes one scheduled embed takes; the rest wait for the next night. */
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

/**
 * Coerce whatever a client (or an old row) supplies into settings the runner
 * can act on. Every field falls back rather than throwing: a schedule that
 * cannot be read must keep running on its defaults, not stop.
 */
export function sanitizeCleanSchedule(input: Partial<Record<keyof CleanScheduleSettings, unknown>>): CleanScheduleSettings {
  return {
    enabled: input.enabled === true,
    hour: clampInt(input.hour, 0, 23, DEFAULT_CLEAN_SETTINGS.hour),
    minute: clampInt(input.minute, 0, 59, DEFAULT_CLEAN_SETTINGS.minute),
    embedEnabled: input.embedEnabled !== false,
  }
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

