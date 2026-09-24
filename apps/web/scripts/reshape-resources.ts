/**
 * Bring every resource into the one-resource-many-shares shape
 * (lib/resources/reshape.ts). Idempotent.
 *
 *   pnpm --filter @visvine/web db:resources:reshape [--space <id>] [--dry]
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { reshapeResources } from '../lib/resources/reshape'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry')
  const counts = await reshapeResources({ spaceId: arg('space'), dry, log: (line) => console.log(line) })
  console.log(dry ? 'Dry run — nothing written.' : counts)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
