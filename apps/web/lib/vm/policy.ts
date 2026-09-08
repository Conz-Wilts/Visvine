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

/** Every host the space's enabled connectors declare, as policy patterns. */
async function spaceEgressHosts(
  spaceId: string,
): Promise<{ hosts: string[]; unreadable: string[]; rejected: string[] }> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      path: { startsWith: 'connectors/', endsWith: '.md' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })

  const hosts = new Set<string>()
  const unreadable: string[] = []
  const rejected: string[] = []
  for (const row of rows) {
    const fm = parseFrontmatter(row.content)
    if (fm.type !== 'connector') continue
    // A connector switched off is not reach the space has. Same reading as
    // loadConnector's, so "turn off" means one thing everywhere.
    if (!isConnectorEnabled(fm)) continue
    const parsed = parseConnectorPerimeter(fm)
    if (!parsed.ok) {
      unreadable.push(row.path)
      continue
    }
    const found = machineHostPatterns(parsed.perimeter.hosts)
    for (const host of found.patterns) hosts.add(host)
    for (const host of found.rejected) rejected.push(`${row.path}: ${host}`)
  }
  return { hosts: [...hosts].sort(), unreadable, rejected }
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
  const { hosts, unreadable, rejected } = await spaceEgressHosts(spaceId)
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
  if (policy.allow.length === 0) {
    // Denies everything, which is the safe direction — but it means the space
    // has no connectors, or every one of them is off, and an agent about to sit
    // there unable to reach anything is worth saying out loud.
    logger.warn('vm.policy.empty_allow_list', { spaceId })
  }

  return { policy, digest: digestOf(policy), dropped, unreadable, rejected }
}

/** The identity a lease records, so a running machine can be checked against it. */
function digestOf(policy: VmPolicy): string {
  return createHash('sha256').update(canonical(policy)).digest('hex').slice(0, 32)
}
