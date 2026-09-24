import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiSession, parseBody, handleApiError } from '@/lib/api/route';
import { drainJobs, pendingJobKinds } from '@/lib/resources/jobs';
import { requireVisibleResource } from '@/lib/resources/visibility';

export const maxDuration = 30;

const pullSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(20) });

/** A pull does at most this much work before answering. */
const PULL_BUDGET_MS = 6_000;

/**
 * POST /api/resources/jobs/pull { ids } — finish the work the named resources
 * still owe (a thumbnail, an unfurl), within a short budget, and say what is
 * still pending. A client drawing a skeleton calls it; whoever is looking is
 * who finishes the work (lib/resources/jobs.ts). Only resources the caller
 * can see are worked on.
 */
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const body = await parseBody(req, pullSchema);
  if (body instanceof NextResponse) return body;
  try {
    const visible: string[] = [];
    for (const id of new Set(body.ids)) {
      try {
        await requireVisibleResource(id, session.userId, session.email);
        visible.push(id);
      } catch {
        // Not theirs to see: skipped, and indistinguishable from done.
      }
    }
    await drainJobs({ budgetMs: PULL_BUDGET_MS, resourceIds: visible, batch: 2 });
    const pending = await pendingJobKinds(visible);
    return NextResponse.json({ pending: Object.fromEntries(pending) });
  } catch (err) {
    return handleApiError(err, 'resources.jobs.pull');
  }
}
