/**
 * Profile API — full profile data for a person node.
 * GET   /api/profile/[personId] → profile for a directory node (or legacy Person id)
 * PATCH /api/profile/[personId] → update Person fields (the connected user only)
 *
 * The param is a directory node id. A node CONNECTED to a member (via
 * Node.identityId → Identity.userId, see lib/identity/connection.ts) serves that
 * member's Person row; a disconnected node serves a profile synthesized from the
 * node so old links still render. `connected` + `userId` in the response are
 * what the client gates the Profile tab and ownership on.
 *
 * Profile edits update the Person row ONLY. Node.name (and friends) are
 * community-local display fields owned by the context surfaces — the old
 * Person→Node sync is gone on purpose: it clobbered local labels in every
 * community the member appears in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { communityMemberForbidden } from '@/lib/auth';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { resolveNodeConnection } from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ personId: string }> };

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
};

/**
 * The userId this profile id resolves to, connection first, then the legacy
 * scheme where the node id IS the Person id (pre-backfill rows).
 */
async function resolveProfileUserId(personId: string): Promise<string | null> {
  const connection = await resolveNodeConnection(personId);
  if (connection) return connection.userId;
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { userId: true },
  });
  return person?.userId ?? null;
}

/** Whether `viewerId` shares at least one real (non-personal) community with the
 *  member `targetUserId` — the visibility test for another member's contact PII. */
async function sharesCommunity(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  const overlap = await prisma.userCommunity.findFirst({
    where: {
      userId: targetUserId,
      status: 'active',
      community: {
        personalOwnerId: null,
        userCommunities: { some: { userId: viewerId, status: 'active' } },
      },
    },
    select: { id: true },
  });
  return overlap !== null;
}

/** Contact fields are visible only to people who share a community with the
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
    const person = await prisma.person.findUnique({ where: { userId } });
    if (person) {
      person.imageUrl = normalizeImageUrl(person.imageUrl) ?? person.imageUrl;
      const shared = await sharesCommunity(session.userId, userId);
      // `id` stays the requested node id so client-side routing keys hold.
      return NextResponse.json(
        redactContact({ ...person, id: personId, connected: true }, shared),
        { headers: CACHE_HEADERS },
      );
    }
  }

  // Direct Person-id hit without a User link (imported/legacy rows).
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (person) {
    person.imageUrl = normalizeImageUrl(person.imageUrl) ?? person.imageUrl;
    const shared = person.userId ? await sharesCommunity(session.userId, person.userId) : false;
    return NextResponse.json(
      redactContact({ ...person, connected: !!person.userId }, shared),
      { headers: CACHE_HEADERS },
    );
  }

  // No Person row. Many person nodes are created context-first (seed scripts,
  // CRM imports, bulk adds). Rather than 404, synthesize a profile from the
  // context Node so old links still render. Only person: nodes are profiles.
  if (personId.startsWith('person:')) {
    const node = await prisma.node.findUnique({ where: { id: personId } });
    if (node) {
      const meta = (node.metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      // Unconnected node: its contact fields belong to the node's community, so
      // gate phone on membership of that community.
      const sharedNode = node.communityId
        ? !(await communityMemberForbidden(session.userId, node.communityId, session.email))
        : false;
      const synthesized = {
        id: node.id,
        communityId: node.communityId,
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

  const person = await prisma.person.findUnique({ where: { userId }, select: { id: true } });
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const {
    name, subtitle, bio, location, website, linkedinUrl, twitterUrl,
    phone, pronouns, tags, imageUrl, metadata,
  } = body;

  const updated = await prisma.person.update({
    where: { id: person.id },
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
      ...(imageUrl !== undefined && { imageUrl }),
      ...(metadata !== undefined && { metadata }),
    },
  });

  // Profile fields feed the profile page's own cache tag.
  revalidateTag('context-data-v2', { expire: 0 });

  updated.imageUrl = normalizeImageUrl(updated.imageUrl) ?? updated.imageUrl;
  return NextResponse.json({ ...updated, id: personId, connected: true });
}
