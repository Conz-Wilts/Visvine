// The space's nightly clean — the DB half of lib/notes/shared/cleanSchedule.ts.
//
// A schedule is a clock in front of the pass that already exists (./clean.ts).
// It carries no authority: every run resolves the admin named in
// `run_as_user_id` and acts as THEM — their visibility lens, their write gate,
// their audit trail, origin 'maintenance'. So a restricted folder they cannot
// read is not analysed, a folder frozen for AI is not written, and a note in a
// public sub-space's federated `spaces/` folder is neither, because it belongs
// to another tenant (shared/clean.ts#buildCleanScope).
//
// WHO FIRES IT: the agent tick, once a minute, claiming rows whose `next_run_at`
// has passed. The claim is a conditional UPDATE that advances the row itself, so
// N Cloud Run instances racing at 3:30am produce exactly one run. Never
// backfills — a night the deployment was down is skipped, not replayed.
//
// If the person it runs as stops being an admin, the run is recorded `skipped`
// rather than falling back to anyone else: an unattended pass acts for a named
// person or it does not act.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isAdmin } from '@/lib/auth'
import { SHARED_OWNER_KEY, type Context } from './store'
import { cleanPass, type CleanAnalysis, type ApplyResult } from './clean'
import { visibleVault } from './contextService'
import { getVault } from './vaultCache'
import { contextAccessFor, ensureAccessSeeded } from './access'
import { embedSweep } from './embedSweep'
import { semanticConfigured } from './embeddings'
import type { ContextPrincipal } from './shared/contextTypes'
import type { AutoFix } from './shared/review'
import {
  cleanScheduleDenial,
  DEFAULT_CLEAN_SETTINGS,
  effectiveFixKinds,
  embedAfterCleanStatus,
  MAX_CLEANS_PER_TICK,
  nextCleanRunAt,
  POST_CLEAN_EMBED_NOTES,
  sanitizeCleanSchedule,
  WORKLIST_ITEMS_KEPT,
  type CleanEmbedStatus,
  type CleanFixKind,
  type CleanScheduleSettings,
} from './shared/cleanSchedule'

/**
 * Worklist groups the run row keeps: the whole count per kind, and the first
 * WORKLIST_ITEMS_KEPT items so the dashboard can name what to look at.
 */
interface WorklistGroupRecord {
  kind: string
  count: number
  items: Array<{ path: string; detail: string }>
}

/** What the post-clean embed did, on the run row. */
interface CleanEmbedRecord {
  status: CleanEmbedStatus
  notes: number
  chunks: number
  sources: number
  message: string | null
}

export interface CleanScheduleRecord extends CleanScheduleSettings {
  spaceId: string
  runAs: { userId: string; name: string; email: string; isAdmin: boolean } | null
  nextRunAt: string | null
  lastRunAt: string | null
  timezone: string | null
  /** Whether the deployment can embed at all (OPENROUTER_API_KEY) — the toggles are moot without it. */
  embedKeyed: boolean
  /** Non-null when this space may not hold a schedule at all (a sub-space, a personal space). */
  denial: string | null
}

export interface CleanRunRecord {
  id: string
  trigger: string
  status: string
  startedAt: string
  endedAt: string | null
  startedBy: string | null
  runAs: { userId: string; name: string } | null
  mode: string
  targetPath: string | null
  analyzedNotes: number
  inScopeNotes: number
  safeFixes: number
  applied: number
  appliedByKind: Record<string, number>
  skipped: Array<{ path: string; reason: string }>
  worklist: WorklistGroupRecord[]
  /** Full mode analysed only the first FULL_MODE_NOTE_CAP notes, by path. */
  truncated: boolean
  embed: CleanEmbedRecord
  errorMessage: string | null
}

