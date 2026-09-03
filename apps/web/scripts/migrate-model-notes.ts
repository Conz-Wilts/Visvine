/**
 * A model is its own kind (lib/models): `models/<name>.md` with `type: model`.
 * This moves the shape before that — `connectors/<name>.md` carrying
 * `type: connector` and `kind: model` — into it:
 *
 *   connectors/<name>.md   → models/<name>.md   (type: model; kind and alias dropped)
 *
 * The move is a rename through the store (revisions, links and the node
 * pointer follow, and the old `connector:` node is replaced by a `model:` one
 * when the note is re-synced), then a write of the converted frontmatter. The
 * key — MODEL_KEY_<PROVIDER> in connector_secrets — is the space's, keyed by
 * provider, so it is untouched. Spend is keyed by `<provider>/<model>` and is
 * untouched too.
 *
 * Idempotent: a space with nothing left in the old shape reports nothing to do.
 * spaceModels reads both shapes until this has run, so the order of the
 * deploy and this script does not decide whether agents run.
 *
 *   pnpm --filter @visvine/web db:models:migrate            # every space
 *   pnpm --filter @visvine/web db:models:migrate <spaceId>  # one space
 *   pnpm --filter @visvine/web db:models:migrate --dry-run
 *
 * Against production it is run once, straight after the deploy that made
 * models their own kind, through the proxy with the guard's override
 * (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { isLegacyModelConnector, legacyModelNoteToModel, MODEL_NAME_RE, modelPath } from '../lib/models/config'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'
import { readNoteOrNull, renameNote, SHARED_OWNER_KEY, writeNote } from '../lib/notes/store'

const SYSTEM_ACTOR = { id: 'system', name: 'Visvine', email: null }

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--'))

  const notes = await prisma.contextNote.findMany({
    where: { ...(only ? { spaceId: only } : {}), ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'connectors/', endsWith: '.md' } },
    select: { spaceId: true, path: true, content: true },
    orderBy: [{ spaceId: 'asc' }, { path: 'asc' }],
  })

  let moved = 0
  let skipped = 0
  for (const note of notes) {
    const fm = parseFrontmatter(note.content)
    if (!isLegacyModelConnector(fm)) continue
    const { spaceId, path } = note
    const label = `${spaceId} ${path}`
    const m = /^connectors\/([^/]+)\.md$/.exec(path)
    const name = m?.[1]
    if (!name || !MODEL_NAME_RE.test(name)) {
      skipped++
      console.warn(`  ! ${label}: "${name ?? path}" is not a model name — left alone`)
      continue
    }
    const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
    const dest = modelPath(name)
    if (await readNoteOrNull(context, dest)) {
      skipped++
      console.warn(`  ! ${label}: ${dest} already exists — merge by hand`)
      continue
    }
    console.log(`  → ${label} → ${dest}`)
    moved++
    if (dryRun) continue
    await renameNote(context, path, dest, SYSTEM_ACTOR)
    const converted = legacyModelNoteToModel(fm, splitFrontmatter(note.content).body)
    await writeNote(context, dest, joinFrontmatter(converted.fm, converted.body), SYSTEM_ACTOR)
  }

  console.log(`models: ${moved} note(s) ${dryRun ? 'would move' : 'moved'} to models/, ${skipped} skipped.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
