/**
 * Give every agent its record: fold the run keys its brief note still carries
 * (model, connectors, tools, schedule, runs-for, share, caps…) into its
 * `agent_state` row and `agent_subscriptions`, and strip them from the note.
 * The same fold the store hook does on the next write to a brief
 * (lib/agents/hooks.ts#adoptNoteConfig), run for every agent at once so none
 * waits for an edit. A pre-merge activation.md is folded in too.
 *
 * A brief that does not parse is reported and left as it is — its note still
 * says why, where briefs are read.
 *
 * Idempotent.
 *
 *   pnpm --filter @visvine/web db:agents:to-rows --dry-run
 *   pnpm --filter @visvine/web db:agents:to-rows
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { agentNameOfPath, isAgentBriefPath } from '../lib/notes/entities'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import { agentConfigOf, readAgent } from '../lib/agents/briefs'
import { runKeysOf } from '../lib/agents/shared/agentConfig'
import { adoptNoteConfig, syncAgentState } from '../lib/agents/hooks'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const notes = await prisma.contextNote.findMany({
    where: { ownerKey: 'shared', deletedAt: null, path: { startsWith: 'agents/' } },
    select: { spaceId: true, path: true, content: true },
  })
  let adopted = 0
  let broken = 0
  for (const note of notes) {
    if (!isAgentBriefPath(note.path)) continue
    const name = agentNameOfPath(note.path)
    if (!name) continue
    const keys = runKeysOf(parseFrontmatter(note.content))
    const configured = await agentConfigOf(note.spaceId, name)
    if (configured && keys.length === 0) continue
    const agent = await readAgent(note.spaceId, name)
    const problem = !agent ? 'no brief' : !agent.brief.ok ? agent.brief.error : !agent.activation.ok ? agent.activation.error : null
    if (problem && !configured) {
      broken++
      console.log(`broken ${note.spaceId} ${name}: ${problem}`)
      continue
    }
    console.log(`${dryRun ? 'would ' : ''}adopt ${note.spaceId} ${name}${keys.length ? ` (${keys.join(', ')})` : ''}`)
    adopted++
    if (dryRun) continue
    await adoptNoteConfig(note.spaceId, name)
    await syncAgentState(note.spaceId, name)
  }
  console.log(`\n${dryRun ? 'would adopt' : 'adopted'} ${adopted}, broken ${broken}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
