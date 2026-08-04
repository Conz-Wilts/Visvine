import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { resolveBrain, principalOf } from '@/lib/notes/brain';
import { listConnectors } from '@/lib/connectors/service';

/**
 * Admin view of the community's connectors — the parsed state of every
 * connectors/*.md note (alias, allowlist, referenced secret names, parse
 * errors) for the console panel. Secrets themselves live in ../secrets.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;

  const resolved = await resolveBrain(session, communityId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const principal = await principalOf(resolved);
  const connectors = await listConnectors(principal, resolved);

  // Which referenced secrets actually exist — the list can't tell a working
  // connector from a broken one without it, and one query covers every row.
  const stored = new Set(
    (
      await prisma.communitySecret.findMany({
        where: { communityId },
        select: { name: true },
      })
    ).map((row) => row.name)
  );

  return NextResponse.json({
    connectors: connectors.map(({ docs: _docs, secrets, ...rest }) => ({
      ...rest,
      secrets,
      missingSecrets: secrets.filter((name) => !stored.has(name)),
    })),
  });
}
