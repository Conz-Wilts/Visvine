/**
 * What happens to an agent's STATE ROW when its notes change. Called from the
 * note store after every write / rename / delete (beside syncContextLinks),
 * so the row is always derived from the notes and never the other way round.
 *
 * Three rules, all from the wayfinder map:
 *
 * 1. A write to `agents/<name>/index.md` re-derives `active` and `nextRunAt`
 *    from the agent's RECORD (the row's own config columns). A brief that
 *    still carries run keys — written before the record, or by a seed or
 *    script straight into the store — is ADOPTED: its keys are folded into
 *    the record and stripped from the note (`adoptNoteConfig`). People and
 *    agents never get that far: the write gate refuses run keys
 *    (contextService#briefRunKeyDenial), so the record is changed only
 *    through service.ts#configureAgent.
 * 2. A write to a pre-merge `agents/<name>/activation.md` re-derives the row
 *    the same way, so an agent from before the merge keeps working until
 *    it is adopted.
 * 3. A rename or delete of the agent always deactivates — simple and safe;
 *    re-activating is one click. The hook moves the state row with the name.
 *
 * Only prisma, the pure parsers, audit and auth are imported statically; the
 * store is reached by dynamic import because the store imports this file.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { logAudit } from '@/lib/notes/audit'
import {
  agentNameOfPath,
  agentOfRevisionStamp,
  isAgentActivationPath,
  isAgentBriefPath,
} from '@/lib/notes/entities'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { logger } from '@/lib/logger'
import type { Actor, Context } from '@/lib/notes/store'

// Redeclared (as entityLinks.ts does) rather than imported: the store imports
// this module, and a value import back would make an eval-time cycle.
const SHARED_OWNER_KEY = 'shared'
import {
  agentActivationPath,
  agentBriefPath,
  withActiveFalse,
  type AgentActivation,
  DEFAULT_DEBOUNCE_MS,
  copyRooms,
  type AgentBrief,
} from './config'
import { agentConfigOf, findAgentActivation, findAgentBrief, findOwnAgentBrief, readAgent } from './briefs'
import { configFromFrontmatter, configFrontmatter, configOf, runKeysOf, stripRunKeys } from './shared/agentConfig'
import { storeAgentConfig } from './record'
import { nextFire } from './shared/fanout'

import { fireNoteTriggers, hasPendingEvents } from './events'

/** The actor for machine writes into the activation boundary. */
const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Visvine' }

export type DeactivationReason =
  | 'key_rejected'
  | 'repeated_failure'
  | 'author_gone'
  | 'renamed'
  | 'deleted'
  | 'admin'
  | 'config'

function isSharedContext(context: Context): boolean {
  return context.ownerKey === SHARED_OWNER_KEY
}

async function readSharedNote(spaceId: string, path: string) {
  return prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path, deletedAt: null },
    select: { content: true, createdBy: true },
  })
}

/**
 * The IANA zone a live agent runs in: the zone its brief names, else UTC.
 *
 * There is no space-wide default any more — activating a scheduled agent
 * requires naming the zone (lib/agents/service.ts#activateAgent), so the only
 * notes that reach the UTC fallback are ones written before that rule, or by
 * hand. `Space.timezone` is still read here for exactly those: a legacy agent
 * whose space set a zone keeps firing at the hour it always did, rather than
 * silently jumping to UTC the day this shipped.
 */
export async function effectiveTimezone(spaceId: string, noteTz: string | null): Promise<string> {
  if (noteTz) return noteTz
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { timezone: true } })
  return space?.timezone || 'UTC'
}

/**
 * A brief at a name the space has used before, but a DIFFERENT note: the old
 * agent was deleted (or its folder was) and somebody has written a new one at
 * the same path. It is not the same agent, so it does not inherit the old
 * one's operational life — the runs on its page, the people who put their name
 * down on it, or the mail addressed to it. What stays is what belongs to the
 * SPACE rather than to the agent: the month's spend (`agent_model_usage`) and
 * the egress and machine logs, which are an audit trail and not a note's to
 * erase.
 *
 * A restore of the trashed note keeps the note's id, so it lands here as the
 * same agent and keeps everything. A row written before this column existed
 * has no id to compare and simply adopts the one it sees.
 */
async function retirePreviousIncarnation(spaceId: string, name: string, stateId: string): Promise<void> {
  await prisma.agentRun.deleteMany({ where: { stateId } })
  await prisma.agentSubscription.deleteMany({ where: { spaceId, name } })
  await prisma.agentEvent.deleteMany({ where: { spaceId, agentName: name, consumedBy: null } })
}

