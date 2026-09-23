/**
 * Move every space's built-in types onto the design tokens' type palette.
 *
 * A space stores its own type list, so the palette change reaches an existing
 * space only through this. A colour still equal to a previous default moves to
 * the token; a colour an admin picked stays (lib/types/recolor.ts). Re-running
 * is a no-op.
 *
 * Usage:
 *   pnpm --filter @visvine/web db:types:recolor           # report what would change
 *   pnpm --filter @visvine/web db:types:recolor --write   # change it
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { recolorBuiltInTypes } from '../lib/types/recolor';
import type { NodeTypeConfig } from '../lib/types/context';

async function main() {
  const write = process.argv.includes('--write');
  const spaces = await prisma.space.findMany({ select: { id: true, nodeTypes: true } });
  let touched = 0;
  for (const space of spaces) {
    if (!Array.isArray(space.nodeTypes)) continue;
    const { types, changed } = recolorBuiltInTypes(space.nodeTypes as unknown as NodeTypeConfig[]);
    if (!changed.length) continue;
    touched += 1;
    console.log(`  ${space.id}: ${changed.join(', ')}`);
    if (write) await prisma.space.update({ where: { id: space.id }, data: { nodeTypes: types as object[] } });
  }
  console.log(`${touched} space(s) ${write ? 'recoloured' : 'would be recoloured (pass --write)'} of ${spaces.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
