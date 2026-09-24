/**
 * What ONE agent's machine may reach, compiled the way its runs compile it.
 *
 * A run narrows the space's policy to the hosts its declared connectors name
 * (`connectorReachFor` → `taskAllow`, lib/agents/runner.ts). Anything that
 * shows or judges an agent's reach outside a run — the unmet reach beside a
 * pending skill, an admin's command on its machine — has to narrow the same
 * way, or it would promise the agent hosts its machine will refuse. Read
 * grant-free, because the answer is the brief's and the space's, not the
 * asker's view of them.
 */
import { compileForSpace, declaredReachHosts, type CompiledForSpace } from '@/lib/vm/policy'
import { readAgent } from './briefs'

/**
 * The `taskAllow` the agent's machine is leased under. Null when there is no
 * brief to read or it does not parse — the caller decides what that means, and
 * for a lease it means nothing, never the space's whole list.
 */
export async function agentReachHosts(spaceId: string, name: string): Promise<string[] | null> {
  const agent = await readAgent(spaceId, name)
  if (!agent?.brief.ok) return null
  return declaredReachHosts(spaceId, agent.brief.brief.connectors)
}

/** Null when there is no readable brief or no policy can be compiled. */
export async function agentMachinePolicy(spaceId: string, name: string): Promise<CompiledForSpace | null> {
  try {
    const hosts = await agentReachHosts(spaceId, name)
    if (hosts === null) return null
    return await compileForSpace(spaceId, { taskAllow: hosts })
  } catch {
    return null
  }
}