/**
 * Re-derive the state row for one agent from its brief (or from a parsed
 * activation the caller already has). Creates the row when missing.
 * Returns the row's derived facts for callers that want to render them.
 */
export async function syncAgentState(
  spaceId: string,
  name: string,
  opts: { activation?: AgentActivation | null; now?: Date } = {},
): Promise<{ active: boolean; nextRunAt: Date | null; invalid: string | null }> {
  const now = opts.now ?? new Date()
  let activation = opts.activation ?? null
  let invalid: string | null = null
  const existing = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  // A run-in copy that the house no longer shares here, or a room the house
  // no longer governs, is retired rather than re-derived: the row exists only
  // while both hold (docs/sub-spaces.md).
  if (existing?.sharedFrom && !(await copyStillAllowed(spaceId, name, existing.sharedFrom))) {
    await retireCopy(existing.id, spaceId, name)
    return { active: false, nextRunAt: null, invalid: 'no longer shared with this room' }
  }
  const agent = await readAgent(spaceId, name)
  const brief = agent?.note ?? null
  if (!activation && agent) {
    if (agent.activation.ok) activation = agent.activation.activation
    else invalid = agent.activation.error
  }
  // Who the agent acts as. The brief's author by default — a member's agent
  // reaches exactly what that member reaches — unless the record repoints it
  // with `runs_as`, which only an admin may set to someone else
  // (service.ts#configureAgent).
  const runAsUserId = activation?.runsAs ?? brief?.createdBy ?? null

  // Active = the record says so AND it has some way to fire (a clock or a trigger).
  const active = !!(activation?.active && (activation.schedule || activation.on) && brief)
  const tz = await effectiveTimezone(spaceId, activation?.timezone ?? null)
  // People with a time of their own pull the next fire forward to theirs (shared/fanout.ts).
  const parsedBrief = agent?.brief ?? null
  const runsFor = parsedBrief?.ok && !existing?.sharedFrom ? parsedBrief.brief.runsFor : []
  let nextRunAt = active && activation?.schedule ? nextFire(activation.schedule, tz, runsFor, now) : null
  // Mail already waiting (arrived while inactive, or just before this
  // re-derive) keeps its debounce deadline rather than being pushed out to the
  // next clock occurrence.
  if (active && activation && (await hasPendingEvents(spaceId, name))) {
    const soon = new Date(now.getTime() + activation.debounceMs)
    if (!nextRunAt || soon < nextRunAt) nextRunAt = soon
  }
  const triggersJson = activation?.on ? { ...activation.on } : Prisma.DbNull
  const debounceMs = activation?.debounceMs ?? DEFAULT_DEBOUNCE_MS
  // Only the record's own run-in copies and pre-record rows are derived here;
  // a configured row's config columns are its own and only `active` follows.
  const configured = !!existing?.configuredAt && !existing.sharedFrom

  const reborn = !!(brief && existing?.briefNoteId && existing.briefNoteId !== brief.id && brief.spaceId === spaceId)
  if (reborn && existing) await retirePreviousIncarnation(spaceId, name, existing.id)
  const becameActive = active && !existing?.active
  await prisma.agentState.upsert({
    where: { agent_identity: { spaceId, name } },
    create: { spaceId, name, briefNoteId: brief?.id ?? null, runAsUserId, active, nextRunAt, triggersJson, debounceMs },
    update: {
      ...(brief && brief.spaceId === spaceId ? { briefNoteId: brief.id } : {}),
      runAsUserId,
      active,
      ...(configured && !reborn ? {} : { triggersJson, debounceMs }),
      // A newly (re)activated agent starts clean; an inactive one keeps its
      // reason so the panel can say why. Keep a running row's nextRunAt as is:
      // dispatch already advanced it at claim time.
      nextRunAt: existing?.status === 'running' && active ? existing.nextRunAt : nextRunAt,
      ...(becameActive ? { deactivatedReason: null, deactivatedDetail: null, consecutiveFailures: 0 } : {}),
      ...(!active && existing?.active ? { deactivatedReason: existing.deactivatedReason ?? 'admin' } : {}),
      // A new agent at an old name starts with a clean page: no last run, no
      // failure streak, none of the previous one's deactivation reason — and
      // none of its record, which the new note is adopted into afresh.
      ...(reborn
        ? {
            status: 'idle',
            currentRunId: null,
            runningSince: null,
            lastRunAt: null,
            consecutiveFailures: 0,
            deactivatedReason: null,
            deactivatedDetail: null,
            configuredAt: null,
          }
        : {}),
    },
  })
  // A house brief fans out to its run-in copies; a copy fans out to nothing
  // (a room holds no rooms, so this finds none and costs one query).
  if (!existing?.sharedFrom) {
    await syncSharedCopies(spaceId, name, parsedBrief?.ok ? parsedBrief.brief : null)
    // Before the record, `agent_subscriptions` was an index of the note's
    // `for:` block; for a configured agent it IS the list, written by the record.
    if (!agent?.config && (!brief || parsedBrief?.ok)) await indexRunsFor(spaceId, name, runsFor.map((e) => e.userId))
  }
  return { active, nextRunAt, invalid }
}

