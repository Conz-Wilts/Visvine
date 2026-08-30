/**
 * What happens to an agent's STATE ROW when its notes change. Called from the
 * note store after every write / rename / delete (beside syncContextLinks),
 * so the row is always derived from the notes and never the other way round.
 *
 * Three rules, all from the wayfinder map:
 *
 * 1. A write to `agents/<name>/index.md` re-derives `active`, `nextRunAt` and
 *    `scheduleHash` from the note — the brief IS the activation. The note is
 *    authoritative; the row is an index that can always be rebuilt. Editing a
 *    brief does not switch the agent off: the people who can edit one are the
 *    people who can turn it on, so a changed brief is not a lapsed approval.
 *    Machine deactivation (a rejected key, repeated failures) is the ONLY
 *    machine write into the activation boundary, and it can only ever set
 *    `active: false`.
 * 2. A write to a pre-merge `agents/<name>/activation.md` re-derives the row
 *    the same way, so an agent from before the merge keeps working until
 *    `db:agents:activation` folds it in.
 * 3. A rename or delete of the agent always deactivates — simple and safe;
 *    re-activating is one click. The activation rides the brief, so a folder
 *    rename or delete carries it by itself; the hook only has to move the
 *    state row.
 *
 * Only prisma, the pure parsers, audit and auth are imported statically; the
 * store is reached by dynamic import because the store imports this file.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { spaceAdminUserIds } from '@/lib/auth'
import { logAudit } from '@/lib/notes/audit'
import { notify } from '@/lib/notifications/service'
import {
  agentNameOfPath,
  agentOfRevisionStamp,
  isAgentActivationPath,
  isAgentBriefPath,
} from '@/lib/notes/entities'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import type { Actor, Context } from '@/lib/notes/store'

// Redeclared (as entityLinks.ts does) rather than imported: the store imports
// this module, and a value import back would make an eval-time cycle.
const SHARED_OWNER_KEY = 'shared'
import {
  agentActivationPath,
  agentBriefPath,
  agentPageHref,
  nextOccurrence,
  scheduleHash,
  withActiveFalse,
  type AgentActivation,
  DEFAULT_DEBOUNCE_MS,
} from './config'
import { findAgentActivation, findAgentBrief } from './briefs'
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
  const briefRead = findAgentBrief(spaceId, name)
  if (activation === undefined || activation === null) {
    const found = await findAgentActivation(spaceId, name)
    if (found.parsed?.ok) activation = found.parsed.activation
    else if (found.parsed) invalid = found.parsed.error
  }
  const brief = await briefRead
  // Who the agent acts as. The brief's author by default — a member's agent
  // reaches exactly what that member reaches — unless the activation repoints
  // it with `runs_as`. That matters most for connectors with an `auth:` block:
  // a run spends somebody's stored credentials, so the write gate lets a member
  // name only themselves there and an admin anyone (contextService.writeGated).
  const runAsUserId = activation?.runsAs ?? brief?.createdBy ?? null

  // Active = the note says so AND it has some way to fire (a clock or a trigger).
  const active = !!(activation?.active && (activation.schedule || activation.on) && brief)
  const tz = await effectiveTimezone(spaceId, activation?.timezone ?? null)
  let nextRunAt = active && activation?.schedule ? nextOccurrence(activation.schedule, now, tz) : null
  // Mail already waiting (arrived while inactive, or just before this
  // re-derive) keeps its debounce deadline rather than being pushed out to the
  // next clock occurrence.
  if (active && activation && (await hasPendingEvents(spaceId, name))) {
    const soon = new Date(now.getTime() + activation.debounceMs)
    if (!nextRunAt || soon < nextRunAt) nextRunAt = soon
  }
  const hash = activation ? scheduleHash(activation, tz) : null
  const triggersJson = activation?.on ? { context: activation.on.context, webhook: activation.on.webhook } : Prisma.DbNull
  const debounceMs = activation?.debounceMs ?? DEFAULT_DEBOUNCE_MS

  const existing = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  const becameActive = active && !existing?.active
  await prisma.agentState.upsert({
    where: { agent_identity: { spaceId, name } },
    create: { spaceId, name, runAsUserId, active, nextRunAt, scheduleHash: hash, triggersJson, debounceMs },
    update: {
      runAsUserId,
      active,
      scheduleHash: hash,
      triggersJson,
      debounceMs,
      // A newly (re)activated agent starts clean; an inactive one keeps its
      // reason so the panel can say why. Keep a running row's nextRunAt as is:
      // dispatch already advanced it at claim time.
      nextRunAt: existing?.status === 'running' && active ? existing.nextRunAt : nextRunAt,
      ...(becameActive ? { deactivatedReason: null, deactivatedDetail: null, consecutiveFailures: 0 } : {}),
      ...(!active && existing?.active ? { deactivatedReason: existing.deactivatedReason ?? 'admin' } : {}),
    },
  })
  return { active, nextRunAt, invalid }
}

/**
 * Machine deactivation: write `active: false` into the note that carries the
 * activation, as the system principal (only ever false — never true, never a
 * schedule), record
 * why on the row, and leave an audit line. Safe to call when already inactive.
 */
export async function deactivateAgent(
  spaceId: string,
  name: string,
  reason: DeactivationReason,
  detail: string | null,
  by: { userId: string; name: string } = { userId: 'system', name: 'Visvine' },
): Promise<void> {
  // Snapshot the row BEFORE touching the note: writing `active: false` below
  // runs the store hook, which re-derives the row inactive — read afterwards it
  // would always say "already off" and the notification would never send.
  const [state, source] = await Promise.all([
    prisma.agentState.findFirst({ where: { spaceId, name }, select: { active: true, runAsUserId: true } }),
    findAgentActivation(spaceId, name),
  ])
  // Into whichever note carries the activation — the brief, or a pre-merge
  // activation.md an agent still has. Only ever `active: false`.
  if (source.path && source.content && parseFrontmatter(source.content).active !== false) {
    const store = await import('@/lib/notes/store')
    // origin 'maintenance' stamps the revision as a machine act; the store
    // is ungated (the gate lives in contextService), so no principal needed.
    await store.writeNote({ spaceId, ownerKey: SHARED_OWNER_KEY }, source.path, withActiveFalse(source.content), SYSTEM_ACTOR, 'maintenance', 'agents')
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
  // A MACHINE deactivation is news to the people who can fix it: the brief's
  // author, whoever the live note runs it as, and the admins (who re-activate).
  // A person's own act (admin switch, rename, delete) is not — they were there.
  // Only when it WAS active: re-deactivating an idle agent tells nobody anything.
  if (state?.active && reason !== 'admin' && reason !== 'renamed' && reason !== 'deleted') {
    void (async () => {
      const brief = await findAgentBrief(spaceId, name)
      const recipients = [brief?.createdBy, state.runAsUserId, ...(await spaceAdminUserIds(spaceId))].filter((id): id is string => !!id)
      await notify(recipients, {
        spaceId,
        kind: 'agent_deactivated',
        title: `Agent ${name} was deactivated (${reason.replace(/_/g, ' ')})`,
        body: detail,
        href: agentPageHref(name),
        dedupeKey: `agent:${spaceId}:${name}:deactivated`,
      })
    })().catch(() => {})
  }
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
    // Deactivate under the old name, then carry the row to the new one.
    await deactivateAgent(spaceId, fromName, 'renamed', toName ? `now ${to}` : `moved to ${to}`)
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
