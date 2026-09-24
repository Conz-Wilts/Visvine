/**
 * The agent scheduler, for local development: the minute tick Cloud Scheduler
 * gives production, run from its own process against the local database.
 * Scheduled and triggered agents then fire on a laptop as they do deployed —
 * each run inline, in this process, on the space's real model.
 *
 * A separate process on purpose: the app keeps no timers of its own (it
 * scales to zero), and a person decides when their laptop spends model credit.
 *
 *   pnpm --filter @visvine/web agents:tick            every minute until stopped
 *   pnpm --filter @visvine/web agents:tick --once     one tick, then exit
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'

process.env.AGENT_DISPATCH = 'inline'
const EVERY_MS = 60_000

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('agents:tick is for local development; production ticks from Cloud Scheduler')
  const { tick } = await import('../lib/agents/schedule')
  const once = process.argv.includes('--once')
  for (;;) {
    const started = Date.now()
    try {
      const report = await tick()
      const outcomes = report.dispatched.map((d) => `${d.runId.slice(0, 8)} ${JSON.stringify(d.result).slice(0, 80)}`)
      console.log(
        `${new Date().toLocaleTimeString()} tick · considered ${report.considered} · claimed ${report.claimed.length}` +
          `${report.reclaimed ? ` · reclaimed ${report.reclaimed}` : ''}${outcomes.length ? `\n  ${outcomes.join('\n  ')}` : ''}`,
      )
    } catch (err) {
      console.error('tick failed', err)
    }
    if (once) break
    await new Promise((r) => setTimeout(r, Math.max(0, EVERY_MS - (Date.now() - started))))
  }
  const { default: prisma } = await import('../lib/prisma')
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
