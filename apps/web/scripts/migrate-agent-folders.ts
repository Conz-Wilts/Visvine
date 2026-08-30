/**
 * An agent is a folder (lib/agents/config.ts): `agents/<name>/index.md` is the
 * brief, `agents/<name>/activation.md` the activation, and the rest of the
 * folder is what its runs write. This moves the two earlier shapes into it:
 *
 *   agents/<name>.md            → agents/<name>/index.md        (the brief)
 *   agents/<folder>/<name>.md   → agents/<name>/index.md        (a nested brief)
 *   agents/live/<name>.md       → agents/<name>/activation.md   (the activation)
 *
 * and removes `agents/live/` once it is empty. A flat brief moves through the
 * same `ensureEntityFolder` a live write uses (grants, flags, links, history
 * and the node pointer follow); a nested one is re-created at its folder and
 * the old note trashed — its revisions stay in the trash. Every agent touched
 * has its state row re-derived at the end, so nothing is left running under a
 * name the notes no longer describe.
 *
 * Idempotent: a space already in the folder shape reports nothing to do.
 *
 *   pnpm --filter @visvine/web db:agents:folders            # every space
 *   pnpm --filter @visvine/web db:agents:folders <spaceId>  # one space
 *   pnpm --filter @visvine/web db:agents:folders --dry-run
 *
 * Against production it is run once, straight after the deploy that made
 * agents folders, through the proxy with the guard's override
 * (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { AGENT_NAME_RE, agentActivationPath, agentBriefPath } from '../lib/agents/config'
import { syncAgentState } from '../lib/agents/hooks'
import { isAgentActivationPath, isAgentBriefPath } from '../lib/notes/entities'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import { createNote, deleteFolder, deleteNote, ensureEntityFolder, readNoteOrNull, renameNote, SHARED_OWNER_KEY } from '../lib/notes/store'

const SYSTEM_ACTOR = { id: 'system', name: 'Visvine', email: null }

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--'))

  const notes = await prisma.contextNote.findMany({
    where: { ...(only ? { spaceId: only } : {}), ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/' } },
    select: { spaceId: true, path: true, content: true },
    orderBy: [{ spaceId: 'asc' }, { path: 'asc' }],
  })

  let briefs = 0
  let activations = 0
  let skipped = 0
  const touched = new Set<string>()
  const spaces = new Set<string>()

  for (const note of notes) {
    const { spaceId, path } = note
    spaces.add(spaceId)
    if (isAgentBriefPath(path) || isAgentActivationPath(path)) continue
    const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
    const label = `${spaceId} ${path}`

    // The activation: agents/live/<name>.md → agents/<name>/activation.md.
    const live = /^agents\/live\/([^/]+)\.md$/.exec(path)
    if (live) {
      const name = live[1]
      if (!AGENT_NAME_RE.test(name)) {
        skipped++
        console.warn(`  ! ${label}: "${name}" is not an agent name — left alone`)
        continue
      }
      const dest = agentActivationPath(name)
      if (await readNoteOrNull(context, dest)) {
        skipped++
        console.warn(`  ! ${label}: ${dest} already exists — merge by hand`)
        continue
      }
      console.log(`  → ${label} → ${dest}`)
      activations++
      touched.add(`${spaceId}\n${name}`)
      if (dryRun) continue
      // The brief may still be flat here; its own move below makes the folder,
      // and a rename into a folder that does not exist yet makes it too.
      await renameNote(context, path, dest, SYSTEM_ACTOR)
      continue
    }

    // A brief at its flat path or nested in a folder of agents.
    const fm = parseFrontmatter(note.content)
    const isBrief = typeof fm.type === 'string' && fm.type.trim().toLowerCase() === 'agent'
    if (!isBrief || path === 'agents/index.md' || path.endsWith('/index.md')) continue
    const name = path.slice(path.lastIndexOf('/') + 1, -'.md'.length)
    if (!AGENT_NAME_RE.test(name)) {
      skipped++
      console.warn(`  ! ${label}: "${name}" is not an agent name — left alone`)
      continue
    }
    const dest = agentBriefPath(name)
    if (await readNoteOrNull(context, dest)) {
      skipped++
      console.warn(`  ! ${label}: ${dest} already exists — merge by hand`)
      continue
    }
    console.log(`  → ${label} → ${dest}`)
    briefs++
    touched.add(`${spaceId}\n${name}`)
    if (dryRun) continue
    if (path === `agents/${name}.md`) {
      // The flat alias: the same move a live write makes, node pointer and all.
      await ensureEntityFolder(context, { id: `agent:${name}`, type: 'agent', name: typeof fm.title === 'string' ? fm.title : name }, SYSTEM_ACTOR)
    } else {
      // Nested: nothing derives from the old path, so re-create and trash.
      await createNote(context, dest, note.content, SYSTEM_ACTOR)
      await deleteNote(context, path)
    }
  }

  // `agents/live/` is empty once its activations have moved; take the folder
  // with it so the tree does not keep an empty "live" beside the agents.
  if (!dryRun) {
    for (const spaceId of spaces) {
      const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
      const left = await prisma.contextNote.count({
        where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/live/' }, NOT: { path: 'agents/live/index.md' } },
      })
      if (left === 0 && (await readNoteOrNull(context, 'agents/live/index.md'))) {
        console.log(`  → ${spaceId} agents/live/ removed`)
        await deleteFolder(context, 'agents/live')
      }
    }
    for (const key of touched) {
      const [spaceId, name] = key.split('\n')
      await syncAgentState(spaceId, name)
    }
  }

  console.log(
    `agent folders: ${briefs} brief(s) and ${activations} activation(s) ${dryRun ? 'would move' : 'moved'}, ${skipped} skipped.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
