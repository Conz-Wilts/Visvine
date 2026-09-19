/**
 * Take the `type: Space` off every sub-space's root index.
 *
 *   pnpm --filter @visvine/web db:subspaces:root-type [--dry]
 *
 * A sub-space's root is its context, never a Space record inside itself. The
 * write path now drops the type (store.ts#dropSubspaceRootType); this re-saves
 * each root that still carries one, which also drops the node it adopted.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { readNoteOrNull, writeNote, SHARED_OWNER_KEY } from '../lib/notes/store'
import { entityKindOf } from '../lib/notes/entities'
import { parseFrontmatter } from '../lib/notes/shared/markdown'

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry')
  const rooms = await prisma.space.findMany({ where: { parentId: { not: null } }, select: { id: true } })
  let fixed = 0
  for (const { id } of rooms) {
    const context = { spaceId: id, ownerKey: SHARED_OWNER_KEY }
    const note = await readNoteOrNull(context, 'index.md')
    const type = note ? (parseFrontmatter(note) as Record<string, unknown>).type : null
    if (!note || typeof type !== 'string' || entityKindOf(type) !== 'space') continue
    console.log(`  ${dry ? 'would fix' : 'fixed'} ${id} (type: ${type})`)
    if (!dry) await writeNote(context, 'index.md', note, { id: 'system', name: 'Visvine' }, 'maintenance')
    fixed++
  }
  console.log(`${fixed} sub-space root(s) ${dry ? 'to fix' : 'fixed'}, of ${rooms.length}.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
