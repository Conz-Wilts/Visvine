/**
 * What happens to an agent's STATE ROW when its notes change. Called from the
 * note store after every write / rename / delete (beside syncContextLinks),
 * so the row is always derived from the notes and never the other way round.
 *
 * Three rules, all from the wayfinder map:
 *
 * 1. A write to `agents/live/<name>.md` re-derives `active`, `nextRunAt` and
 *    `scheduleHash` from the note. The note is authoritative; the row is an
 *    index that can always be rebuilt.
 * 2. A MEMBER's edit to `agents/<name>.md` while it is live auto-deactivates
 *    the agent — the admin approved a specific brief, and that approval does
 *    not survive someone else rewriting it. The system principal writes
 *    `active: false` into the activation note (the ONLY machine write into
 *    the activation boundary, and it can only ever set false), plus an audit
 *    line naming the member. An ADMIN's edit is itself the approval: nothing
 *    happens.
 * 3. A rename or delete of the brief carries the activation note with it and
 *    always deactivates — simple and safe; an admin re-activates in one click.
 *
 * Only prisma, the pure parsers, audit and auth are imported statically; the
 * store is reached by dynamic import because the store imports this file.
 */
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/notes/audit'
import {
  agentNameOfPath,
  isAgentActivationPath,
  isAgentBriefPath,
} from '@/lib/notes/entities'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { Actor, Context } from '@/lib/notes/store'

// Redeclared (as entityLinks.ts does) rather than imported: the store imports
// this module, and a value import back would make an eval-time cycle.
const SHARED_OWNER_KEY = 'shared'
import {
  agentActivationPath,
  agentBriefPath,
  nextOccurrence,
  parseAgentActivation,
  scheduleHash,
  type AgentActivation,
} from './config'

/** The actor for machine writes into the activation boundary. */
const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Visvine' }

export type DeactivationReason =
  | 'brief_changed'
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

/** The IANA zone a live agent runs in: note → Space → UTC. */
export async function effectiveTimezone(spaceId: string, noteTz: string | null): Promise<string> {
  if (noteTz) return noteTz
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { timezone: true } })
  return space?.timezone || 'UTC'
}

/**
 * Re-derive the state row for one agent from its activation note (or from a
 * parsed activation the caller already has). Creates the row when missing.
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
  if (activation === undefined || activation === null) {
    const live = await readSharedNote(spaceId, agentActivationPath(name))
    if (live) {
      const parsed = parseAgentActivation(parseFrontmatter(live.content))
      if (parsed.ok) activation = parsed.activation
      else invalid = parsed.error
    }
  }
  const brief = await readSharedNote(spaceId, agentBriefPath(name))
  const runAsUserId = brief?.createdBy ?? null

  const active = !!(activation?.active && activation.schedule && brief)
  const tz = await effectiveTimezone(spaceId, activation?.timezone ?? null)
  const nextRunAt = active && activation?.schedule ? nextOccurrence(activation.schedule, now, tz) : null
  const hash = activation ? scheduleHash(activation, tz) : null

  const existing = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  const becameActive = active && !existing?.active
  await prisma.agentState.upsert({
    where: { agent_identity: { spaceId, name } },
    create: { spaceId, name, runAsUserId, active, nextRunAt, scheduleHash: hash },
    update: {
      runAsUserId,
      active,
      scheduleHash: hash,
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
 * Machine deactivation: write `active: false` into the activation note as the
 * system principal (only ever false — never true, never a schedule), record
 * why on the row, and leave an audit line. Safe to call when already inactive.
 */
