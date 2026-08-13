/**
 * Backfill: make sure every type a space's notes claim in their frontmatter
 * actually exists in that space's console (Space.nodeTypes).
 *
 * A note can write any `type:` it likes. A type the console never created is a
 * type nothing can filter, colour or alias — it renders as a grey placeholder
 * chip and stays invisible to the directory. This script closes that gap for
 * contexts seeded before the type existed: it reads every live note's frontmatter
 * type, and adds the missing ones to the space's node types with a colour
 * from the palette below (or a stable fallback).
 *
 * Only ADDS. Types the console already defines — including their colours, icons
 * and shapes — are never touched, so a curated console survives a re-run.
 * Synonyms count as defined (a note typed `Company` is served by `Space`).
 *
 * Idempotent: a second run reports nothing to add.
 * Local-only — guarded exactly like the destructive db:* scripts.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-note-node-types.ts                 # every space
 *   pnpm --filter @visvine/web exec tsx scripts/backfill-note-node-types.ts <spaceId>   # one space
 *   DRY_RUN=1 … to print the plan without writing.
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { mergeNodeType, type NodeTypeConfig } from '../lib/types';
import { parseFrontmatter } from '../lib/notes/shared/markdown';

/** Presentation for the note vocabulary, matching prisma/seed.ts NODE_TYPES.
 *  `note`, `file` and `index` are deliberately absent: they are reserved names
 *  (lib/types/nodeTypeRegistry.ts) that no space may create a type for. */
const KNOWN: Record<string, { icon: string; color: string; shape: NodeTypeConfig['shape'] }> = {
  sector: { icon: '🧭', color: '#f97316', shape: 'rectangle' },
  journal: { icon: '📓', color: '#ec4899', shape: 'rectangle' },
  meeting: { icon: '🤝', color: '#14b8a6', shape: 'rectangle' },
  connector: { icon: '🔌', color: '#6366f1', shape: 'rectangle' },
};

/** Deterministic colour for a type nobody has styled yet. */
const FALLBACK_COLORS = ['#0ea5e9', '#22c55e', '#eab308', '#a855f7', '#f43f5e', '#06b6d4'];
function fallbackColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

async function main() {
  const only = process.argv[2];
  const dryRun = process.env.DRY_RUN === '1';

  const spaces = await prisma.space.findMany({
    where: only ? { id: only } : {},
    select: { id: true, name: true, nodeTypes: true },
  });

  for (const space of spaces) {
    const notes = await prisma.contextNote.findMany({
      where: { spaceId: space.id, deletedAt: null },
      select: { content: true },
    });
    if (notes.length === 0) continue;

    let working = (space.nodeTypes as NodeTypeConfig[] | null) ?? [];
    const additions: NodeTypeConfig[] = [];
    const seen = new Set<string>();

    for (const note of notes) {
      const raw = String(parseFrontmatter(note.content).type ?? '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const style = KNOWN[key];
      // One shared rule for "is this name already served, and may it exist at
      // all" — synonyms, reserved names and the built-ins all fall out here.
      const merged = mergeNodeType(working, { name: raw, color: style?.color ?? fallbackColor(key) });
      if (!merged.ok || !merged.created) continue;
      const type: NodeTypeConfig = {
        ...merged.type,
        ...(style?.shape ? { shape: style.shape } : {}),
        ...(style?.icon ? { icon: style.icon } : {}),
      };
      // mergeNodeType seeds the defaults into an empty column; only the entries
      // this script decided on are reported and written.
      working = [...merged.types.slice(0, -1), type];
      additions.push(type);
    }

    if (additions.length === 0) {
      console.log(`· ${space.name} (${space.id}) — nothing to add`);
      continue;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}✎ ${space.name} (${space.id}) — adding ${additions
        .map((t) => t.name)
        .join(', ')}`,
    );
    if (!dryRun) {
      await prisma.space.update({
        where: { id: space.id },
        // Prisma types JSON columns structurally; the array is plain JSON data.
        data: { nodeTypes: working as unknown as object[] },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
