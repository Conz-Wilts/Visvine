/**
 * The settings a person or an AI may change on an agent's record, as one Zod
 * schema — read by `PUT …/agents/<name>/config` and the `configure_agent`
 * action alike, so the two doors cannot drift. The schedule is turned on and
 * off through activation (service.ts#activateAgent) and who it runs for
 * through the subscribers route; money is the budget route's.
 */
import { z } from 'zod'
import { AGENT_TOOL_EXTRAS } from './config'
import type { AgentConfigPatch } from './shared/agentConfig'

export const agentConfigInput = z
  .object({
    model: z.string().trim().max(200).nullable().optional().describe('A pinned `<provider>/<id>`; null (or empty) runs on the space model.'),
    connectors: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe('Connector names this agent may use.'),
    tools: z.array(z.enum(AGENT_TOOL_EXTRAS)).optional().describe(`Optional extras: ${AGENT_TOOL_EXTRAS.join(', ')}.`),
    agents: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe('Agents this one may start with run_agent.'),
    share: z.union([z.enum(['none', 'all']), z.array(z.string().trim().min(1).max(80)).max(100)]).optional().describe('Which sub-spaces it is shared into.'),
    share_as: z.enum(['use', 'run-in']).optional(),
    dry_run: z.boolean().optional().describe('Record writes in the transcript instead of applying them.'),
    max_turns: z.number().int().min(1).max(200).optional(),
    runs_as: z.string().trim().min(1).max(80).nullable().optional().describe('Whose identity scheduled runs act as; null for its author. Only an admin names someone else.'),
  })
  .strict()

export type AgentConfigInput = z.infer<typeof agentConfigInput>

export function configPatchOf(input: AgentConfigInput): AgentConfigPatch {
  const patch: AgentConfigPatch = {}
  if (input.model !== undefined) patch.model = input.model?.trim() || null
  if (input.connectors !== undefined) patch.connectors = [...new Set(input.connectors)]
  if (input.tools !== undefined) patch.tools = [...new Set(input.tools)]
  if (input.agents !== undefined) patch.agents = [...new Set(input.agents)]
  if (input.share !== undefined) patch.share = Array.isArray(input.share) && input.share.length === 0 ? 'none' : input.share
  if (input.share_as !== undefined) patch.shareAs = input.share_as
  if (input.dry_run !== undefined) patch.dryRun = input.dry_run
  if (input.max_turns !== undefined) patch.maxTurns = input.max_turns
  if (input.runs_as !== undefined) patch.runsAs = input.runs_as
  return patch
}