/** One row's settings as the runner reads them, defaults filled. */
function settingsOf(row: {
  enabled: boolean
  hour: number
  minute: number
  mode: string
  targetPath: string | null
  applyFixes: boolean
  fixKinds: string[]
  embedEnabled: boolean
  embedAfterClean: boolean
} | null): CleanScheduleSettings {
  return row
    ? sanitizeCleanSchedule({
        enabled: row.enabled,
        hour: row.hour,
        minute: row.minute,
        mode: row.mode,
        targetPath: row.targetPath,
        applyFixes: row.applyFixes,
        fixKinds: row.fixKinds,
        embedEnabled: row.embedEnabled,
        embedAfterClean: row.embedAfterClean,
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
 * The principal a scheduled run acts as. Not a system actor and not a
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
 * nightly pass on is lending it your reach, so it is recorded as an act of a
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
  const nextRunAt = settings.enabled ? nextCleanRunAt(settings, new Date(), space.timezone) : null
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

const RUNS_SHOWN = 20

export async function listCleanRuns(spaceId: string, limit = RUNS_SHOWN): Promise<CleanRunRecord[]> {
  const rows = await prisma.contextCleanRun.findMany({
    where: { spaceId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
  const userIds = [...new Set(rows.map((r) => r.runAsUserId))]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.name]))
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    startedBy: r.startedBy,
    runAs: nameOf.has(r.runAsUserId) ? { userId: r.runAsUserId, name: nameOf.get(r.runAsUserId)! } : null,
    mode: r.mode,
    targetPath: r.targetPath,
    analyzedNotes: r.analyzedNotes,
    inScopeNotes: r.inScopeNotes,
    safeFixes: r.safeFixes,
    applied: r.applied,
    appliedByKind: (r.appliedByKind ?? {}) as unknown as Record<string, number>,
    skipped: (r.skipped ?? []) as unknown as Array<{ path: string; reason: string }>,
    worklist: ((r.worklist ?? []) as unknown as Array<Partial<WorklistGroupRecord>>).map((g) => ({
      kind: g.kind ?? 'unknown',
      count: g.count ?? 0,
      items: g.items ?? [],
    })),
    truncated: r.truncated,
    embed: {
      status: r.embedStatus as CleanEmbedStatus,
      notes: r.embeddedNotes,
      chunks: r.embeddedChunks,
      sources: r.embeddedSources,
      message: r.embedMessage,
    },
    errorMessage: r.errorMessage,
  }))
}

export interface CleanReach {
  /** Every live note in the space's shared context. */
  totalNotes: number
  /** Of those, the ones the runner can READ — the visibility lens. */
  visibleNotes: number
  /** Folders the space marked restricted, and those frozen for AI. */
  restrictedFolders: string[]
  lockedFolders: string[]
  /** Public sub-spaces whose context is read here and never cleaned from here. */
  subspaces: number
  /** Notes with a current whole-note vector, and with current chunks — the search-readiness of the space. */
  embeddedNotes: number
  chunkedNotes: number
}

/**
 * What the nightly pass would be able to see, without running one. The
 * dashboard's honesty: a schedule that reaches 40 of 900 notes should say so
 * before the first 3am run, not after.
 */
export async function cleanReach(spaceId: string, userId: string): Promise<CleanReach | null> {
  const p = await principalForUser(spaceId, userId)
  if (!p) return null
  const context = sharedContext(spaceId)
  const [totalNotes, vault, subspaces, embedded, chunked] = await Promise.all([
    prisma.contextNote.count({ where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null } }),
    visibleVault(p, context),
    prisma.space.count({ where: { parentId: spaceId, visibility: 'public' } }),
    prisma.contextNoteEmbedding.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY },
      select: { path: true, mtime: true },
    }),
    prisma.contextNoteChunk.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY },
      select: { path: true, mtime: true },
      distinct: ['path'],
    }),
  ])
  // Current means the vector's mtime is the note's — a stale one is a note
  // search still reaches by keyword, not one the semantic half knows.
  const { metas } = await getVault(context)
  const mtimeOf = new Map(metas.map((m) => [m.path, m.mtime]))
  const current = (rows: Array<{ path: string; mtime: bigint }>) =>
    rows.filter((r) => mtimeOf.get(r.path) === Number(r.mtime)).length
  return {
    totalNotes,
    visibleNotes: vault.metas.length,
    restrictedFolders: [...p.access.restricted],
    lockedFolders: [...p.access.locked],
    subspaces,
    embeddedNotes: current(embedded),
    chunkedNotes: current(chunked),
  }
}

export interface CleanRunOutcome {
  runId: string
  status: 'succeeded' | 'failed' | 'skipped'
  reason?: string
  analysis?: CleanAnalysis
  applied?: ApplyResult | null
}

/**
 * One pass, scheduled or pressed. Records a row either way — a skipped run is
 * the answer to "why did nothing happen last night", and losing that is how a
 * silent schedule goes unnoticed for a month.
 */
