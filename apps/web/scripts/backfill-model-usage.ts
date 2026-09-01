/**
 * Rebuild agent_model_usage from the agent_runs still retained (90 days /
 * 100 per agent). Run once after deploying the rollup so the current months
 * aren't empty; safe to re-run — each month that has runs is recomputed whole,
 * and months older than every retained run (already rolled up, runs pruned)
 * are left alone.
 *
 * Usage:
 *   pnpm --filter @visvine/web db:usage:backfill
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { monthBounds } from '../lib/agents/budget';

async function main() {
  const runs = await prisma.agentRun.findMany({
    where: { status: { not: 'running' } },
    select: {
      spaceId: true,
      name: true,
      model: true,
      startedAt: true,
      promptTokens: true,
      completionTokens: true,
      costMicros: true,
    },
  });
  if (runs.length === 0) {
    console.log('No finished runs retained — nothing to roll up.');
    return;
  }
  const byKey = new Map<
    string,
    {
      spaceId: string;
      month: Date;
      name: string;
      model: string;
      runs: number;
      promptTokens: bigint;
      completionTokens: bigint;
      costMicros: bigint;
      unpricedRuns: number;
    }
  >();
  const months = new Set<string>();
  for (const run of runs) {
    const month = monthBounds(run.startedAt).start;
    months.add(month.toISOString());
    const model = run.model ?? 'unknown';
    const key = `${run.spaceId}\n${month.toISOString()}\n${run.name}\n${model}`;
    const row = byKey.get(key) ?? {
      spaceId: run.spaceId,
      month,
      name: run.name,
      model,
      runs: 0,
      promptTokens: BigInt(0),
      completionTokens: BigInt(0),
      costMicros: BigInt(0),
      unpricedRuns: 0,
    };
    row.runs += 1;
    row.promptTokens += BigInt(run.promptTokens);
    row.completionTokens += BigInt(run.completionTokens);
    row.costMicros += run.costMicros ?? BigInt(0);
    if (run.costMicros === null) row.unpricedRuns += 1;
    byKey.set(key, row);
  }
  const monthDates = [...months].map((m) => new Date(m));
  await prisma.$transaction([
    prisma.agentModelUsage.deleteMany({ where: { month: { in: monthDates } } }),
    prisma.agentModelUsage.createMany({ data: [...byKey.values()] }),
  ]);
  console.log(`Rolled ${runs.length} run(s) into ${byKey.size} usage row(s) across ${monthDates.length} month(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
