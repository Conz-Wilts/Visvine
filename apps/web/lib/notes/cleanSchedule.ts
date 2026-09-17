// The space's nightly pass — the DB half of lib/notes/shared/cleanSchedule.ts.
//
// A schedule is a clock in front of two things that already exist: the clean
// (./clean.ts) and the embedding sweep (./embedSweep.ts). Clean on runs the
// clean, then the embed if that is on too; embed on alone only embeds what is
// new or edited. It carries no authority: a clean resolves the admin named in
// `run_as_user_id` and acts as THEM — their visibility lens, their write gate,
// their audit trail, origin 'maintenance'. So a restricted folder they cannot
// read is not analysed, a folder frozen for AI is not written, and a note in a
// public sub-space's federated `subspaces/` folder is neither, because it belongs
// to another tenant (shared/clean.ts#buildCleanScope).
//
// WHO FIRES IT: the agent tick, once a minute, claiming rows whose `next_run_at`
// has passed. The claim is a conditional UPDATE that advances the row itself, so
// N Cloud Run instances racing at 3:30am produce exactly one run. Never
// backfills — a night the deployment was down is skipped, not replayed.
//
// If the person a clean runs as stops being an admin, the run is recorded
// `skipped` rather than falling back to anyone else: an unattended pass acts
// for a named person or it does not act.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isAdmin } from '@/lib/auth'
import { SHARED_OWNER_KEY, type Context } from './store'
import { cleanPass } from './clean'
import { contextAccessFor, ensureAccessSeeded } from './access'
import { embedSweep } from './embedSweep'
import { semanticConfigured } from './embeddings'
import type { ContextPrincipal } from './shared/contextTypes'
import type { AutoFix } from './shared/review'
import {
  CLEAN_FIX_KINDS,
  cleanScheduleDenial,
  DEFAULT_CLEAN_SETTINGS,
  embedDecision,
  MAX_CLEANS_PER_TICK,
  nextCleanRunAt,
  POST_CLEAN_EMBED_NOTES,
  sanitizeCleanSchedule,
  scheduleActive,
  WORKLIST_ITEMS_KEPT,
  type CleanScheduleSettings,
} from './shared/cleanSchedule'

export interface CleanScheduleRecord extends CleanScheduleSettings {
  spaceId: string
  runAs: { userId: string; name: string; email: string; isAdmin: boolean } | null
  nextRunAt: string | null
  lastRunAt: string | null
  timezone: string | null
  /** Whether the deployment can embed at all (OPENROUTER_API_KEY) — the embed toggle is moot without it. */
  embedKeyed: boolean
  /** Non-null when this space may not hold a schedule at all (a sub-space, a personal space). */
  denial: string | null
}

/** One row's settings as the runner reads them, defaults filled. */
function settingsOf(row: {
  enabled: boolean
  hour: number
  minute: number
  embedEnabled: boolean
} | null): CleanScheduleSettings {
  return row
    ? sanitizeCleanSchedule({
        enabled: row.enabled,
        hour: row.hour,
        minute: row.minute,
        embedEnabled: row.embedEnabled,
      })
    : DEFAULT_CLEAN_SETTINGS
}

async function spaceRow(spaceId: string) {
  return prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, parentId: true, personalOwnerId: true, timezone: true },
  })
}

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * The principal a scheduled clean acts as. Not a system actor and not a
 * super-user: the ordinary member principal for that userId, admin flag
 * included, so every gate downstream behaves exactly as it does when they run
 * clean_context by hand.
 */
async function principalForUser(spaceId: string, userId: string): Promise<ContextPrincipal | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  const admin = await isAdmin(user.id, spaceId, user.email)
  if (!admin) return null
  await ensureAccessSeeded(spaceId)
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    spaceId,
    spaceAdmin: true,
    access: await contextAccessFor(spaceId, user.id),
  }
}

/** The schedule as the console reads it — defaults, never null, plus why it can't exist here. */
export async function getCleanSchedule(spaceId: string): Promise<CleanScheduleRecord> {
  const space = await spaceRow(spaceId)
  const denial = space ? cleanScheduleDenial(space) : 'Unknown space'
  const row = await prisma.contextCleanSchedule.findUnique({ where: { spaceId } })
  const settings = settingsOf(row)
  let runAs: CleanScheduleRecord['runAs'] = null
  if (row) {
    const user = await prisma.user.findUnique({
      where: { id: row.runAsUserId },
      select: { id: true, name: true, email: true },
    })
    if (user) {
      runAs = {
        userId: user.id,
        name: user.name,
        email: user.email,
        isAdmin: await isAdmin(user.id, spaceId, user.email),
      }
    }
  }
  return {
    ...settings,
    spaceId,
    runAs,
    nextRunAt: row?.nextRunAt?.toISOString() ?? null,
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    timezone: space?.timezone ?? null,
    embedKeyed: semanticConfigured(),
    denial,
  }
}

