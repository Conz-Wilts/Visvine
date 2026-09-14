/**
 * The control-plane half of the egress policy: turning a space into the list
 * its agents' machines are held to.
 *
 * The decision itself is `@visvine/vm-policy` — pure, shared with the edge, and
 * the only place the rules live. This file is the I/O half: it reads the
 * space's connector notes, folds in what an admin added and what the run asked
 * for, and hands back a policy plus the digest that rides the lease row.
 *
 * A space's reach is what its connectors already declare. That is deliberate:
 * `hosts:` is admin-written, literal, and already the answer to "what may this
 * space talk to" for the isolate — an agent's machine gets the same answer from
 * the same place rather than a second list that drifts from it.
 */
import { createHash } from 'node:crypto'
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled, parseConnectorPerimeter } from '@/lib/connectors/config'
import { logger } from '@/lib/logger'
import { canonical, compile, type InjectRule, type VmPolicy } from '@visvine/vm-policy'
import { machineHostPatterns } from './shared/hosts'
import { parentOfSubspace } from '@/lib/spaces/subspaceAccess'
import { reachesRoom } from '@/lib/spaces/subspaces'

const SHARED_OWNER_KEY = 'shared'

export interface CompileOptions {
  /** A run may narrow. Undefined means the space's own list. */
  taskAllow?: readonly string[]
  /** Hosts that reach a human first (§12). */
  approval?: readonly string[]
  inject?: readonly InjectRule[]
}

export interface CompiledForSpace {
  policy: VmPolicy
  /** sha256 of the canonical form — stored on the lease, compared on wake. */
  digest: string
  /** Task entries the space does not permit. Dropped, and worth saying so. */
  dropped: readonly string[]
  /** Connector notes whose perimeter could not be read; their hosts are not granted. */
  unreadable: readonly string[]
  /** Hosts a connector names that policy cannot enforce, so the machine does not get them. */
  rejected: readonly string[]
}

interface EgressHosts {
  hosts: string[]
  unreadable: string[]
  rejected: string[]
}

/**
 * The hosts the named connector notes declare, read the way the space's own
 * list is: grant-free, `type: connector`, switched on, perimeter parseable.
 * `names` undefined means every connector the space has.
 */
async function connectorRows(spaceId: string, names?: readonly string[]) {
  return prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      path: names ? { in: names.map((name) => `connectors/${name}.md`) } : { startsWith: 'connectors/', endsWith: '.md' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
}

async function egressHosts(spaceId: string, names?: readonly string[]): Promise<EgressHosts> {
  const own = await connectorRows(spaceId, names)

  // What the parent shares reaches its rooms' machines too: a sub-space's
  // agent naming the parent's `hubspot` resolves the parent's note
  // (lib/connectors/service.ts#readConnectorNote), so its machine is held to
  // the same hosts. Only the parent's notes whose `share:` reaches THIS room
  // (`all`, or a list naming it), and only for names this space has no note
  // of its own for — the same order the run resolves them in.
  const ownNames = new Set(own.map((row) => row.path))
  const wanted = names?.filter((name) => !ownNames.has(`connectors/${name}.md`))
  const parent = wanted?.length === 0 ? null : await parentOfSubspace(spaceId)
  const theirs = parent ? await connectorRows(parent.id, wanted) : []

  const hosts = new Set<string>()
  const unreadable: string[] = []
  const rejected: string[] = []
  const read = (row: { path: string; content: string }, sharedOnly: boolean) => {
    const fm = parseFrontmatter(row.content)
    if (fm.type !== 'connector') return
    // A connector switched off is not reach the space has. Same reading as
    // loadConnector's, so "turn off" means one thing everywhere.
    if (!isConnectorEnabled(fm)) return
    const parsed = parseConnectorPerimeter(fm)
    if (!parsed.ok) {
      unreadable.push(row.path)
      return
    }
    if (sharedOnly && !reachesRoom(parsed.perimeter.share, spaceId)) return
    const found = machineHostPatterns(parsed.perimeter.hosts)
    for (const host of found.patterns) hosts.add(host)
    for (const host of found.rejected) rejected.push(`${row.path}: ${host}`)
  }
  for (const row of own) read(row, false)
  for (const row of theirs) if (!ownNames.has(row.path)) read(row, true)
  return { hosts: [...hosts].sort(), unreadable, rejected }
}

/**
 * What a brief's `connectors:` reach, as the `taskAllow` its machine is leased
 * under. Read without a principal on purpose: the hosts a connector names are
 * the space's configuration, not a member's view of it, so whoever asks — the
 * runner, an admin's vm_exec, the skills dialog — gets the same answer the
 * run will be held to. A brief naming nothing reaches nothing.
 */
export async function declaredReachHosts(spaceId: string, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return []
  return (await egressHosts(spaceId, names)).hosts
}

/**
 * The policy an agent's machine boots under.
 *
 * Compilation refuses rather than degrades: a pattern the grammar cannot
 * enforce is a configuration error, and an agent that cannot be given a policy
 * does not get a machine. The one thing this never does is fall back to a
 * wider list.
 */
export async function compileForSpace(spaceId: string, options: CompileOptions = {}): Promise<CompiledForSpace> {
  const { hosts, unreadable, rejected } = await egressHosts(spaceId)
  if (unreadable.length > 0) {
    // The app working as designed for a malformed note — a warn, not an error.
    logger.warn('vm.policy.unreadable_connector', { spaceId, paths: unreadable })
  }
  if (rejected.length > 0) {
    logger.warn('vm.policy.unenforceable_host', { spaceId, hosts: rejected })
  }

  const { policy, dropped } = compile({
    spaceAllow: hosts,
    taskAllow: options.taskAllow,
    approval: options.approval,
    inject: options.inject,
  })

  if (dropped.length > 0) {
    logger.warn('vm.policy.task_narrowing_dropped', { spaceId, dropped })
  }
  if (policy.allow.length === 0 && options.taskAllow === undefined) {
    // Denies everything, which is the safe direction — but it means the space
    // has no connectors, or every one of them is off, and an agent about to sit
    // there unable to reach anything is worth saying out loud. A run that
    // narrowed to nothing is a brief declaring no connectors, which is that
    // brief's choice and not the space's problem.
    logger.warn('vm.policy.empty_allow_list', { spaceId })
  }

  return { policy, digest: digestOf(policy), dropped, unreadable, rejected }
}

/** The identity a lease records, so a running machine can be checked against it. */
function digestOf(policy: VmPolicy): string {
  return createHash('sha256').update(canonical(policy)).digest('hex').slice(0, 32)
}
