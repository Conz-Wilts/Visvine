/**
 * Profile API — full profile data for a person node.
 * GET   /api/profile/[personId] → profile for a directory node (or a member's own id)
 * PATCH /api/profile/[personId] → update the member's profile (the member only)
 *
 * The param is a directory node id. A node CONNECTED to a member (via
 * Node.identityId → Identity.userId, see lib/identity/connection.ts) serves that
 * member's profile — the fields on their `users` row; a disconnected node
 * serves a profile synthesized from the node so old links still render.
 * `connected` + `userId` in the response are what the client gates the Profile
 * tab and ownership on.
 *
 * Profile edits update the user row ONLY. Node.name (and friends) are
 * space-local display fields owned by the context surfaces — nothing is
 * mirrored onto nodes, which would clobber local labels in every space the
 * member appears in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden } from '@/lib/auth';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { resolveProfileUserId } from '@/lib/identity/connection';
import { syncGlobalRecordForUser } from '@/lib/global/record';

type RouteContext = { params: Promise<{ personId: string }> };

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
};

/** The profile columns on the user row, as the API has always shaped them. */
const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  subtitle: true,
  bio: true,
  location: true,
  website: true,
  linkedinUrl: true,
  twitterUrl: true,
  phone: true,
  pronouns: true,
  image: true,
  tags: true,
  publicMeta: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

/** The response shape: `imageUrl` and `metadata` are the names the clients read. */
function toProfile(row: ProfileRow) {
  const { image, publicMeta, id, ...rest } = row;
  return {
    ...rest,
    userId: id,
    imageUrl: normalizeImageUrl(image) ?? image,
    metadata: publicMeta,
  };
}

/** Whether `viewerId` shares at least one real (non-personal) space with the
 *  member `targetUserId` — the visibility test for another member's contact PII. */
async function sharesSpace(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  const overlap = await prisma.spaceMember.findFirst({
    where: {
      userId: targetUserId,
      status: 'active',
      space: {
        personalOwnerId: null,
        members: { some: { userId: viewerId, status: 'active' } },
      },
    },
    select: { id: true },
  });
  return overlap !== null;
}

/** Contact fields are visible only to people who share a space with the
 *  subject. Everyone else gets the profile with email/phone nulled — the profile
 *  stays a global identity surface without leaking direct contact details across
 *  tenant boundaries. Mutates and returns the record for call-site brevity. */
function redactContact<T extends Record<string, unknown>>(record: T, shared: boolean): T {
  if (!shared) {
    if ('email' in record) (record as Record<string, unknown>).email = null;
    if ('phone' in record) (record as Record<string, unknown>).phone = null;
  }
  return record;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { personId } = await context.params;

  const userId = await resolveProfileUserId(personId);
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
    if (user) {
      const shared = await sharesSpace(session.userId, userId);
      // `id` stays the requested id so client-side routing keys hold.
      return NextResponse.json(
        redactContact({ ...toProfile(user), id: personId, connected: true }, shared),
        { headers: CACHE_HEADERS },
      );
    }
  }

  // No member. Many person nodes are created context-first (seed scripts,
  // CRM imports, bulk adds). Rather than 404, synthesize a profile from the
  // context Node so old links still render. Only person: nodes are profiles.
  if (personId.startsWith('person:')) {
    const node = await prisma.node.findUnique({ where: { id: personId } });
    if (node) {
      const meta = (node.metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      // Unconnected node: its contact fields belong to the node's space, so
      // gate phone on membership of that space.
      const sharedNode = node.spaceId
        ? !(await spaceMemberForbidden(session.userId, node.spaceId, session.email))
        : false;
      const synthesized = {
        id: node.id,
        spaceId: node.spaceId,
        name: node.name,
        subtitle: node.subtitle ?? null,
        bio: str(meta.bio),
        location: node.location ?? null,
        website: str(meta.website) ?? node.url ?? null,
        linkedinUrl: str(meta.linkedinUrl),
        twitterUrl: str(meta.twitterUrl),
        phone: sharedNode ? str(meta.phone) : null,
        pronouns: str(meta.pronouns),
        email: null,
        imageUrl: normalizeImageUrl(node.imageUrl) ?? node.imageUrl ?? null,
        tags: node.tags ?? [],
        metadata: meta,
        userId: null,
        connected: false,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
      return NextResponse.json(synthesized, { headers: CACHE_HEADERS });
    }
  }

  return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { personId } = await context.params;
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  // Only the member this profile resolves to may edit it.
  const userId = await resolveProfileUserId(personId);
  if (!userId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (userId !== session.userId) return forbiddenResponse();

  const body = await req.json();
  const {
    name, subtitle, bio, location, website, linkedinUrl, twitterUrl,
    phone, pronouns, tags, imageUrl, metadata,
  } = body;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(subtitle !== undefined && { subtitle }),
      ...(bio !== undefined && { bio }),
      ...(location !== undefined && { location }),
      ...(website !== undefined && { website }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
      ...(twitterUrl !== undefined && { twitterUrl }),
      ...(phone !== undefined && { phone }),
      ...(pronouns !== undefined && { pronouns }),
      ...(tags !== undefined && { tags }),
      ...(imageUrl !== undefined && { image: imageUrl }),
      ...(metadata !== undefined && { publicMeta: metadata }),
    },
    select: PROFILE_SELECT,
  });

  // The profile is the first source of the member's global record.
  await syncGlobalRecordForUser(userId);
  // Profile fields feed the profile page's own cache tag.
  revalidateTag('context-data-v2', { expire: 0 });

  return NextResponse.json({ ...toProfile(updated), id: personId, connected: true });
}
