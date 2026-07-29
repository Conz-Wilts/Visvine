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
import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';

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

type Transform = { x: number; y: number; k: number };
type Positions = Record<string, { x: number; y: number }>;

// Upper bound on persisted nodes — the row is read back into every member's
// camera, so we reject pathologically large payloads rather than store an
// unbounded blob.
const MAX_LAYOUT_NODES = 20_000;
const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, k: 1 };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Coerce an untrusted transform to a valid {x,y,k}; fall back to identity. */
function sanitizeTransform(raw: unknown): Transform {
  if (raw && typeof raw === 'object') {
    const t = raw as Record<string, unknown>;
    if (isFiniteNumber(t.x) && isFiniteNumber(t.y) && isFiniteNumber(t.k) && t.k > 0) {
      return { x: t.x, y: t.y, k: t.k };
    }
  }
  return IDENTITY_TRANSFORM;
}

/**
 * Validate an untrusted positions map. Returns the cleaned map (dropping any
 * entry that isn't {x:number, y:number}), or null if it's not an object or
 * exceeds MAX_LAYOUT_NODES.
 */
function sanitizePositions(raw: unknown): Positions | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_LAYOUT_NODES) return null;
  const out: Positions = {};
  for (const [id, val] of entries) {
    if (val && typeof val === 'object') {
      const p = val as Record<string, unknown>;
      if (isFiniteNumber(p.x) && isFiniteNumber(p.y)) out[id] = { x: p.x, y: p.y };
    }
  }
  return out;
}

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hash = (body as { hash?: unknown } | null)?.hash;
  if (typeof hash !== 'string') {
    return NextResponse.json({ error: 'Invalid layout payload' }, { status: 400 });
  }
  const positions = sanitizePositions((body as { positions?: unknown }).positions);
  if (positions === null) {
    return NextResponse.json({ error: 'Invalid or oversized positions' }, { status: 400 });
  }
  const transform = sanitizeTransform((body as { transform?: unknown }).transform);

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