/**
 * Fold the run keys a brief note still carries into the agent's record, and
 * take them out of the note. A note with none adopts the defaults, so every
 * readable brief ends up with a record. A brief that does not parse is left
 * as it is: its own words say what is wrong, where briefs are read.
 *
 * Reached only by writes that bypass the gate — the older note shape, a seed,
 * a script. People and agents change the record through configureAgent.
 */
export async function adoptNoteConfig(spaceId: string, name: string): Promise<void> {
  const note = await findOwnAgentBrief(spaceId, name)
  if (!note) return
  const fm = parseFrontmatter(note.content)
  const { body } = splitFrontmatter(note.content)
  const keys = runKeysOf(fm)
  const row = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { briefNoteId: true, sharedFrom: true } })
  // A different note at an old name is a new agent: its keys start from nothing.
  const reborn = !!(row?.briefNoteId && row.briefNoteId !== note.id)
  if (reborn) await syncAgentState(spaceId, name)
  const current = await agentConfigOf(spaceId, name)
  if (current && keys.length === 0) return

  let next
  if (current) {
    const picked = Object.fromEntries(keys.map((k) => [k, fm[k]]))
    const merged = configFromFrontmatter({ ...configFrontmatter(current), ...picked }, body)
    if (!merged.ok) {
      logger.warn('agents: run keys in a brief did not fold into its record', { spaceId, name, error: merged.error })
      return
    }
    next = merged.config
  } else {
    const agent = await readAgent(spaceId, name)
    if (!agent?.brief.ok || !agent.activation.ok) return
    next = configOf(agent.brief.brief, agent.activation.activation)
  }
  await storeAgentConfig(spaceId, name, next, { userId: null, briefNoteId: note.id })
  if (keys.length) {
    const store = await import('@/lib/notes/store')
    await store.writeNote(
      { spaceId, ownerKey: SHARED_OWNER_KEY },
      note.path,
      joinFrontmatter(stripRunKeys(fm), body),
      SYSTEM_ACTOR,
      'maintenance',
      'agents',
    )
  }
}

/** Make the subscription rows say what the brief's `for:` block says. */
async function indexRunsFor(spaceId: string, name: string, userIds: string[]): Promise<void> {
  await prisma.agentSubscription.deleteMany({ where: { spaceId, name, userId: { notIn: userIds } } })
  if (userIds.length > 0) {
    await prisma.agentSubscription.createMany({ data: userIds.map((userId) => ({ spaceId, name, userId })), skipDuplicates: true })
  }
}

/**
 * Whether a run-in copy of `houseId`'s `name` may still stand in `roomId`:
 * the house brief exists, is shared with the room as `run-in`, and the house
 * governs the room. Read by the runner before a copy's run and by the sync
 * before re-deriving one.
 */
export async function copyStillAllowed(roomId: string, name: string, houseId: string): Promise<boolean> {
  const [room, brief] = await Promise.all([
    prisma.space.findUnique({ where: { id: roomId }, select: { id: true, parentId: true, parentAdmins: true } }),
    findOwnAgentBrief(houseId, name),
  ])
  if (!room || room.parentId !== houseId || !brief) return false
  const house = await readAgent(houseId, name)
  if (!house?.brief.ok) return false
  return copyRooms(house.brief.brief, [room]).length === 1
}

async function retireCopy(stateId: string, roomId: string, name: string): Promise<void> {
  await retirePreviousIncarnation(roomId, name, stateId)
  await prisma.agentState.delete({ where: { id: stateId } }).catch(() => undefined)
}

