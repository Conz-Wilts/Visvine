/**
 * A directory entity is a folder (lib/notes/entities.ts#FOLDER_ONLY_ENTITY_KINDS):
 * `people/<slug>/index.md` is the person's note, and `people/<slug>.md` is only
 * the alias a stale link reaches it through. This moves every entity note still
 * at the flat path into its folder — shared context and every personal context
 * that holds a copy — through the same `ensureEntityFolder` a live write uses,
 * so grants, folder flags, links, publications, history and the derived rows
 * all follow exactly as they would in the app.
 *
 * Idempotent: an entity whose index is live is only checked. A node with both
 * forms live is reported and left alone — one entity, one note, and which body
 * wins is a person's call. A node with no note at all gets nothing; the profile
 * stubs it on first open.
 *
 *   pnpm --filter @visvine/web db:entities:folders            # every space
 *   pnpm --filter @visvine/web db:entities:folders <spaceId>  # one space
 *   pnpm --filter @visvine/web db:entities:folders --dry-run
 *
 * Runs in db:blackbird:full after the extras layer; against production it is
 * run once, straight after the deploy that made entities folders, through the
 * proxy with the guard's override (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import {
  entityFlatPath,
  entityIndexPathOf,
  entityKindOf,
  isFolderOnlyEntityKind,
} from '../lib/notes/entities'
import { ensureEntityFolder } from '../lib/notes/store'

const SYSTEM_ACTOR = { id: 'system', name: 'Visvine', email: null }

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--'))

  const nodes = await prisma.node.findMany({
    where: { spaceId: only ? only : { not: null } },
    select: { id: true, type: true, name: true, subtitle: true, metadata: true, spaceId: true },
    orderBy: [{ spaceId: 'asc' }, { id: 'asc' }],
  })

  let moved = 0
  let ambiguous = 0
  let checked = 0
  for (const row of nodes) {
    if (!isFolderOnlyEntityKind(entityKindOf(row.type))) continue
    const node = { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null }
    const flat = entityFlatPath(node)
    const index = entityIndexPathOf(node)
    if (!flat || !index) continue
    checked++
    const spaceId = row.spaceId!

    // Every context holding this entity's note at either path — the shared one
    // and any personal context that wrote its own copy.
    const rows = await prisma.contextNote.findMany({
      where: { spaceId, path: { in: [flat, index] }, deletedAt: null },
      select: { ownerKey: true, path: true },
    })
    const byOwner = new Map<string, Set<string>>()
    for (const r of rows) {
      const set = byOwner.get(r.ownerKey) ?? new Set<string>()
      set.add(r.path)
      byOwner.set(r.ownerKey, set)
    }

    for (const [ownerKey, paths] of byOwner) {
      if (!paths.has(flat)) continue
      const label = `${spaceId} ${ownerKey === 'shared' ? '' : `(${ownerKey}) `}${row.id}`
      if (paths.has(index)) {
        ambiguous++
        console.warn(`  ! ${label}: both ${flat} and ${index} are live — merge by hand`)
        continue
      }
      if (dryRun) {
        console.log(`  → ${label}: ${flat} → ${index}`)
        moved++
        continue
      }
      await ensureEntityFolder({ spaceId, ownerKey }, node, SYSTEM_ACTOR)
      moved++
    }
  }

  console.log(
    `entity folders: ${checked} entit${checked === 1 ? 'y' : 'ies'} checked — ${moved} note(s) ${dryRun ? 'would move' : 'moved'}, ${ambiguous} ambiguous.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
