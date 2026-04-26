import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

/**
 * GET /api/nodes/search?q=<query>&field=name|email
 * Fuzzy search People nodes across all communities.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const field = req.nextUrl.searchParams.get('field') || 'name';

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    if (field === 'email') {
      const rows = await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        subtitle: string | null;
        location: string | null;
        tags: string[];
        image_url: string | null;
        community_id: string | null;
        metadata: unknown;
        community_name: string | null;
      }>>`
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
        WHERE LOWER(n.type) IN ('people', 'person')
          AND LOWER(n.metadata->>'email') LIKE LOWER(${`%${q}%`})
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
    }

    // Default: search by name (case-insensitive contains)
    const rows = await prisma.node.findMany({
      where: {
        type: { in: ['People', 'Person'] },
        name: { contains: q, mode: 'insensitive' },
      },
      include: {
        community: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });

    return NextResponse.json({
      results: rows.map(r => ({
        id: r.id,
        name: r.name,
        subtitle: r.subtitle,
        location: r.location,
        tags: r.tags,
        image_url: r.imageUrl,
        community_id: r.communityId,
        community_name: r.community?.name ?? null,
        metadata: r.metadata as Record<string, unknown> | null,
      })),
    });
  } catch (err) {
    logger.error('api.nodes.search.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