/**
 * Write the schedule. The caller becomes the person it runs as — turning a
 * nightly clean on is lending it your reach, so it is recorded as an act of a
 * named admin rather than of "the space".
 */
export async function saveCleanSchedule(
  spaceId: string,
  actor: { id: string },
  input: Partial<Record<keyof CleanScheduleSettings, unknown>>,
): Promise<CleanScheduleRecord> {
  const space = await spaceRow(spaceId)
  if (!space) throw new Error('Unknown space')
  const denial = cleanScheduleDenial(space)
  if (denial) throw new Error(denial)

  // A patch, over what is there: the console saves one field at a time, and a
  // field it did not send keeps its value rather than falling to the default.
  const current = settingsOf(await prisma.contextCleanSchedule.findUnique({ where: { spaceId } }))
  const settings = sanitizeCleanSchedule({ ...current, ...input })
  const nextRunAt = scheduleActive(settings) ? nextCleanRunAt(settings, new Date(), space.timezone) : null
  await prisma.contextCleanSchedule.upsert({
    where: { spaceId },
    create: {
      spaceId,
      ...settings,
      runAsUserId: actor.id,
      updatedBy: actor.id,
      nextRunAt,
    },
    update: {
      ...settings,
      runAsUserId: actor.id,
      updatedBy: actor.id,
      nextRunAt,
    },
  })
  return getCleanSchedule(spaceId)
}

interface CleanRunOutcome {
  runId: string
  status: 'succeeded' | 'failed' | 'skipped'
  reason?: string
}

/**
 * One scheduled pass: the clean if it is on, then the embed if that is on.
 * Records a row either way — a skipped run is the answer to "why did nothing
 * happen last night", and losing that is how a silent schedule goes unnoticed
 * for a month.
 */
async function runScheduledPass(spaceId: string): Promise<CleanRunOutcome> {
  const row = await prisma.contextCleanSchedule.findUnique({ where: { spaceId } })
  if (!row) return { runId: '', status: 'skipped', reason: 'No schedule is configured for this space.' }
  const space = await spaceRow(spaceId)
  const denial = space ? cleanScheduleDenial(space) : 'Unknown space'
  const settings = settingsOf(row)

  const run = await prisma.contextCleanRun.create({
    data: {
      spaceId,
      trigger: 'scheduled',
      runAsUserId: row.runAsUserId,
      // `embed` marks a pass that embedded without cleaning.
      mode: settings.enabled ? 'light' : 'embed',
    },
    select: { id: true },
  })

  const skip = async (reason: string): Promise<CleanRunOutcome> => {
    await prisma.contextCleanRun.update({
      where: { id: run.id },
      data: { status: 'skipped', endedAt: new Date(), errorMessage: reason },
    })
    return { runId: run.id, status: 'skipped', reason }
  }

  if (denial) return skip(denial)

  try {
    if (settings.enabled) {
      const principal = await principalForUser(spaceId, row.runAsUserId)
      if (!principal) {
        // Deliberately not a fallback to another admin: the pass writes as a
        // person, and nobody has agreed to author what this one set up.
        return skip('The person this clean runs as is no longer an admin of this space. Turn it on again to run as yourself.')
      }
      const allow = new Set(CLEAN_FIX_KINDS.map((k) => k.kind)) as ReadonlySet<AutoFix['kind']>
      const { analysis, applied } = await cleanPass(
        principal,
        sharedContext(spaceId),
        { role: 'admin', mode: 'light', limit: WORKLIST_ITEMS_KEPT },
        allow,
      )
      await prisma.contextCleanRun.update({
        where: { id: run.id },
        data: {
          analyzedNotes: analysis.analyzed_notes,
          inScopeNotes: analysis.in_scope_notes,
          safeFixes: analysis.safe_fixes.count,
          applied: applied?.applied ?? 0,
          appliedByKind: (applied?.applied_by_kind ?? {}) as object,
          skipped: (applied?.skipped ?? []) as object,
          worklist: analysis.worklist.map((g) => ({
            kind: g.kind,
            count: g.count,
            items: g.items.map((i) => ({ path: i.path, detail: i.detail })),
          })) as object,
          truncated: analysis.truncated === true,
        },
      })
    }

    // After the clean, so the night's edits are searchable by morning. Its
    // outcome is its own column: an embed failing (a provider outage, a quota)
    // never fails a clean that already wrote what it wrote.
    await embedPass(run.id, spaceId, settings)
    await prisma.contextCleanRun.update({ where: { id: run.id }, data: { status: 'succeeded', endedAt: new Date() } })
    await prisma.contextCleanSchedule.update({ where: { spaceId }, data: { lastRunAt: new Date() } })
    return { runId: run.id, status: 'succeeded' }
  } catch (err) {
    logger.error('notes.clean.run_failed', { err, spaceId, runId: run.id })
    await prisma.contextCleanRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        endedAt: new Date(),
        errorMessage: err instanceof Error ? err.message.slice(0, 500) : 'Clean failed',
      },
    })
    return { runId: run.id, status: 'failed', reason: 'Clean failed' }
  }
}

