// The wake gate: before a note-triggered run is dispatched, is the save it was
// woken by anything this agent would act on?
//
// A glob says WHERE an agent listens, not what it cares about: one watching
// `people/**` is woken by every save under it, and each wake is a paid model
// run that mostly ends "nothing to do". The judge reads the brief's
// instructions beside the saved note and declines the saves that give the
// agent nothing — at the tick, never inside the save, which must not wait on
// or fail because of a model.
//
// Only `note_written` events are judged. A webhook, a reply, a message and the
// clock are someone's explicit ask. No verdict (no key, rate limit, timeout)
// means the run happens: the gate can only save work, never lose it. A brief
// opts out with `on.wake: always`. A declined event is re-stamped so the run
// that does happen never sees it, and the decline is audited on the brief with
// its score, so a gate that is wrong is findable.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/notes/audit'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { decideMany } from '@/lib/judge/client'
import { noulOf } from '@/lib/judge/shared/types'
import { WAKE_FLOOR, WAKE_QUESTION } from '@/lib/judge/shared/questions'
import type { ClaimedEvent } from './events'

const INSTRUCTIONS_CHARS = 3_000
const NOTE_CHARS = 4_000
const GATE_DEADLINE_MS = 4_000

interface NoteEventPayload {
  path?: unknown
  subspace?: unknown
  childPath?: unknown
}

/** Where the saved note lives: a room's save reaches a house agent under the house's address. */
function noteAddress(spaceId: string, payload: unknown): { spaceId: string; path: string } | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as NoteEventPayload
  if (typeof p.subspace === 'string' && typeof p.childPath === 'string') return { spaceId: p.subspace, path: p.childPath }
  return typeof p.path === 'string' ? { spaceId, path: p.path } : null
}

/**
 * The claimed events this run should carry. Declined ones are re-stamped
 * `declined:<runId>` and audited; everything else comes back unchanged.
 */
export async function gateWake(input: {
  spaceId: string
  agentName: string
  runId: string
  briefPath: string
  briefContent: string
  events: ClaimedEvent[]
}): Promise<ClaimedEvent[]> {
  const judged = input.events.filter((e) => e.kind === 'note_written')
  if (judged.length === 0) return input.events
  try {
    const instructions = splitFrontmatter(input.briefContent).body.trim().slice(0, INSTRUCTIONS_CHARS)
    if (!instructions) return input.events
    const notes = await Promise.all(
      judged.map(async (e) => {
        const at = noteAddress(input.spaceId, e.payload)
        if (!at) return null
        const row = await prisma.contextNote.findFirst({
          where: { spaceId: at.spaceId, ownerKey: 'shared', path: at.path, deletedAt: null },
          select: { content: true },
        })
        return row ? { path: e.source, content: row.content } : null
      }),
    )
    const asked = judged.map((e, i) => ({ event: e, note: notes[i] })).filter((x) => x.note)
    const answers = await decideMany(
      asked.map(({ note }) => {
        const { body } = splitFrontmatter(note!.content)
        const title = parseFrontmatter(note!.content).title
        return {
          state: {
            agent_instructions: instructions,
            saved_note: { path: note!.path, title: typeof title === 'string' ? title : '', text: body.trim().slice(0, NOTE_CHARS) },
          },
          questions: { wake: WAKE_QUESTION },
        }
      }),
      { deadlineMs: GATE_DEADLINE_MS },
    )
    const declined = new Map<string, number>()
    asked.forEach(({ event }, i) => {
      const score = noulOf(answers[i], 'wake')
      if (score !== undefined && score < WAKE_FLOOR) declined.set(event.id, score)
    })
    if (declined.size === 0) return input.events

    await prisma.agentEvent.updateMany({ where: { id: { in: [...declined.keys()] } }, data: { consumedBy: `declined:${input.runId}` } })
    const lines = input.events.filter((e) => declined.has(e.id)).map((e) => `${e.source} (${declined.get(e.id)!.toFixed(2)})`)
    void logAudit(input.spaceId, {
      userId: 'system',
      name: 'Visvine',
      action: 'agent',
      path: input.briefPath,
      detail: `wake declined — not something the brief acts on: ${lines.join(', ')}`.slice(0, 500),
    })
    return input.events.filter((e) => !declined.has(e.id))
  } catch (err) {
    logger.warn('agents.wake_gate.failed', { err, spaceId: input.spaceId, agent: input.agentName })
    return input.events
  }
}
