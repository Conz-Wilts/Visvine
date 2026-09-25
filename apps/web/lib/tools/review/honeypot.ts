/**
 * The dynamic run's space: made for one run, seeded from its plan
 * (./shared/canaries.ts#planHoneypot), read back when the run ends, deleted.
 *
 * Two system accounts stand in it, neither of whom anyone can sign in as —
 * sessions for them are minted server-side and nowhere else:
 *
 *   the runner     the honeypot's admin, and the viewer the Tool runs for, so
 *                  it reads everything the Tool may — admins-only notes too
 *   the observer   an ordinary member. What it can read is what "everyone in
 *                  the space" means when the scan asks whether an admins-only
 *                  note was written somewhere wider
 *
 * Every member reads the space's root (one space-wide view grant, like a room
 * whose context flows up), and each admins-only canary is restricted, so the
 * two audiences differ exactly where the plan says.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { provisionSpace } from '@/lib/spaces/provision'
import { purgeSpaceObjects } from '@/lib/storage/purge'
import { canReadPath, writeGated } from '@/lib/notes/contextService'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { setFolderRestricted } from '@/lib/notes/access'
import { LEVEL_VIEW } from '@/lib/notes/shared/authz'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import { principalForUser } from '@/lib/agents/principal'
import { runAction } from '@/lib/actions/run'
import { addTrackedField } from '@/lib/directory/table'
import { updateSpaceConfig } from '@/lib/spaces/spaceConfig'
import { reprojectTypes } from '@/lib/records/projection'
import type { NodeTypeConfig } from '@/lib/types/context'
import type { HoneypotPlan, RunEvidence } from './shared/canaries'

const RUNNER = { email: 'tool-review-runner@system.visvine.invalid', name: 'Visvine review' }
const OBSERVER = { email: 'tool-review-observer@system.visvine.invalid', name: 'Visvine review observer' }

interface SystemUser {
  id: string
  name: string
  email: string
}

async function systemUser(who: { email: string; name: string }): Promise<SystemUser> {
  const row = await prisma.user.upsert({
    where: { email: who.email },
    create: { email: who.email, name: who.name },
    update: {},
    select: { id: true, name: true, email: true },
  })
  return row
}

export interface Honeypot {
  spaceId: string
  runner: SystemUser
  observer: SystemUser
}

const shared = (spaceId: string): Context => ({ spaceId, ownerKey: SHARED_OWNER_KEY })

/** Make the run's space and plant what the plan says. */
export async function makeHoneypot(runId: string, plan: HoneypotPlan): Promise<Honeypot> {
  const [runner, observer] = await Promise.all([systemUser(RUNNER), systemUser(OBSERVER)])
  const made = await provisionSpace({
    name: `Review ${runId.slice(0, 8)}`,
    visibility: 'private',
    creator: { id: runner.id, name: runner.name, email: runner.email },
  })
  if (!made.ok) throw new Error(`The honeypot could not be made: ${made.error}`)
  const spaceId = made.space.id
  await prisma.$transaction([
    prisma.spaceMember.create({ data: { userId: observer.id, spaceId, status: 'active' } }),
    prisma.contextGrant.create({
      data: { spaceId, subjectType: 'space', subjectId: '', resourcePath: '', level: LEVEL_VIEW, grantedBy: runner.id },
    }),
  ])

  const session = { userId: runner.id, name: runner.name, email: runner.email }
  const resolved = await resolveContext(session, spaceId)
  if (resolved instanceof Response) throw new Error('The review runner cannot stand in its own honeypot.')
  const principal = await principalOf(resolved)
  const actor = { userId: runner.id, name: runner.name }

  // The types the Tool reads or edits, with the fields it names.
  if (plan.types.length) {
    const caller = { userId: runner.id, name: runner.name, email: runner.email, scopes: ['context:write'] }
    for (const type of plan.types) {
      await runAction(caller, 'add_type', { space_id: spaceId, name: type.name }).catch(() => undefined)
    }
    await updateSpaceConfig(spaceId, (stored) => ({
      nodeTypes: (stored.nodeTypes ?? []).map((config): NodeTypeConfig => {
        const wanted = plan.types.find((type) => type.name.toLowerCase() === config.name.toLowerCase())
        if (!wanted) return config
        let next = config
        for (const field of wanted.fields) {
          const added = addTrackedField(next, { label: field, kind: 'text' })
          if (added.ok) next = added.config
        }
        return next
      }),
    }))
  }

  for (const note of [...plan.notes, ...plan.records]) {
    const written = await writeGated(principal, shared(spaceId), note.path, note.content, 'edit')
    if (written.status === 'denied') throw new Error(`The honeypot refused ${note.path}: ${written.reason}`)
  }
  for (const note of plan.notes.filter((n) => n.restricted)) {
    await setFolderRestricted(spaceId, note.path, true, actor)
  }
  if (plan.types.length) await reprojectTypes(spaceId, plan.types.map((type) => type.name))
  return { spaceId, runner, observer }
}

/** Every note in the honeypot now, and whether an ordinary member could read it. */
export async function readHoneypot(honeypot: Honeypot): Promise<RunEvidence['notes']> {
  const observer = await principalForUser(honeypot.spaceId, honeypot.observer.id)
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: honeypot.spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    select: { path: true, content: true },
  })
  return rows.map((row) => ({
    path: row.path,
    content: row.content,
    restricted: !observer || !canReadPath(observer, shared(honeypot.spaceId), row.path),
  }))
}

/** The honeypot goes when its run ends, bytes first like any space's. */
export async function dropHoneypot(spaceId: string): Promise<void> {
  await purgeSpaceObjects(spaceId).catch((err) => logger.warn('tools.review.honeypot_purge_failed', { err, spaceId }))
  await prisma.space.delete({ where: { id: spaceId } }).catch((err) => logger.warn('tools.review.honeypot_delete_failed', { err, spaceId }))
}
