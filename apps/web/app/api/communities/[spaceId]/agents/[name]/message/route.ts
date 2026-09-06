import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { summonAgent } from '@/lib/agents/summon'
import { MAX_BODY } from '@/lib/agents/shared/channels'
import { dispatchWithin } from '@/lib/agents/dispatch'

// In `inline` dispatch (dev) the run happens inside this request.
// Segment config must be a literal Next can read statically: MAX_RUN_MS (25 min) + 60s.
export const maxDuration = 1560

const bodySchema = z.object({
  text: z.string().min(1).max(MAX_BODY),
  /** Start a run now when the agent is idle and the sender may run it. Default true. */
  run: z.boolean().optional(),
})

/**
 * Say something to an agent, from inside the app — and, by default, have it
 * act on it now (lib/agents/summon.ts). The message lands in the mailbox
 * either way; the run, when one starts, is watched on the page that sent it.
 * The request holds for RUN_AWAIT_MS like "Run now" does, so a short run
 * answers with its outcome and a long one answers `running: true`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return bad('text is required')

  const result = await summonAgent({ spaceId, name, principal: ctx.principal, text: parsed.data.text, run: parsed.data.run })
  if (!result.ok) return bad(result.message, result.status)

  const outcome = result.dispatch ? await dispatchWithin(result.dispatch) : null
  return NextResponse.json({
    ok: true,
    eventId: result.eventId,
    runId: result.runId,
    waiting: result.waiting,
    running: result.runId !== null && outcome === null,
    outcome: outcome?.ok ? outcome.outcome : null,
    error: outcome && !outcome.ok ? outcome.error : null,
  })
}
