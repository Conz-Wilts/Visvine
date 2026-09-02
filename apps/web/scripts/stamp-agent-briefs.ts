/**
 * Bind every agent's state row to the note it was derived from, and drop the
 * runs that cannot be its own.
 *
 * `agent_state` is keyed by (space, name), so an agent deleted and written
 * again at the same name used to inherit the old one's row: its runs on the
 * page, the people subscribed to it, the mail addressed to it. The state row
 * now carries `brief_note_id` and `syncAgentState` retires the previous
 * incarnation when a different note turns up at the name. This stamps the rows
 * that predate that column, so the next reuse of a name is caught.
 *
 * `--drop-stale` also clears the runs already inherited: a run that STARTED
 * before the current brief note was created cannot be this agent's, whatever
 * the name says. It is off by default because seeded and backdated runs break
 * that assumption — read the dry run before passing it.
 *
 * Subscriptions and pending events are left alone — there is no timestamp that
 * says which agent they were meant for, and removing a live one would be worse
 * than leaving it.
 *
 * Idempotent.
 *
 *   pnpm --filter @visvine/web db:agents:stamp
 *   pnpm --filter @visvine/web db:agents:stamp --dry-run
 *   pnpm --filter @visvine/web db:agents:stamp --drop-stale
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { agentBriefAliasPath, agentBriefPath } from '../lib/agents/config'

const SHARED_OWNER_KEY = 'shared'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const dropStale = process.argv.includes('--drop-stale')
  const states = await prisma.agentState.findMany({ select: { id: true, spaceId: true, name: true, briefNoteId: true } })
  let stamped = 0
  let orphaned = 0
  let dropped = 0

  for (const state of states) {
    const notes = await prisma.contextNote.findMany({
      where: {
        spaceId: state.spaceId,
        ownerKey: SHARED_OWNER_KEY,
        deletedAt: null,
        path: { in: [agentBriefPath(state.name), agentBriefAliasPath(state.name)] },
      },
      select: { id: true, path: true, createdAt: true },
    })
    const brief = notes.find((n) => n.path === agentBriefPath(state.name)) ?? notes[0]
    if (!brief) {
      // No live brief: the agent is gone and the row is inert. Nothing to bind.
      orphaned += 1
      continue
    }
    const stale = await prisma.agentRun.count({ where: { stateId: state.id, startedAt: { lt: brief.createdAt } } })
    if (state.briefNoteId === brief.id && !(dropStale && stale > 0)) continue
    const note = stale ? `, ${dropStale ? 'drop' : 'ignoring'} ${stale} run(s) from before it` : ''
    console.log(`${state.spaceId}/${state.name}: bind ${brief.path} (${brief.id})${note}`)
    if (dryRun) {
      stamped += 1
      if (dropStale) dropped += stale
      continue
    }
    if (dropStale && stale > 0) {
      const { count } = await prisma.agentRun.deleteMany({ where: { stateId: state.id, startedAt: { lt: brief.createdAt } } })
      dropped += count
    }
    await prisma.agentState.update({ where: { id: state.id }, data: { briefNoteId: brief.id } })
    stamped += 1
  }

  console.log(
    `${dryRun ? 'Would bind' : 'Bound'} ${stamped} agent(s), ${dryRun ? 'dropping' : 'dropped'} ${dropped} stale run(s); ${orphaned} row(s) have no live brief.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
