/**
 * Give every Drive file its Resource.
 *
 *   pnpm --filter @visvine/web db:resources:link [--space <id>] [--dry]
 *
 * A file is shown on a `resource` node's page (`metadata.fileId`); an upload
 * makes that node itself. This makes one for each file that has none, named
 * after the file, with its note under `resources/`. Idempotent: a file whose
 * node exists is skipped.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { findNodeIdByRecord } from '../lib/notes/context/entityNodes'
import { linkFileNode } from '../lib/resources/node'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const only = arg('space')
  const dry = process.argv.includes('--dry')

  const files = await prisma.resource.findMany({
    where: only ? { spaceId: only } : {},
    select: { id: true, spaceId: true, name: true, uploadedBy: true },
    orderBy: { createdAt: 'asc' },
  })

  let linked = 0
  let failed = 0
  for (const file of files) {
    if (await findNodeIdByRecord(file.spaceId, 'resource', file.id)) continue
    if (dry) {
      console.log(`  would link ${file.spaceId} ${file.name}`)
      linked++
      continue
    }
    const { nodeId } = await linkFileNode(file, null, { revalidate: false })
    if (nodeId) {
      console.log(`  ${file.spaceId} ${file.name} → ${nodeId}`)
      linked++
    } else {
      failed++
    }
  }
  console.log(`${linked} file(s) ${dry ? 'to link' : 'linked'}, ${failed} failed, of ${files.length}.`)
  if (failed) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
