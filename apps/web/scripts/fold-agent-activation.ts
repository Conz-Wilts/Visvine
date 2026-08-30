/**
 * An agent is ONE note (lib/agents/config.ts): `agents/<name>/index.md` says
 * what the agent is AND when it runs. This folds in the earlier shape, where
 * the second half lived beside it:
 *
 *   agents/<name>/activation.md  →  activation keys in agents/<name>/index.md
 *
 * The activation's `active`, `schedule`, `at`, `on`, `every`, `debounce`,
 * `timezone` and `runs_as` are copied into the brief's frontmatter and the
 * activation note is trashed (its revisions stay in the trash). The brief's
 * own keys and body are untouched, and a brief that already carries an
 * activation wins — the sibling is then only a leftover, and is removed.
 *
 * Every agent touched has its state row re-derived at the end, so nothing is
 * left scheduled from a note that no longer exists.
 *
 * Idempotent: a space with no activation notes reports nothing to do.
 *
 *   pnpm --filter @visvine/web db:agents:activation            # every space
 *   pnpm --filter @visvine/web db:agents:activation <spaceId>  # one space
 *   pnpm --filter @visvine/web db:agents:activation --dry-run
 *
 * Against production it is run once, straight after the deploy that merged the
 * two notes, through the proxy with the guard's override (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { agentBriefPath, isLegacyActivationFrontmatter } from '../lib/agents/config'
import { syncAgentState } from '../lib/agents/hooks'
import { agentNameOfPath, isAgentActivationPath } from '../lib/notes/entities'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'
import { deleteNote, readNoteOrNull, SHARED_OWNER_KEY, writeNote } from '../lib/notes/store'

const SYSTEM_ACTOR = { id: 'system', name: 'Visvine', email: null }

/** The keys the activation owns, in the order they read best in a brief. */
const KEYS = ['active', 'schedule', 'at', 'on', 'every', 'debounce', 'timezone', 'runs_as'] as const

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--'))

  const notes = await prisma.contextNote.findMany({
    where: { ...(only ? { spaceId: only } : {}), ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/' } },
    select: { spaceId: true, path: true, content: true },
    orderBy: [{ spaceId: 'asc' }, { path: 'asc' }],
  })

  let folded = 0
  let dropped = 0
  let skipped = 0
  const touched = new Set<string>()

  for (const note of notes) {
    const { spaceId, path } = note
    if (!isAgentActivationPath(path)) continue
    const name = agentNameOfPath(path)
    const label = `${spaceId} ${path}`
    if (!name) continue
    const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
    const briefPath = agentBriefPath(name)
    const brief = await readNoteOrNull(context, briefPath)
    if (!brief) {
      skipped++
      console.warn(`  ! ${label}: no brief at ${briefPath} — left alone`)
      continue
    }
    const activationFm = parseFrontmatter(note.content)
    if (!isLegacyActivationFrontmatter(activationFm) && activationFm.active === undefined) {
      skipped++
      console.warn(`  ! ${label}: not an activation note — left alone`)
      continue
    }
    const briefFm = parseFrontmatter(brief)
    // The brief wins: once it carries an activation, the sibling is a leftover.
    const carries = KEYS.some((k) => briefFm[k] !== undefined && briefFm[k] !== null && briefFm[k] !== '')
    if (carries) {
      dropped++
      console.log(`  → ${label} removed (the brief already says when it runs)`)
      touched.add(`${spaceId}\n${name}`)
      if (!dryRun) await deleteNote(context, path)
      continue
    }
    const merged = { ...briefFm }
    for (const key of KEYS) {
      const value = activationFm[key]
      if (value !== undefined && value !== null && value !== '') merged[key] = value
    }
    // `active` is the one key worth stating either way: an agent whose note
    // never says so reads as off, and that is what the row already believes.
    if (merged.active === undefined) merged.active = false
    console.log(`  → ${label} folded into ${briefPath}`)
    folded++
    touched.add(`${spaceId}\n${name}`)
    if (dryRun) continue
    await writeNote(context, briefPath, joinFrontmatter(merged, splitFrontmatter(brief).body), SYSTEM_ACTOR, 'maintenance', 'agents')
    await deleteNote(context, path)
  }

  if (!dryRun) {
    for (const key of touched) {
      const [spaceId, name] = key.split('\n')
      await syncAgentState(spaceId, name)
    }
  }

  console.log(`agent activations: ${folded} ${dryRun ? 'would fold' : 'folded'}, ${dropped} leftover removed, ${skipped} skipped.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
