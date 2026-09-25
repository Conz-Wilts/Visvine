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
import { MAX_AGENT_INPUTS, MAX_INPUT_VALUE } from './shared/inputs'

export const agentConfigInput = z
  .object({
    model: z.string().trim().max(200).nullable().optional().describe('A pinned `<provider>/<id>`; null (or empty) runs on the space model.'),
    fallback_model: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .describe('A `<provider>/<id>` of this space tried ONCE when a run ends short on the main model; null (or empty) for none. Costs a second run only when the first fell short.'),
    connectors: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe('Connector names this agent may use.'),
    tools: z.array(z.enum(AGENT_TOOL_EXTRAS)).optional().describe(`Optional extras: ${AGENT_TOOL_EXTRAS.join(', ')}.`),
    agents: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe('Agents this one may start with run_agent.'),
    share: z.union([z.enum(['none', 'all']), z.array(z.string().trim().min(1).max(80)).max(100)]).optional().describe('Which sub-spaces it is shared into.'),
    share_as: z.enum(['use', 'run-in']).optional(),
    dry_run: z.boolean().optional().describe('Record writes in the transcript instead of applying them.'),
    max_turns: z.number().int().min(1).max(200).optional(),
    runs_as: z.string().trim().min(1).max(80).nullable().optional().describe('Whose identity scheduled runs act as; null for its author. Only an admin names someone else.'),
    inputs: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40).describe('lowercase_with_underscores; the brief names it as {{key}}.'),
          label: z.string().trim().max(60).optional(),
          kind: z.enum(['text', 'select']).optional(),
          options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
          required: z.boolean().optional(),
        }),
      )
      .max(MAX_AGENT_INPUTS)
      .optional()
      .describe(
        "Values that are each person's own — the Slack channel to post in, the address to send to. Each person the agent runs for sets theirs; the brief names one as {{key}}. Never write a person's channel or address into a brief others run.",
      ),
    input_values: z
      .record(z.string(), z.string().max(MAX_INPUT_VALUE))
      .optional()
      .describe('The values for `inputs` when it runs as its own identity (its author, or `runs_as`).'),
  })
  .strict()

export type AgentConfigInput = z.infer<typeof agentConfigInput>

export function configPatchOf(input: AgentConfigInput): AgentConfigPatch {
  const patch: AgentConfigPatch = {}
  if (input.model !== undefined) patch.model = input.model?.trim() || null
  if (input.fallback_model !== undefined) patch.fallbackModel = input.fallback_model?.trim() || null
  if (input.connectors !== undefined) patch.connectors = [...new Set(input.connectors)]
  if (input.tools !== undefined) patch.tools = [...new Set(input.tools)]
  if (input.agents !== undefined) patch.agents = [...new Set(input.agents)]
  if (input.share !== undefined) patch.share = Array.isArray(input.share) && input.share.length === 0 ? 'none' : input.share
  if (input.share_as !== undefined) patch.shareAs = input.share_as
  if (input.dry_run !== undefined) patch.dryRun = input.dry_run
  if (input.max_turns !== undefined) patch.maxTurns = input.max_turns
  if (input.runs_as !== undefined) patch.runsAs = input.runs_as
  if (input.inputs !== undefined) {
    patch.inputs = input.inputs.map((i) => ({
      key: i.key,
      label: i.label?.trim() || i.key,
      kind: i.kind ?? 'text',
      options: i.options ?? [],
      required: i.required ?? true,
    }))
  }
  if (input.input_values !== undefined) {
    patch.inputValues = Object.fromEntries(Object.entries(input.input_values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
  }
  return patch
}
