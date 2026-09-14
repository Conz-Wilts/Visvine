import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api/route';
import { requireSession } from '@/lib/session';
import { resolveContext, principalOf } from '@/lib/notes/resolve';
import { fail, failFromError } from '@/lib/notes/api';
import {
  listConnectorRequests,
  requestConnector,
  resolveConnectorRequest,
} from '@/lib/connectors/requests';

/**
 * Requests that this space CONNECT a service it does not have yet
 * (lib/connectors/requests.ts).
 *   GET                                    → { requests, pending }  own; admins see all
 *   POST  { recipe, message? }             → { request }            file one (idempotent)
 *   PATCH { requestId, outcome, connectorName? } → { request }      admin: added | dismissed
 *
 * A personal space has one member and they administer it, so there is nobody
 * to ask: both writes refuse there.
 */
async function principalFor(spaceId: string) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  return { resolved, principal: await principalOf(resolved) };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const ctx = await principalFor(spaceId);
  if (ctx instanceof Response) return ctx;
  if (ctx.resolved.isPersonalSpace) return NextResponse.json({ requests: [], pending: 0 });
  const requests = await listConnectorRequests(ctx.principal);
  return NextResponse.json({
    requests,
    // The console badge needs the count before the section is opened.
    pending: requests.filter((r) => r.status === 'pending' && r.userId !== ctx.principal.userId).length,
  });
}

const postSchema = z.object({
  recipe: z.string().min(1).max(64),
  message: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const body = await parseBody(req, postSchema);
  if (body instanceof NextResponse) return body;
  const ctx = await principalFor(spaceId);
  if (ctx instanceof Response) return ctx;
  if (ctx.resolved.isPersonalSpace) return fail('A personal space has nobody to ask');
  try {
    return NextResponse.json({ request: await requestConnector(ctx.principal, body.recipe, body.message) });
  } catch (err) {
    return failFromError(err);
  }
}

const patchSchema = z.object({
  requestId: z.string().min(1),
  outcome: z.enum(['added', 'dismissed']),
  connectorName: z.string().min(1).max(128).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;
  const ctx = await principalFor(spaceId);
  if (ctx instanceof Response) return ctx;
  if (!ctx.resolved.isAdmin) return fail('Only a space admin can resolve this request', 403);
  try {
    const request = await resolveConnectorRequest(ctx.principal, body.requestId, body.outcome, body.connectorName);
    return NextResponse.json({ request });
  } catch (err) {
    return failFromError(err);
  }
}
