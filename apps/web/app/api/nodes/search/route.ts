import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

/**
 * Maps a CreateModal node type to the set of (lowercased) DB `type` values that
 * should match. New nodes are stored lowercase-canonical, but legacy data may be
 * capitalized or pluralized — we always compare LOWER(n.type) and accept the
 * common spellings.
 */
const TYPE_ALIASES: Record<string, string[]> = {
  person: ['person', 'people'],
  resource: ['resource', 'resources'],
  event: ['event', 'events'],
};

function dbTypesFor(type: string): string[] {
  const key = type.toLowerCase();
  return TYPE_ALIASES[key] ?? [key];
}

interface SearchRow {
  id: string;
  name: string;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  image_url: string | null;
  community_id: string | null;
  metadata: unknown;
  community_name: string | null;
}

/**
 * GET /api/nodes/search?q=<query>&field=name|email&type=person|resource|event
 * Fuzzy-search nodes of a given type across all communities.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const field = req.nextUrl.searchParams.get('field') || 'name';
    const type = req.nextUrl.searchParams.get('type') || 'person';

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const typeFilter = Prisma.join(dbTypesFor(type));
    const like = `%${q}%`;

    // Email lives in person metadata only; for any other type fall back to name.
    const matchExpr =
      field === 'email' && type.toLowerCase() === 'person'
        ? Prisma.sql`LOWER(n.metadata->>'email') LIKE LOWER(${like})`
        : Prisma.sql`n.name ILIKE ${like}`;

    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        n.id,
        n.name,
        n.subtitle,
        n.location,
        n.tags,
        n.image_url,
        n.community_id,
        n.metadata,
        c.name AS community_name
      FROM nodes n
      LEFT JOIN communities c ON c.id = n.community_id
      WHERE LOWER(n.type) IN (${typeFilter})
        AND ${matchExpr}
      ORDER BY n.name ASC
      LIMIT 10
    `;

    return NextResponse.json({
      results: rows.map(r => ({
        id: r.id,
        name: r.name,
        subtitle: r.subtitle,
        location: r.location,
        tags: r.tags,
        image_url: r.image_url,
        community_id: r.community_id,
        community_name: r.community_name,
        metadata: r.metadata as Record<string, unknown> | null,
      })),
    });
  } catch (err) {
    logger.error('api.nodes.search.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
