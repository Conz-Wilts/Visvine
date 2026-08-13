/**
 * One-off backfill: give every registered member an explicit, identity-bridged
 * connection to their person node(s), unifying the two legacy schemes:
 *
 *   (a) node id === Person.id (personal spaces / auth bootstrap)
 *   (b) node carries metadata.userId (space-create person nodes)
 *
 * and then ensuring every ACTIVE membership has a connected person node in its
 * space's directory — matching what all the member-add paths now do live
 * (lib/spaces/memberNode.ts).
 *
 * Uses the same runtime service (lib/identity/connection) so backfill behaviour
 * can never drift from live creation. Idempotent: connects are keyed by
 * identity, ensureMemberNode early-returns on an existing connection.
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-member-connections.ts            # run
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-member-connections.ts --dry-run  # report only
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { connectNodeToUser, ensureUserIdentity, findMemberNode } from '../lib/identity/connection';
import { ensureMemberNode } from '../lib/spaces/memberNode';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const stats = {
    identities: 0,
    identityConflicts: 0,
    schemeA: 0,
    schemeB: 0,
    duplicates: 0,
    memberNodes: 0,
    failed: 0,
  };

  // 1. Every registered user gets (or claims) an Identity.
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Users: ${users.length}`);
  for (const user of users) {
    if (dryRun) continue;
    try {
      await ensureUserIdentity(user.id);
      stats.identities++;
    } catch (err) {
      stats.identityConflicts++;
      console.warn(`  identity conflict for ${user.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. Scheme (a): nodes whose id IS a Person id with a linked user.
  const persons = await prisma.person.findMany({
    where: { userId: { not: null } },
    select: { id: true, userId: true },
  });
  const schemeA: Array<{ nodeId: string; userId: string }> = [];
  for (const p of persons) {
    const node = await prisma.node.findUnique({ where: { id: p.id }, select: { id: true, identityId: true } });
    if (node && !node.identityId) schemeA.push({ nodeId: node.id, userId: p.userId! });
  }
  console.log(`Scheme (a) nodes to connect (id === Person.id): ${schemeA.length}`);

  // 3. Scheme (b): unconnected person nodes carrying metadata.userId.
  const schemeB = await prisma.node.findMany({
    where: {
      identityId: null,
      type: { in: ['person', 'people'] },
      // "has a string metadata.userId" — every string starts with ''.
      metadata: { path: ['userId'], string_starts_with: '' },
    },
    select: { id: true, metadata: true },
  });
  console.log(`Scheme (b) nodes to connect (metadata.userId): ${schemeB.length}`);

  for (const { nodeId, userId } of schemeA) {
    if (dryRun) continue;
    const result = await connectNodeToUser(nodeId, userId, { reason: 'backfill: node id is Person id' });
    if (result.ok) stats.schemeA++;
    else if (result.error === 'duplicate') { stats.duplicates++; console.warn(`  duplicate: ${nodeId} — ${result.message}`); }
    else { stats.failed++; console.warn(`  failed: ${nodeId} — ${result.message}`); }
  }

  for (const node of schemeB) {
    const meta = (node.metadata as Record<string, unknown>) ?? {};
    const userId = typeof meta.userId === 'string' ? meta.userId : null;
    if (!userId || dryRun) continue;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) { console.warn(`  skipped ${node.id}: metadata.userId ${userId} has no User row`); continue; }
    const result = await connectNodeToUser(node.id, userId, { reason: 'backfill: metadata.userId' });
    if (result.ok) stats.schemeB++;
    else if (result.error === 'duplicate') { stats.duplicates++; console.warn(`  duplicate: ${node.id} — ${result.message}`); }
    else { stats.failed++; console.warn(`  failed: ${node.id} — ${result.message}`); }
  }

  // 4. Every active membership ends with a connected node in its space.
  const memberships = await prisma.spaceMember.findMany({
    where: { status: 'active' },
    select: { userId: true, spaceId: true },
  });
  let missing = 0;
  for (const m of memberships) {
    const existing = await findMemberNode(m.spaceId, m.userId);
    if (existing) continue;
    missing++;
    if (dryRun) continue;
    const nodeId = await ensureMemberNode(m.spaceId, m.userId);
    if (nodeId) stats.memberNodes++;
    else { stats.failed++; console.warn(`  no node created for user ${m.userId} in ${m.spaceId}`); }
  }
  console.log(`Active memberships without a connected node: ${missing} (of ${memberships.length})`);

  if (dryRun) {
    console.log('--- dry run (no writes) ---');
  } else {
    console.log('--- done ---');
    console.log(stats);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
