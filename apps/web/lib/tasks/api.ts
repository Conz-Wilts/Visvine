// Shared helpers for the Tasks REST routes, mirroring lib/notes/api.ts's
// "value-or-Response" pattern: requireMember/requireAdmin return the session
// payload or a ready-to-return error Response. (Notes' fail/failFromError are
// co-located with brain resolution, so tasks carries its own copies.)

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getAdminSession, getMemberSession, type SessionPayload } from '@/lib/auth';

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

// Map a thrown error to a JSON 400: store helpers throw Error on bad input
// ("Column not found", "Assignee is not an active member"), and zod parse
// failures surface their first issue's message.
export function failFromError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return fail(issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return fail(err instanceof Error ? err.message : 'Request failed');
}

/** Session if the caller is an active member of the community, else 403. */
export async function requireMember(communityId: string): Promise<SessionPayload | Response> {
  const session = await getMemberSession(communityId);
  return session ?? fail('Forbidden', 403);
}

/** Session if the caller is an admin of the community, else 403. */
export async function requireAdmin(communityId: string): Promise<SessionPayload | Response> {
  const session = await getAdminSession(communityId);
  return session ?? fail('Forbidden', 403);
}
