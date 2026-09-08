/**
 * What ONE agent's machine may reach, compiled the way its runs compile it.
 *
 * A run narrows the space's policy to the hosts its declared connectors name
 * (`connectorReachFor` → `taskAllow`, lib/agents/runner.ts). Anything that
 * shows or judges an agent's reach outside a run — the unmet reach beside a
 * pending skill, say — has to narrow the same way, or it would promise the
 * agent hosts its machine will refuse.
 */
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { connectorReachFor } from '@/lib/connectors/service'
import { compileForSpace, type CompiledForSpace } from '@/lib/vm/policy'
import { findAgentBrief } from './briefs'
import { parseAgentBrief } from './config'

/** Null when there is no readable brief or no policy can be compiled. */
export async function agentMachinePolicy(
  principal: ContextPrincipal,
  context: Context,
  name: string,
): Promise<CompiledForSpace | null> {
  const row = await findAgentBrief(context.spaceId, name)
  if (!row) return null
  const parsed = parseAgentBrief(parseFrontmatter(row.content), splitFrontmatter(row.content).body)
  if (!parsed.ok) return null
  const reach = await connectorReachFor(principal, context, parsed.brief.connectors)
  return compileForSpace(context.spaceId, { taskAllow: reach.hosts }).catch(() => null)
}
