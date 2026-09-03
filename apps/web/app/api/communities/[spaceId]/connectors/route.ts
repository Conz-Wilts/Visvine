import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { resolveContext, principalOf } from '@/lib/notes/resolve';
import { listConnectors, listHiddenConnectors } from '@/lib/connectors/service';
import { listConnectorRequests } from '@/lib/connectors/requests';
import { pendingRequestPaths } from '@/lib/notes/accessRequests';
import { availablePlatformClients } from '@/lib/connectors/platformClients';

/**
 * The space's connectors — the parsed state of every connectors/*.md note
 * (alias, allowlist, referenced secret names, parse errors) for the console
 * panel and the account menu's dialog. Secrets themselves live in ../secrets.
 *
 * Any member of the space may read it: the list is what the notes they can
 * already open say about themselves (visibility is the principal's, in
 * listConnectors), and a member needs it to see which connector they still
 * have to sign in to. `canManage` says whether the caller is an admin — the
 * writes behind Manage (PATCH, the note delete, the secrets) each gate
 * themselves, so this is only what the UI shows, never what it allows.
 *
 * `hidden` is the rest of what the space has: connector notes no grant lets
 * this member open, named so they can ask for access rather than discover
 * the gap from a refused run. `accessRequested` and `requested` are what
 * they have already asked for — note paths with an open access request, and
 * catalog recipes with an open request to connect — so a row says "Requested"
 * instead of offering the button again.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;

  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;

  const principal = await principalOf(resolved);
  const [connectors, hidden, accessRequested, requests] = await Promise.all([
    listConnectors(principal, resolved),
    resolved.isPersonalSpace ? [] : listHiddenConnectors(principal, resolved),
    resolved.isPersonalSpace ? new Set<string>() : pendingRequestPaths(principal),
    resolved.isPersonalSpace ? [] : listConnectorRequests(principal),
  ]);

  // Which referenced secrets actually exist — the list can't tell a working
  // connector from a broken one without it, and one query covers every row.
  const stored = new Set(
    (
      await prisma.connectorSecret.findMany({
        where: { spaceId },
        select: { name: true },
      })
    ).map((row) => row.name)
  );

  // Whether the account behind an OAuth connector is actually linked. A
  // connector written by a recipe names its provider after the note
  // (AGENTS.md#connectors), so one query keyed by provider answers it for every
  // row — and a note whose dance was abandoned reads as what it is rather than
  // as connected. The caller's own connection wins over the space's, which is
  // the order a run resolves them in.
  const linked = new Map<string, { actsAs: string | null; broken: boolean }>();
  const connections = await prisma.connectorConnection.findMany({
    where: { spaceId, userId: { in: ['', session.userId] } },
    select: { provider: true, userId: true, accountLabel: true, brokenAt: true },
  });
  for (const row of connections) {
    if (row.userId !== session.userId && linked.has(row.provider)) continue;
    linked.set(row.provider, { actsAs: row.accountLabel, broken: row.brokenAt !== null });
  }

  return NextResponse.json({
    canManage: resolved.isAdmin,
    // Which OAuth services this deployment can complete on its own — names
    // only, never credentials. It is what lets the catalog offer one-click
    // Connect for Google here and the paste-your-own-app form on a deployment
    // that has no client of its own (lib/connectors/catalog.ts#connectsInOneClick).
    platformClients: availablePlatformClients(),
    hidden: hidden.map((h) => ({ ...h, accessRequested: accessRequested.has(h.path) })),
    requested: [...new Set(requests.filter((r) => r.status === 'pending' && r.userId === session.userId).map((r) => r.recipe))],
    connectors: connectors.map(({ docs: _docs, secrets, ...rest }) => ({
      ...rest,
      secrets,
      missingSecrets: secrets.filter((name) => !stored.has(name)),
      // Null for a connector that holds no linked account — either it uses no
      // OAuth at all, or nobody has finished the dance.
      connection: linked.get(rest.name) ?? null,
    })),
  });
}
