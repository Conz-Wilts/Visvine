import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { getSession, type SessionPayload } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';

// Shared plumbing for app/api route handlers: session-or-401, zod-body-or-400,
// and a single error → response mapping. Any thrown Error carrying a numeric
// `status` (ApiError, MessagingError, …) is surfaced with that status; anything
// else is logged and returned as an opaque 500.

/**
 * Throwable typed error for route/service code: `throw new ApiError(404, 'Not found')`.
 * @public part of the helper API — adopt in routes as they migrate
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Session or 401. Usage:
 * `const session = await requireApiSession(); if (session instanceof NextResponse) return session;`
 */
export async function requireApiSession(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  return session;
}

/**
 * Session + community-admin gate, or 401/403. "Admin" has one definition in
 * this app: holding a Person alias flagged `owner` (lib/auth.ts#isAdmin, super
 * admins bypass). Membership carries no role, so there is nothing finer than
 * this to check. Usage:
 * `const session = await requireCommunityAdmin(communityId); if (session instanceof NextResponse) return session;`
 */
export async function requireCommunityAdmin(
  communityId: string,
): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!(await isAdmin(session.userId, communityId, session.email))) {
    return forbiddenResponse('permission_denied');
  }
  return session;
}

/**
 * Parse + validate a JSON body. Returns the typed value, or a 400 NextResponse
 * (invalid JSON or schema mismatch — first zod issue becomes the error message).
 * Usage: `const body = await parseBody(request, schema); if (body instanceof NextResponse) return body;`
 */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return NextResponse.json({ error: `${path}${issue?.message ?? 'Invalid request body'}` }, { status: 400 });
  }
  return parsed.data;
}

/**
 * Map a caught error to a JSON response. Errors with a numeric `status`
 * (ApiError, MessagingError) keep their status + message; everything else logs
 * under `scope` and returns a generic 500.
 */
export function handleApiError(error: unknown, scope = 'api.failed') {
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown }).status;
    if (typeof status === 'number') {
      return NextResponse.json({ error: error.message }, { status });
    }
  }
  logger.error(scope, { err: error });
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