/**
 * The run-in copies of a house brief, made to match what the brief says now:
 * one state row per room the share reaches and the house governs
 * (config.ts#copyRooms), naming the house in `sharedFrom`; rows in rooms the
 * brief no longer reaches — or a deleted brief's — are retired. A room's own
 * agent at the same name wins: no copy lands beside it.
 */
async function syncSharedCopies(houseId: string, name: string, brief: AgentBrief | null): Promise<void> {
  const rooms = await prisma.space.findMany({ where: { parentId: houseId }, select: { id: true, parentId: true, parentAdmins: true } })
  const wanted = new Set(brief ? copyRooms(brief, rooms).map((r) => r.id) : [])
  const copies = await prisma.agentState.findMany({ where: { name, sharedFrom: houseId }, select: { id: true, spaceId: true } })
  for (const copy of copies) {
    if (!wanted.has(copy.spaceId)) await retireCopy(copy.id, copy.spaceId, name)
  }
  for (const roomId of wanted) {
    if (await findOwnAgentBrief(roomId, name)) continue
    await prisma.agentState.upsert({
      where: { agent_identity: { spaceId: roomId, name } },
      create: { spaceId: roomId, name, sharedFrom: houseId, active: false },
      update: { sharedFrom: houseId },
    })
    await syncAgentState(roomId, name)
  }
}

/**
 * Deactivation: switch the record off (only ever off — never on, never a
 * schedule), record why on the row, and leave an audit line. Safe to call
 * when already inactive. An agent from before the record is adopted first;
 * one whose brief cannot be adopted still carries `active:` in its note, and
 * `active: false` is written there instead, as the system.
 */
export async function deactivateAgent(
  spaceId: string,
  name: string,
  reason: DeactivationReason,
  detail: string | null,
  by: { userId: string; name: string } = { userId: 'system', name: 'Visvine' },
): Promise<void> {
  const copy = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { sharedFrom: true } })
  // A run-in copy has no record of its own: only its row is switched off,
  // never the house's (which keeps its other copies running).
  if (!copy?.sharedFrom) {
    await adoptNoteConfig(spaceId, name)
    const config = await agentConfigOf(spaceId, name)
    if (config) {
      if (config.active) await storeAgentConfig(spaceId, name, { ...config, active: false }, { userId: by.userId === 'system' ? null : by.userId })
    } else {
      const source = await findAgentActivation(spaceId, name)
      if (source.path && source.content && parseFrontmatter(source.content).active !== false) {
        const store = await import('@/lib/notes/store')
        await store.writeNote({ spaceId, ownerKey: SHARED_OWNER_KEY }, source.path, withActiveFalse(source.content), SYSTEM_ACTOR, 'maintenance', 'agents')
      }
    }
  }
  await prisma.agentState.updateMany({
    where: { spaceId, name },
    data: { active: false, deactivatedReason: reason, deactivatedDetail: detail },
  })
  await logAudit(spaceId, {
    userId: by.userId,
    name: by.name,
    action: 'agent',
    path: (await findAgentBrief(spaceId, name))?.path ?? agentBriefPath(name),
    detail: `deactivated: ${reason}${detail ? ` — ${detail}` : ''}`,
  })
}

// ── Store hooks ──────────────────────────────────────────────────────────────

const agentOfStamp = agentOfRevisionStamp

/**
 * After a note write (create or save). `changed` = the content actually
 * differs; `origin` / `model` are the revision stamps (an agent's own writes
 * are `agent` / `agent:<name>`).
 *
 * Two jobs: (1) every CHANGED shared-context write outside agents/ may be an
 * EVENT for agents whose `on.context` globs match it — except the agent whose
 * own run made the write (no self-loops); (2) writes under agents/ re-derive
 * the state row / auto-deactivate.
 */
export async function agentNoteWritten(
  context: Context,
  path: string,
  actor: Actor,
  opts: { changed: boolean; origin?: string; model?: string },
): Promise<void> {
  if (!isSharedContext(context)) return
  const name = agentNameOfPath(path)
  if (!name) {
    if (opts.changed) {
      await fireNoteTriggers(context.spaceId, path, actor, opts.origin ?? 'edit', {
        exceptAgent: agentOfStamp(opts.origin, opts.model),
        action: 'saved',
      })
    }
    return
  }
  const spaceId = context.spaceId

  // The brief carries the activation, so every write to it re-derives the row
  // — that is how turning an agent on takes effect. A pre-merge activation.md
  // does the same for an agent that still has one.
  if (isAgentBriefPath(path)) await adoptNoteConfig(spaceId, name)
  if (isAgentBriefPath(path) || isAgentActivationPath(path)) await syncAgentState(spaceId, name)
}