export async function deactivateAgent(
  spaceId: string,
  name: string,
  reason: DeactivationReason,
  detail: string | null,
  by: { userId: string; name: string } = { userId: 'system', name: 'Visvine' },
): Promise<void> {
  const path = agentActivationPath(name)
  const live = await readSharedNote(spaceId, path)
  if (live) {
    const fm = parseFrontmatter(live.content)
    if (fm.active !== false) {
      const { body } = splitFrontmatter(live.content)
      const next = joinFrontmatter({ ...fm, active: false }, body)
      const store = await import('@/lib/notes/store')
      // origin 'maintenance' stamps the revision as a machine act; the store
      // is ungated (the gate lives in contextService), so no principal needed.
      await store.writeNote({ spaceId, ownerKey: SHARED_OWNER_KEY }, path, next, SYSTEM_ACTOR, 'maintenance', 'agents')
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
    path: agentBriefPath(name),
    detail: `deactivated: ${reason}${detail ? ` — ${detail}` : ''}`,
  })
}

/** Is this actor a space admin (or the system)? Members trigger auto-deactivate; admins don't. */
async function actorIsAdmin(spaceId: string, actor: Actor): Promise<boolean> {
  if (actor.id === SYSTEM_ACTOR.id) return true
  return isAdmin(actor.id, spaceId, actor.email ?? null)
}

// ── Store hooks ──────────────────────────────────────────────────────────────

/** After a note write (create or save). `changed` = the content actually differs. */
export async function agentNoteWritten(
  context: Context,
  path: string,
  actor: Actor,
  opts: { changed: boolean },
): Promise<void> {
  if (!isSharedContext(context)) return
  const name = agentNameOfPath(path)
  if (!name) return
  const spaceId = context.spaceId

  if (isAgentActivationPath(path)) {
    await syncAgentState(spaceId, name)
    return
  }
  if (isAgentBriefPath(path)) {
    const state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
    if (!state) {
      await syncAgentState(spaceId, name) // creates the row (inactive) so the roster has it
      return
    }
    if (state.active && opts.changed && !(await actorIsAdmin(spaceId, actor))) {
      await deactivateAgent(spaceId, name, 'brief_changed', `brief edited by ${actor.name}`, {
        userId: actor.id,
        name: actor.name,
      })
    } else if (state.runAsUserId === null) {
      await syncAgentState(spaceId, name)
    }
  }
}

/** After a note rename. Carries the activation note with the brief and deactivates. */
export async function agentNoteRenamed(context: Context, from: string, to: string): Promise<void> {
  if (!isSharedContext(context) || from === to) return
  const spaceId = context.spaceId
  const fromName = agentNameOfPath(from)
  const toName = agentNameOfPath(to)

  if (fromName && isAgentBriefPath(from)) {
    // Deactivate under the old name, then move the row + activation note.
    await deactivateAgent(spaceId, fromName, 'renamed', toName ? `now agents/${toName}.md` : `moved to ${to}`)
    const store = await import('@/lib/notes/store')
    const liveFrom = agentActivationPath(fromName)
    if (toName && isAgentBriefPath(to)) {
      if (await readSharedNote(spaceId, liveFrom)) {
        const liveTo = agentActivationPath(toName)
        if (!(await readSharedNote(spaceId, liveTo))) await store.renameNote(context, liveFrom, liveTo)
      }
      await prisma.agentState.deleteMany({ where: { spaceId, name: toName } })
      await prisma.agentState.updateMany({ where: { spaceId, name: fromName }, data: { name: toName } })
      await syncAgentState(spaceId, toName)
    } else {
      // Moved out of agents/ — it is no longer an agent. Retire the activation.
      if (await readSharedNote(spaceId, liveFrom)) await store.deleteNote(context, liveFrom)
      await prisma.agentState.deleteMany({ where: { spaceId, name: fromName } })
    }
    return
  }
  if (fromName && isAgentActivationPath(from)) {
    // Someone moved an activation note by hand: whatever it now is, the old
    // agent has no activation any more.
    await syncAgentState(spaceId, fromName)
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
    await prisma.agentState.updateMany({
      where: { spaceId, name },
      data: { active: false, nextRunAt: null, deactivatedReason: 'admin', deactivatedDetail: 'activation removed' },
    })
  }
}
