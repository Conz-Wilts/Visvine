/**
 * Report (and optionally delete) GCS objects that no live row points at.
 *
 *   pnpm db:gc:objects                 # report only — the default, always
 *   pnpm db:gc:objects --apply         # actually delete
 *   pnpm db:gc:objects --grace 72      # widen the "too new to judge" window
 *   pnpm db:gc:objects --bucket media  # one bucket only (media | resources)
 *
 * The reconciliation itself lives in lib/storage/audit.ts, shared with the
 * nightly sweep — which runs the same comparison every night in report-only
 * mode, so drift is visible without anyone remembering to run this. This script
 * is the interactive front end and the only thing that can delete.
 *
 * Deleting is opt-in via --apply because a GC sweep that deletes on a typo is
 * worse than no GC sweep at all.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { deleteOrphans, findOrphanObjects } from '../lib/storage/audit'

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function main(): Promise<void> {
  const apply = flag('apply')
  const graceHours = Number(arg('grace') ?? 24)
  const only = arg('bucket') as 'media' | 'resources' | undefined
  if (!Number.isFinite(graceHours) || graceHours < 0) {
    throw new Error('--grace must be a non-negative number of hours')
  }
  if (only && only !== 'media' && only !== 'resources') {
    throw new Error('--bucket must be "media" or "resources"')
  }
  if (!process.env.GCS_RESOURCES_BUCKET && !process.env.GCS_MEDIA_BUCKET) {
    console.log('No GCS buckets configured (GCS_RESOURCES_BUCKET / GCS_MEDIA_BUCKET). Nothing to audit.')
    return
  }

  console.log(
    `GC sweep — ${apply ? 'APPLY (objects will be deleted)' : 'report only'}, ` +
      `grace ${graceHours}h${only ? `, bucket=${only}` : ''}`,
  )

  const report = await findOrphanObjects({ graceMs: graceHours * 60 * 60 * 1000, only })

  console.log(
    `\nScanned ${report.scanned} object(s); ${report.tooRecent} skipped as newer than the grace window.`,
  )
  for (const name of report.unrecognised.slice(0, 20)) {
    console.log(`  ? unrecognised layout, left alone: ${name}`)
  }
  if (report.unrecognised.length > 20) {
    console.log(`  ? …and ${report.unrecognised.length - 20} more unrecognised`)
  }

  if (report.orphans.length === 0) {
    console.log('\nNo orphaned objects. Storage and database agree.')
    return
  }

  console.log(`\n${report.orphans.length} orphaned object(s), ${human(report.bytes)}:`)
  for (const o of report.orphans.slice(0, 50)) {
    console.log(`  ${o.bucket}/${o.name}  (${o.reason}, ${human(o.sizeBytes)})`)
  }
  if (report.orphans.length > 50) console.log(`  …and ${report.orphans.length - 50} more`)

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to delete these.')
    return
  }

  const deleted = await deleteOrphans(report.orphans, (o, err) =>
    console.error(`  failed: ${o.bucket}/${o.name}`, err instanceof Error ? err.message : err),
  )
  console.log(`\nDeleted ${deleted}/${report.orphans.length} objects (${human(report.bytes)} reclaimed).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