/**
 * After a note rename. A brief renamed to another agent's path is that agent
 * under a new name: deactivated, its state row (and run history) carried
 * over. The activation rides the brief, so a folder rename carries it. A
 * rename INTO a listened-on path is a `note_written` event for the `to` path
 * (a note arriving under people/ is news whether typed or moved). `stamp` is
 * how the rename arose (origin / model, as for a write): an agent run's own
 * move (`agent` / `agent:<name>`) never wakes that agent.
 */
export async function agentNoteRenamed(
  context: Context,
  from: string,
  to: string,
  actor?: Actor,
  stamp?: { origin?: string; model?: string },
): Promise<void> {
  if (!isSharedContext(context) || from === to) return
  const spaceId = context.spaceId
  const fromName = agentNameOfPath(from)
  const toName = agentNameOfPath(to)
  if (!toName) {
    await fireNoteTriggers(spaceId, to, actor ?? { id: 'unknown', name: 'someone' }, stamp?.origin ?? 'edit', {
      exceptAgent: agentOfStamp(stamp?.origin, stamp?.model),
      action: 'renamed',
    })
  }

  if (fromName && isAgentBriefPath(from)) {
    if (toName === fromName) return
    // Deactivate under the old name, then carry the row to the new one. The
    // copies under the old name are retired; the sync under the new name
    // makes new ones.
    await deactivateAgent(spaceId, fromName, 'renamed', toName ? `now ${to}` : `moved to ${to}`)
    await syncSharedCopies(spaceId, fromName, null)
    if (toName && isAgentBriefPath(to)) {
      await prisma.agentState.deleteMany({ where: { spaceId, name: toName } })
      await prisma.agentState.updateMany({ where: { spaceId, name: fromName }, data: { name: toName } })
      await syncAgentState(spaceId, toName)
    } else {
      // Moved out of agents/ — it is no longer an agent. An activation left
      // behind in the old folder is retired with the row.
      const stale = agentActivationPath(fromName)
      if (await readSharedNote(spaceId, stale)) {
        const store = await import('@/lib/notes/store')
        await store.deleteNote(context, stale)
      }
      await prisma.agentState.deleteMany({ where: { spaceId, name: fromName } })
    }
    return
  }
  if (fromName && isAgentActivationPath(from)) {
    // The activation moved — with its folder, or by hand. Either way the old
    // name has none any more, and the new one re-derives from what arrived.
    if (toName !== fromName) await syncAgentState(spaceId, fromName)
    if (toName && isAgentActivationPath(to)) await syncAgentState(spaceId, toName)
    return
  }
  if (toName && isAgentBriefPath(to)) await syncAgentState(spaceId, toName)
}

/** After a note is trashed. */
export async function agentNoteDeleted(context: Context, path: string): Promise<void> {
  if (!isSharedContext(context)) return
  const name = agentNameOfPath(path)
  if (!name) return
  const spaceId = context.spaceId
  if (isAgentBriefPath(path)) {
    await deactivateAgent(spaceId, name, 'deleted', 'brief deleted')
    // Its run-in copies go with it.
    await syncSharedCopies(spaceId, name, null)
    // The folder delete that removed the brief removes the activation with it;
    // a brief deleted on its own leaves one behind, and it is retired here.
    const live = agentActivationPath(name)
    if (await readSharedNote(spaceId, live)) {
      const store = await import('@/lib/notes/store')
      await store.deleteNote(context, live)
    }
    // The row stays (run history hangs off it) but is inert.
    await prisma.agentState.updateMany({ where: { spaceId, name }, data: { active: false, nextRunAt: null } })
    return
  }
  if (isAgentActivationPath(path)) {
    // An admin took the activation away — unless the whole agent is going, in
    // which case the brief's own delete is the reason and this is one of the
    // notes going with it. A folder delete trashes its notes in no particular
    // order, so this has to ask rather than assume it ran second.
    if (!(await findAgentBrief(spaceId, name))) return
    await prisma.agentState.updateMany({
      where: { spaceId, name },
      data: { active: false, nextRunAt: null, deactivatedReason: 'admin', deactivatedDetail: 'activation removed' },
    })
  }
}
