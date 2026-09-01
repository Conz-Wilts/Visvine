import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { resolveAgentChatConfig } from '@/lib/agents/providers';
import { costMicros } from '@/lib/agents/budget';
import { meterModelUsage } from '@/lib/agents/runs';
import { findAgentBrief } from '@/lib/agents/briefs';
import { draftSkill, type Demonstration, type TraceStep } from '@/lib/agents/teach';
import { statusOnPublish } from '@/lib/agents/shared/skills';
import { parseFrontmatter } from '@/lib/notes/shared/markdown';
import { writeGated } from '@/lib/notes/contextService';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  agent: z.string().min(1),
  /** Which demonstration to learn from. Defaults to the most recent one. */
  eventId: z.string().min(1).optional(),
});

/**
 * Teach an agent what a person just showed it.
 *
 * The demonstration is already recorded: taking control and giving it back
 * leaves a `release` event carrying the trace (§7, mechanism 1). This turns that
 * trace into a skill — two notes under `agents/<name>/skills/<slug>/` — by
 * asking the agent's own model to describe what it saw. It writes a DRAFT: a
 * skill only becomes selectable when an admin approves it, because approving
 * one is agreeing to the reach it claims.
 *
 * The trace never contained what was typed, so neither does the skill. That is
 * the property that lets a person log in during a takeover at all.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'agent is required' }, { status: 400 });
  const { agent, eventId } = parsed.data;

  const event = await prisma.agentVmEvent.findFirst({
    where: { spaceId, agentName: agent, kind: 'release', ...(eventId ? { id: eventId } : {}) },
    orderBy: { at: 'desc' },
  });
  if (!event) {
    return NextResponse.json(
      { error: 'There is no demonstration to learn from yet — take control of the machine and do the task once.' },
      { status: 404 },
    );
  }

  const payload = (event.payload ?? {}) as {
    by?: string;
    heldMs?: number;
    steps?: TraceStep[];
    touched?: string[];
  };
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  if (steps.length === 0) {
    return NextResponse.json({ error: 'That demonstration recorded no steps.' }, { status: 400 });
  }

  // The agent's own model writes the skill, so teaching costs the space's key
  // like a run does — the platform never spends on this.
  const brief = await findAgentBrief(spaceId, agent);
  if (!brief) return NextResponse.json({ error: 'No such agent.' }, { status: 404 });
  const model = await resolveAgentChatConfig(spaceId, parseFrontmatter(brief.content).model);
  if (!model.ok) return NextResponse.json({ error: model.message }, { status: 422 });

  const demo: Demonstration = {
    agent,
    by: typeof payload.by === 'string' ? payload.by : 'a person',
    heldMs: typeof payload.heldMs === 'number' ? payload.heldMs : 0,
    steps,
    touched: Array.isArray(payload.touched) ? payload.touched : [],
    runId: event.runId,
  };

  const { draft, usage } = await draftSkill(model.config, demo, statusOnPublish(false));
  // The teaching spent the space's key, so it goes on the same ledger as a run
  // — under the agent's name, this month, whether or not the draft was usable.
  if (usage) {
    await meterModelUsage({
      spaceId,
      name: agent,
      model: `${model.ref.provider.id}/${model.ref.modelId}`,
      startedAt: new Date(),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costMicros: costMicros(usage, model.ref.pricing),
    }).catch((err) => logger.error('agents.teach.meter_failed', { err, spaceId, agent }));
  }
  if (!draft) {
    return NextResponse.json(
      { error: 'The agent could not describe that demonstration. Try a shorter, more deliberate one.' },
      { status: 422 },
    );
  }

  // Written through the ordinary gate, as the admin, so the same grants, frozen
  // folders and write denials apply as to anything else they write. `agents/` is
  // frozen for AI origins, which is exactly why this is an `edit` by a person
  // and not an agent write.
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  const principal = await principalOf(resolved);
  const context = { spaceId, ownerKey: 'shared' };
  for (const [path, content] of [
    [draft.indexPath, draft.index],
    [draft.stepsPath, draft.steps],
  ] as const) {
    const result = await writeGated(principal, context, path, content, 'edit');
    if (result.status !== 'applied') {
      logger.warn('agents.teach.write_refused', { spaceId, agent, path, reason: result.reason });
      return NextResponse.json({ error: result.reason }, { status: 403 });
    }
  }

  return NextResponse.json({
    slug: draft.slug,
    title: draft.title,
    status: 'pending',
    index: draft.indexPath,
    steps: draft.stepsPath,
    learnedFrom: { eventId: event.id, at: event.at, steps: steps.length },
  });
}