/**
 * The pass's embed: new and edited notes only — embedSweep skips any note whose
 * vector already matches its mtime — recorded on the run row whatever it did.
 */
async function embedPass(runId: string, spaceId: string, settings: CleanScheduleSettings): Promise<void> {
  const decision = embedDecision(settings.embedEnabled, semanticConfigured())
  if (!decision.embed) {
    await prisma.contextCleanRun.update({ where: { id: runId }, data: { embedStatus: decision.status } })
    return
  }
  try {
    const result = await embedSweep(spaceId, { maxNotes: POST_CLEAN_EMBED_NOTES })
    await prisma.contextCleanRun.update({
      where: { id: runId },
      data: {
        embedStatus: result.disabled ? 'off' : 'succeeded',
        embeddedNotes: result.notes,
        embeddedChunks: result.noteChunks,
        embeddedSources: result.chunks,
        embedMessage: result.remaining
          ? `${result.remaining} more note${result.remaining === 1 ? '' : 's'} left for the next night.`
          : null,
      },
    })
  } catch (err) {
    logger.error('notes.clean.embed_failed', { err, spaceId, runId })
    await prisma.contextCleanRun.update({
      where: { id: runId },
      data: {
        embedStatus: 'failed',
        embedMessage: err instanceof Error ? err.message.slice(0, 500) : 'Embedding failed',
      },
    })
  }
}

/** A row the tick may fire: something on, and due. */
const activeWhere = { OR: [{ enabled: true }, { embedEnabled: true }] }

/**
 * Claim and run every schedule due at `now`. Rides the agent tick, so the
 * claim has to be safe against N instances: the conditional UPDATE advances
 * `next_run_at` to the following night, and only the instance whose update
 * matched a row runs it.
 */
export async function runDueCleans(now: Date): Promise<{ considered: number; ran: number; deferred: number }> {
  const due = await prisma.contextCleanSchedule.findMany({
    where: { ...activeWhere, nextRunAt: { lte: now } },
    select: { spaceId: true, hour: true, minute: true, nextRunAt: true, space: { select: { timezone: true } } },
    // Oldest due first, so a space that keeps getting deferred is taken next.
    orderBy: { nextRunAt: 'asc' },
    take: MAX_CLEANS_PER_TICK,
  })
  const deferred = Math.max(
    0,
    (await prisma.contextCleanSchedule.count({ where: { ...activeWhere, nextRunAt: { lte: now } } })) - due.length,
  )
  let ran = 0
  for (const row of due) {
    const next = nextCleanRunAt({ hour: row.hour, minute: row.minute }, now, row.space.timezone)
    const claimed = await prisma.contextCleanSchedule.updateMany({
      where: { spaceId: row.spaceId, ...activeWhere, nextRunAt: row.nextRunAt },
      data: { nextRunAt: next },
    })
    if (claimed.count === 0) continue // another instance took it
    ran++
    const started = Date.now()
    const outcome = await runScheduledPass(row.spaceId)
    logger.info('notes.clean.scheduled', { spaceId: row.spaceId, runId: outcome.runId, status: outcome.status, ms: Date.now() - started })
  }
  return { considered: due.length, ran, deferred }
}
