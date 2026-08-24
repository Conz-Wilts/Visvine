/**
 * Every `space` node stands for a real space (docs/sub-spaces.md). This turns
 * the ones that don't — organisations recorded as cards before spaces could
 * nest — into spaces INSIDE the space that recorded them: no members, `inherit`
 * visibility, managed by that space's admins. The card gets `metadata.spaceRef`
 * and its note gets a `space:` key, so the record and the space are one thing.
 *
 * Idempotent: a node with a valid spaceRef is only checked, not re-provisioned;
 * a space's own root node (`community:<own id>`) refers to itself.
 *
 *   pnpm --filter @visvine/web db:spaces:records            # every space
 *   pnpm --filter @visvine/web db:spaces:records <spaceId>  # one space
 *
 * Runs in db:blackbird:full after the notes layer; against production it is
 * run once, through the proxy, with the guard's override (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { provisionSpace } from '../lib/spaces/provision'
import { entityNotePath, entityIndexPathOf, entityDraftContent, isChildSpaceNode } from '../lib/notes/entities'
import { isOwnSpaceNode } from '../lib/types/context'
import { createNote, readNoteOrNull, SHARED_OWNER_KEY } from '../lib/notes/store'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'

const SYSTEM_ACTOR = { id: 'system', name: 'Visvine', email: null }

async function main() {
  const only = process.argv[2]
  const nodes = await prisma.node.findMany({
    where: { type: 'space', ...(only ? { spaceId: only } : {}), spaceId: { not: null } },
    select: { id: true, name: true, subtitle: true, location: true, metadata: true, spaceId: true },
    orderBy: [{ spaceId: 'asc' }, { name: 'asc' }],
  })
  const spaceIds = new Set((await prisma.space.findMany({ select: { id: true } })).map((s) => s.id))

  let provisioned = 0
  let linked = 0
  let notes = 0
  for (const node of nodes) {
    const spaceId = node.spaceId!
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    let ref = typeof metadata.spaceRef === 'string' && spaceIds.has(metadata.spaceRef) ? metadata.spaceRef : null

    if (!ref && isOwnSpaceNode({ id: node.id, spaceId })) ref = spaceId

    if (!ref) {
      const result = await provisionSpace({
        name: node.name,
        description: node.subtitle ?? '',
        location: node.location ?? null,
        parentId: spaceId,
        creator: SYSTEM_ACTOR,
        joinCreator: false,
      })
      if (!result.ok) {
        console.warn(`  ✗ ${node.id}: ${result.error}`)
        continue
      }
      ref = result.space.id
      spaceIds.add(ref)
      provisioned++
    } else if (metadata.spaceRef !== ref) {
      linked++
    }

    if (metadata.spaceRef !== ref) {
      await prisma.node.update({ where: { id: node.id }, data: { metadata: { ...metadata, spaceRef: ref } } })
    }

    // The record's note names the space: `space: <id>` in its frontmatter.
    const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
    const flat = entityNotePath({ id: node.id, type: 'space' })
    const index = entityIndexPathOf({ id: node.id, type: 'space' })
    let existing: { path: string; content: string } | null = null
    for (const path of [flat, index]) {
      if (!path) continue
      const content = await readNoteOrNull(context, path)
      if (content !== null) {
        existing = { path, content }
        break
      }
    }
    if (existing) {
      const fm = parseFrontmatter(existing.content)
      if (fm.space !== ref) {
        const { body } = splitFrontmatter(existing.content)
        await prisma.contextNote.updateMany({
          where: { spaceId, ownerKey: SHARED_OWNER_KEY, path: existing.path, deletedAt: null },
          data: { content: joinFrontmatter({ ...fm, space: ref }, body) },
        })
        notes++
      }
    } else if (flat) {
      await createNote(
        context,
        flat,
        entityDraftContent({ id: node.id, type: 'space', name: node.name, subtitle: node.subtitle ?? null }, { spaceRef: ref }),
        SYSTEM_ACTOR,
      )
      notes++
    }

    // A sub-space's note is a FOLDER at the root of the parent's context
    // (lib/notes/entities.ts), so it carries the entity-folder pointer from the
    // first write rather than earning it by a later conversion.
    const pointer = index && isChildSpaceNode(node) ? index : null
    if (pointer) {
      const current = await prisma.node.findUnique({ where: { id: node.id }, select: { metadata: true } })
      const meta = (current?.metadata ?? {}) as Record<string, unknown>
      if (meta.notePath !== pointer) {
        await prisma.node.update({ where: { id: node.id }, data: { metadata: { ...meta, notePath: pointer } } })
      }
    }
  }

  console.log(
    `space records: ${nodes.length} node(s) — ${provisioned} space(s) provisioned, ${linked} linked, ${notes} note(s) written.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