export async function runCleanPass(opts: {
  spaceId: string
  trigger: 'scheduled' | 'manual'
  startedBy?: string | null
}): Promise<CleanRunOutcome> {
  const { spaceId, trigger } = opts
  const row = await prisma.contextCleanSchedule.findUnique({ where: { spaceId } })
  const space = await spaceRow(spaceId)
  const denial = space ? cleanScheduleDenial(space) : 'Unknown space'

  const settings = settingsOf(row)

  // A manual run acts as whoever pressed Run, the way a manual agent run does;
  // a scheduled one acts as the admin who turned the schedule on. Pressing Run
  // before there is any schedule is the ordinary way to see what a clean would
  // do, so it needs no row.
  const runAsUserId = trigger === 'manual' ? (opts.startedBy ?? row?.runAsUserId) : row?.runAsUserId
  if (!runAsUserId) {
    return { runId: '', status: 'skipped', reason: 'No clean is configured for this space.' }
  }

  const run = await prisma.contextCleanRun.create({
    data: {
      spaceId,
      trigger,
      startedBy: opts.startedBy ?? null,
      runAsUserId,
      mode: settings.mode,
      targetPath: settings.targetPath,
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

  const principal = await principalForUser(spaceId, runAsUserId)
  if (!principal) {
    // Deliberately not a fallback to another admin: the pass writes as a
    // person, and nobody has agreed to author what this one set up.
    return skip('The person this clean runs as is no longer an admin of this space. Turn it on again to run as yourself.')
  }

  try {
    const allow = new Set<CleanFixKind>(effectiveFixKinds(settings)) as ReadonlySet<AutoFix['kind']>
    const { analysis, applied } = await cleanPass(
      principal,
      sharedContext(spaceId),
      {
        role: 'admin',
        targetPath: settings.targetPath ?? undefined,
        mode: settings.mode,
        limit: WORKLIST_ITEMS_KEPT,
      },
      allow,
    )
    await prisma.contextCleanRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        endedAt: new Date(),
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
    // updateMany, not update: a manual run may precede any schedule row.
    await prisma.contextCleanSchedule.updateMany({ where: { spaceId }, data: { lastRunAt: new Date() } })

    // The embed rides the same pass so the night's edits are searchable by
    // morning. Its outcome is its own column: an embed failing (a provider
    // outage, a quota) never fails the clean, which already wrote what it wrote.
    await embedAfterClean(run.id, spaceId, settings)
    return { runId: run.id, status: 'succeeded', analysis, applied }
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

/** The post-clean embed, recorded on the run row whatever it did. */
async function embedAfterClean(runId: string, spaceId: string, settings: CleanScheduleSettings): Promise<void> {
  const decision = embedAfterCleanStatus(settings, semanticConfigured())
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
          ? `${result.remaining} more note${result.remaining === 1 ? '' : 's'} left for the nightly sweep.`
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

/**
 * Claim and run every schedule due at `now`. Rides the agent tick, so the
 * claim has to be safe against N instances: the conditional UPDATE advances
 * `next_run_at` to the following night, and only the instance whose update
 * matched a row runs it.
 */
export async function runDueCleans(now: Date): Promise<{ considered: number; ran: number; deferred: number }> {
  const due = await prisma.contextCleanSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    select: { spaceId: true, hour: true, minute: true, nextRunAt: true, space: { select: { timezone: true } } },
    // Oldest due first, so a space that keeps getting deferred is taken next.
    orderBy: { nextRunAt: 'asc' },
    take: MAX_CLEANS_PER_TICK,
  })
  const deferred = Math.max(
    0,
    (await prisma.contextCleanSchedule.count({ where: { enabled: true, nextRunAt: { lte: now } } })) - due.length,
  )
  let ran = 0
  for (const row of due) {
    const next = nextCleanRunAt({ hour: row.hour, minute: row.minute }, now, row.space.timezone)
    const claimed = await prisma.contextCleanSchedule.updateMany({
      where: { spaceId: row.spaceId, enabled: true, nextRunAt: row.nextRunAt },
      data: { nextRunAt: next },
    })
    if (claimed.count === 0) continue // another instance took it
    ran++
    const started = Date.now()
    const outcome = await runCleanPass({ spaceId: row.spaceId, trigger: 'scheduled' })
    logger.info('notes.clean.scheduled', { spaceId: row.spaceId, runId: outcome.runId, status: outcome.status, ms: Date.now() - started })
  }
  return { considered: due.length, ran, deferred }
}
