import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { canTriggerRun } from '@/lib/agents/service'
import { agentConfigOf, composeAgent, findAgentBrief } from '@/lib/agents/briefs'
import { syncAgentState } from '@/lib/agents/hooks'
import { createRun, finishRun, type AgentRunEvent, type TerminalReason } from '@/lib/agents/runs'
import { isLocalRuntimeId, localAgentPreamble, localModelRef, localRuntimeOf, localRuntimesEnabled } from '@/lib/agents/local'
import { readVisible } from '@/lib/notes/contextService'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { parseBody } from '@/lib/api/route'

/**
 * A run on a member's own plan, from the desktop app (lib/agents/local.ts).
 *
 * GET hands the desktop what a run is given — the local preamble, the brief,
 * the agent's memory note — and where the visvine tool is, so the prompt is
 * assembled by the same code a server run would use and the binary on the
 * member's machine only has to run it. POST records what came back: the
 * events, the usage and the summary, as an ordinary run row under the
 * agent, metered in tokens with no dollars (the plan paid, not the space).
 *
 * Both need what Run needs — someone who can edit the brief — and a brief
 * that actually pins `local/<runtime>`: a server-run brief posted here would
 * be a run nobody ran.
 */
const MCP_TOOL_NAME = 'visvine'

async function localBrief(spaceId: string, name: string, ctx: Awaited<ReturnType<typeof requireAgentsAccess>>) {
  if (ctx instanceof Response) return ctx
  if (!(await canTriggerRun(ctx.principal, spaceId, name))) return bad('Only someone who can edit this agent can run it.', 403)
  const row = await findAgentBrief(spaceId, name)
  const content = row ? await readVisible(ctx.principal, ctx.resolved, row.path) : null
  if (!row || content === null) return bad('No such agent.', 404)
  const parsed = composeAgent(content, await agentConfigOf(spaceId, name)).brief
  if (!parsed.ok) return bad(`The brief is invalid: ${parsed.error}`)
  const runtime = localRuntimeOf(parsed.brief.model)
  if (!runtime) return bad('This agent runs on the space’s model, not on your plan — run it with Run.')
  if (!localRuntimesEnabled()[runtime]) return bad(`Running on your ${runtime === 'claude' ? 'Claude' : 'ChatGPT'} plan is switched off on this deployment.`, 403)
  return { ctx, row, brief: parsed.brief, body: splitFrontmatter(content).body, runtime }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const got = await localBrief(spaceId, name, await requireAgentsAccess(spaceId))
  if (got instanceof Response) return got
  const memory = await readVisible(got.ctx.principal, got.ctx.resolved, `agents/${name}/memory.md`)
  const prompt = [
    localAgentPreamble(name, { hasVisvineTool: true }),
    got.body.trim(),
    ...(memory ? ['', '# Your memory (agents/' + name + '/memory.md)', splitFrontmatter(memory).body.trim()] : []),
  ].join('\n')
  return NextResponse.json({
    runtime: got.runtime,
    prompt,
    maxTurns: got.brief.maxTurns,
    // Relative: the desktop resolves it against the origin the page came
    // from, which is the only origin its bridge accepts.
    mcp: { name: MCP_TOOL_NAME, path: '/api/mcp' },
  })
}

const eventSchema = z.union([
  z.object({ at: z.number(), type: z.literal('assistant'), text: z.string().max(20_000) }),
  z.object({ at: z.number(), type: z.literal('tool'), tool: z.string().max(200), detail: z.string().max(20_000) }),
  z.object({ at: z.number(), type: z.literal('tool_result'), tool: z.string().max(200), text: z.string().max(20_000) }),
  z.object({ at: z.number(), type: z.literal('system'), text: z.string().max(4_000) }),
])

const bodySchema = z.object({
  runtime: z.string(),
  ok: z.boolean(),
  events: z.array(eventSchema).max(2_000),
  turns: z.number().int().min(0).max(1_000),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  summary: z.string().max(20_000).nullable(),
  errorMessage: z.string().max(4_000).nullable(),
  cancelled: z.boolean().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const got = await localBrief(spaceId, name, await requireAgentsAccess(spaceId))
  if (got instanceof Response) return got
  const body = await parseBody(req, bodySchema)
  if (body instanceof NextResponse) return body
  if (!isLocalRuntimeId(body.runtime) || body.runtime !== got.runtime) return bad('The run’s runtime does not match the brief.')

  let state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { id: true } })
  if (!state) {
    await syncAgentState(spaceId, name)
    state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { id: true } })
  }
  if (!state) return bad('No such agent.', 404)

  const userId = got.ctx.principal.userId
  const run = await createRun({ stateId: state.id, spaceId, name, trigger: 'manual', startedBy: userId, runAsUserId: userId, model: localModelRef(body.runtime) })
  const events: AgentRunEvent[] = body.events as AgentRunEvent[]
  const terminalReason: TerminalReason = body.cancelled ? 'timeout' : body.ok ? 'finished' : 'error'
  await finishRun(run.id, {
    status: body.ok ? 'succeeded' : 'failed',
    terminalReason,
    events,
    turns: body.turns,
    promptTokens: body.promptTokens,
    completionTokens: body.completionTokens,
    // The member's plan was charged, not the space's key: tokens, no dollars.
    costMicros: null,
    summary: body.summary,
    errorMessage: body.errorMessage,
    model: localModelRef(body.runtime),
  })
  return NextResponse.json({ ok: true, runId: run.id })
}
