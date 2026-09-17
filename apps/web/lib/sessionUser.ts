import prisma from '@/lib/prisma';
import { requestMemo } from '@/lib/requestMemo';
import { isSuperAdmin, type SessionPayload } from '@/lib/session';
import { normalizeImageUrl } from '@/lib/mediaUrl';

/** The shell's view of the signed-in person — the shape /api/auth/session returns. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  nodeId: string | null;
  isSuperAdmin: boolean;
}

const liveUser = requestMemo('sessionUser', (userId: string) =>
  prisma.user.findUnique({ where: { id: userId }, select: { name: true, image: true, nodeId: true } }),
);

/**
 * The session as a page or the session route reports it.
 *
 * A session is a 30-day JWT minted at sign-in, so the name and picture it
 * carries are a snapshot of that moment: changing your profile picture would
 * otherwise leave the account band wearing the old one until the token
 * expired. Identity stays the token's — (userId, email) are what was verified
 * — and everything the person can edit about themselves is read from their
 * row, once per request.
 */
export async function resolveSessionUser(session: SessionPayload): Promise<SessionUser> {
  const row = await liveUser(session.userId).catch(() => null);
  const image = row?.image ?? session.image ?? null;
  return {
    id: session.userId,
    name: row?.name ?? session.name,
    email: session.email,
    image: normalizeImageUrl(image) ?? image,
    nodeId: row?.nodeId ?? session.nodeId ?? null,
    isSuperAdmin: isSuperAdmin(session.email),
  };
}
