/**
 * Turn the old row-based resource folders (`resource_folders`,
 * `resources.folder_id`) into the Resources file system: each folder becomes
 * `resources/<path>/index.md`, each filed resource's note moves into it
 * (lib/resources/tree.ts#fileResource), and the row's folder is cleared.
 * Idempotent. Run before the drop migration for those columns.
 *
 *   pnpm --filter @visvine/web db:resources:folders-to-notes [--space <id>] [--dry]
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { SHARED_OWNER_KEY, createIndexFolder, readNoteOrNull } from '../lib/notes/store'
import { fileResource } from '../lib/resources/tree'
import { slugify } from '../lib/eventUtils'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry')
  const spaceId = arg('space')
  const folders = await prisma.resourceFolder.findMany({ where: spaceId ? { spaceId } : {} })
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (id: string): string => {
    const parts: string[] = []
    for (let cursor: string | null = id, i = 0; cursor && i < 16; i++) {
      const f = byId.get(cursor)
      if (!f) break
      parts.unshift(slugify(f.name) || 'folder')
      cursor = f.parentId
    }
    return `resources/${parts.join('/')}`
  }
  const system = { id: 'system', name: 'System', email: null }

  // Parents first, so every folder's index lands in a folder that exists.
  const ordered = [...folders].sort((a, b) => pathOf(a.id).split('/').length - pathOf(b.id).split('/').length)
  for (const f of ordered) {
    const path = pathOf(f.id)
    const context = { spaceId: f.spaceId, ownerKey: SHARED_OWNER_KEY }
    if (await readNoteOrNull(context, `${path}/index.md`)) continue
    console.log(`folder ${f.spaceId} ${path}`)
    if (!dry) await createIndexFolder(context, path, `---\ntitle: ${JSON.stringify(f.name)}\n---\n`, system)
  }

  const filed = await prisma.resource.findMany({
    where: { folderId: { not: null }, ...(spaceId ? { spaceId } : {}) },
    select: { id: true, spaceId: true, nodeId: true, folderId: true, name: true },
  })
  for (const r of filed) {
    const path = pathOf(r.folderId!)
    console.log(`file ${r.spaceId} ${r.name} → ${path}`)
    if (dry) continue
    if (r.nodeId) await fileResource(r.spaceId, r.nodeId, path, system)
    await prisma.resource.update({ where: { id: r.id }, data: { folderId: null } })
  }
  console.log(dry ? 'Dry run — nothing written.' : { folders: folders.length, filed: filed.length })
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  // The note writes schedule background work (link reasons) that would hold
  // the process open; everything owed is already committed.
  .finally(() => prisma.$disconnect().then(() => process.exit()))
