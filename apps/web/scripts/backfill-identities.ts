/**
 * One-off backfill: assign a canonical Identity to every existing person/org node
 * that doesn't have one yet. Reuses the SAME runtime resolver (lib/identity/resolve)
 * so backfill behaviour can never drift from live creation:
 *
 *   - strong-id matches (email / LinkedIn / domain) cluster duplicates automatically,
 *   - exact name + company auto-attaches (Tier B),
 *   - name-only matches are kept SEPARATE and queued as 'suggested' for human review
 *     (never auto-merged — the safe path for legacy data that lacks emails).
 *
 * Idempotent: only touches nodes with identityId = null, so it's safe to re-run.
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-identities.ts            # run
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-identities.ts --dry-run  # report only
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { resolveIdentity } from '../lib/identity/resolve';
import type { IdentityKind } from '../lib/identity/match';
import { entityKindOf } from '../lib/notes/entities';
import { isOwnCommunityNode } from '../lib/types/context';

// Every organisation spelling — 'organization', 'group', 'community', today's
// 'space' — resolves to an org identity. The space's OWN node is excluded: it
// is the space itself, not an organisation recorded inside it, and giving it an
// identity would merge unrelated communities that happen to share a name.
function kindFor(node: { id: string; type: string; communityId: string | null }): IdentityKind | null {
  const t = node.type.toLowerCase();
  if (t === 'person' || t === 'people') return 'person';
  if (entityKindOf(t) === 'space') {
    return isOwnCommunityNode(node) ? null : 'organization';
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const nodes = await prisma.node.findMany({
    where: { identityId: null },
    select: { id: true, type: true, name: true, location: true, url: true, metadata: true, communityId: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = nodes
    .map((n) => ({ ...n, kind: kindFor(n) }))
    .filter((n): n is typeof n & { kind: IdentityKind } => n.kind !== null);

  console.log(`Found ${targets.length} person/org node(s) without an identity (of ${nodes.length} unresolved nodes).`);

  if (dryRun) {
    let withEmail = 0;
    let withLinkedin = 0;
    let withDomain = 0;
    for (const n of targets) {
      const meta = (n.metadata as Record<string, unknown>) ?? {};
      if (n.kind === 'person' && meta.email) withEmail++;
      if (meta.linkedinUrl) withLinkedin++;
      if (n.kind === 'organization' && (meta.website || meta.url || n.url)) withDomain++;
    }
    console.log('--- dry run (no writes) ---');
    console.log(`  with email:    ${withEmail}`);
    console.log(`  with linkedin: ${withLinkedin}`);
    console.log(`  with website:  ${withDomain}`);
    console.log(`  rest will match on name+company (auto) or be queued for review (name-only).`);
    await prisma.$disconnect();
    return;
  }

  const stats = { auto_strong: 0, auto_name_company: 0, suggested: 0, created: 0, failed: 0 };

  for (const node of targets) {
    const meta = (node.metadata as Record<string, unknown>) ?? {};
    try {
      const result = await resolveIdentity(node.id, {
        kind: node.kind,
        name: node.name,
        email: node.kind === 'person' ? ((meta.email as string) ?? null) : null,
        linkedinUrl: (meta.linkedinUrl as string) ?? null,
        website: node.kind === 'organization' ? (((meta.website as string) ?? (meta.url as string) ?? node.url) ?? null) : null,
        company: node.kind === 'person' ? ((meta.companyName as string) ?? null) : null,
        location: node.location ?? null,
      });
      await prisma.node.update({ where: { id: node.id }, data: { identityId: result.identityId } });
      stats[result.decision]++;
    } catch (err) {
      stats.failed++;
      console.error(`  ✗ ${node.id}:`, err);
    }
  }

  const identityCount = await prisma.identity.count();
  console.log('--- backfill complete ---');
  console.log(`  auto-linked (strong id):   ${stats.auto_strong}`);
  console.log(`  auto-linked (name+company):${stats.auto_name_company}`);
  console.log(`  new identity + suggestion: ${stats.suggested}`);
  console.log(`  new identity (no match):   ${stats.created}`);
  console.log(`  failed:                    ${stats.failed}`);
  console.log(`  total identities now:      ${identityCount}`);
  // The review UI is gone; the queue is served by GET /api/identities/review.
  console.log('Review name-only suggestions via GET /api/identities/review');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
