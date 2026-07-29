/**
 * Persisted context layout API.
 *
 * GET  → the saved { hash, transform, positions } for a community, or null.
 * PUT  → upsert the layout (community members + super-admins only).
 *
 * The layout is a shared, per-community canonical force-directed result. The
 * context view restores it on open instead of re-running the simulation; it only
 * reuses the saved positions while `hash` still matches the current structure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession, handleApiError, forbiddenResponse, parseBody } from '@/lib/api/route';

type RouteContext = {
  params: Promise<{ communityId: string }>;
};

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId } = await context.params;

  try {
    const layout = await prisma.contextLayout.findUnique({
      where: { communityId },
      select: { hash: true, transform: true, positions: true },
    });

    return NextResponse.json(layout ?? null, {
      headers: { 'Cache-Control': 'private, max-age=5' },
    });
  } catch (error) {
    return handleApiError(error, 'api.community.context.layout.get.failed');
  }
}

type Positions = Record<string, { x: number; y: number }>;

// Upper bound on persisted nodes — the row is read back into every member's
// camera, so we reject pathologically large payloads rather than store an
// unbounded blob.
const MAX_LAYOUT_NODES = 20_000;
const IDENTITY_TRANSFORM = { x: 0, y: 0, k: 1 };

const finite = z.number().finite();
const pointSchema = z.object({ x: finite, y: finite });

const layoutSchema = z.object({
  hash: z.string(),
  // An unusable camera is not worth a 400 — fall back to the identity view and
  // keep the positions, which are the expensive part of the payload.
  transform: z.object({ x: finite, y: finite, k: finite.positive() }).catch(IDENTITY_TRANSFORM),
  positions: z
    .record(z.string(), z.unknown())
    .refine((raw) => Object.keys(raw).length <= MAX_LAYOUT_NODES, {
      message: `at most ${MAX_LAYOUT_NODES} node positions`,
    })
    // Individual malformed entries are dropped rather than failing the write:
    // a stale node id in one member's browser shouldn't lose everyone's layout.
    .transform((raw) => {
      const out: Positions = {};
      for (const [id, val] of Object.entries(raw)) {
        const point = pointSchema.safeParse(val);
        if (point.success) out[id] = point.data;
      }
      return out;
    }),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId } = await context.params;

  // The layout row is shared per-community: members collaboratively shape it and
  // every member restores it. Writing therefore requires membership (super-admins
  // bypass). Tighten this to isAdmin(...) if the layout should be admin-curated.
  if (!isSuperAdmin(session.email)) {
    const membership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId: session.userId, communityId } },
      select: { id: true },
    });
    if (!membership) return forbiddenResponse();
  }

  const body = await parseBody(request, layoutSchema);
  if (body instanceof NextResponse) return body;
  const { hash, transform, positions } = body;

  try {
    await prisma.contextLayout.upsert({
      where: { communityId },
      create: { communityId, hash, transform, positions },
      update: { hash, transform, positions },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, 'api.community.context.layout.put.failed');
  }
}
