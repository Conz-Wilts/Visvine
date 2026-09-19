/**
 * Write every agent's subscribers into its brief's `for:` block.
 *
 * Who an agent runs for is the brief's `for:` block (lib/agents/shared/runsFor.ts)
 * and `agent_subscriptions` is an index of it, rebuilt on every brief write.
 * Rows made before the block existed are in the index and not in the note, so
 * the next write to their brief would drop them. This puts each one into its
 * brief. Run it BEFORE the first deploy that reads the block.
 *
 * Idempotent: a person already listed is left as they are.
 *
 *   pnpm --filter @visvine/web db:agents:runs-for
 *   pnpm --filter @visvine/web db:agents:runs-for --dry-run
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { findOwnAgentBrief } from '../lib/agents/briefs'
import { setRunsFor } from '../lib/agents/briefEdit'
import { parseRunsFor } from '../lib/agents/shared/runsFor'
import { MAX_FANOUT_SUBSCRIBERS } from '../lib/agents/limits'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import * as store from '../lib/notes/store'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const rows = await prisma.agentSubscription.findMany({ orderBy: { createdAt: 'asc' }, select: { spaceId: true, name: true, userId: true } })
  const byAgent = new Map<string, { spaceId: string; name: string; userIds: string[] }>()
  for (const r of rows) {
    const key = `${r.spaceId}\n${r.name}`
    const entry = byAgent.get(key) ?? { spaceId: r.spaceId, name: r.name, userIds: [] }
    entry.userIds.push(r.userId)
    byAgent.set(key, entry)
  }

  let written = 0
  for (const { spaceId, name, userIds } of byAgent.values()) {
    const brief = await findOwnAgentBrief(spaceId, name)
    if (!brief) {
      console.log(`skip   ${spaceId} ${name}: no brief`)
      continue
    }
    const parsed = parseRunsFor(parseFrontmatter(brief.content).for)
    const listed = new Set(parsed.ok ? parsed.entries.map((e) => e.userId) : [])
    let content = brief.content
    let added = 0
    for (const userId of userIds) {
      if (listed.has(userId) || listed.size >= MAX_FANOUT_SUBSCRIBERS) continue
      content = setRunsFor(content, userId, { at: null, timezone: null, model: null })
      listed.add(userId)
      added += 1
    }
    if (added === 0) continue
    console.log(`${dryRun ? 'would ' : ''}write ${spaceId} ${name}: +${added}`)
    if (!dryRun) {
      await store.writeNote({ spaceId, ownerKey: store.SHARED_OWNER_KEY }, brief.path, content, { id: 'system', name: 'Visvine' }, 'maintenance', 'agents')
    }
    written += 1
  }
  console.log(`${written} brief(s) ${dryRun ? 'to write' : 'written'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
