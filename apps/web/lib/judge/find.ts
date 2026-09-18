// Finding the lines of a long text that are about something — so an agent that
// fetched a page or opened a long note for ONE thing reads a dozen lines of it,
// not 48,000 characters, on the space's paid model.
//
// One request: the text as numbered units (a choice question holds at most 255
// options, so a long text is grouped into that many runs of lines), one choice
// ranking the units against what is looked for, and one noul saying whether the
// text holds it at all — a choice's probabilities always sum to 1, so SOME unit
// ranks first even when none is relevant, and the noul is what tells those
// apart. No verdict returns null and the caller hands back the text as before.

import { decide } from './client'
import { choiceOf, noulOf } from './shared/types'

const MAX_UNITS = 240
const UNIT_CHARS = 400
const KEEP = 12
const PRESENT_FLOOR = 0.3
const FIND_DEADLINE_MS = 4_000
/** Below this a text is cheaper to hand over whole than to judge. */
export const FIND_MIN_CHARS = 3_000

export interface FoundLines {
  present: boolean
  /** The matching units with a unit of context either side, in document order, `…` between gaps. */
  text: string
}

export async function findLines(text: string, lookingFor: string): Promise<FoundLines | null> {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  if (lines.length < 2 || !lookingFor.trim()) return null
  const per = Math.max(1, Math.ceil(lines.length / MAX_UNITS))
  const units: string[] = []
  for (let i = 0; i < lines.length; i += per) units.push(lines.slice(i, i + per).join('\n'))

  const numbered = Object.fromEntries(units.map((u, i) => [`u${i}`, u.slice(0, UNIT_CHARS)]))
  const answers = await decide(
    { looking_for: lookingFor.slice(0, 500), text: numbered },
    {
      which: { type: 'choice', instructions: 'Which part of the text is most about what is being looked for?', criteria: Object.fromEntries(units.map((_, i) => [`u${i}`, `Part u${i}`])) },
      present: {
        type: 'noul',
        instructions: 'Does the text contain what is being looked for?',
        criteria: { true: 'Some part of the text states or discusses it.', false: 'No part of the text is about it.' },
      },
    },
    { deadlineMs: FIND_DEADLINE_MS },
  )
  const which = choiceOf(answers, 'which')
  const present = noulOf(answers, 'present')
  if (!which || present === undefined) return null
  if (present < PRESENT_FLOOR) return { present: false, text: '' }

  const ranked = Object.entries(which.probabilities)
    .map(([id, p]) => ({ at: Number(id.slice(1)), p }))
    .filter((r) => r.p >= 1 / (units.length * 2))
    .sort((a, b) => b.p - a.p)
    .slice(0, KEEP)
  const keep = new Set<number>()
  for (const r of ranked) for (const at of [r.at - 1, r.at, r.at + 1]) if (at >= 0 && at < units.length) keep.add(at)
  const order = [...keep].sort((a, b) => a - b)
  const out: string[] = []
  order.forEach((at, i) => {
    if (i > 0 && at !== order[i - 1] + 1) out.push('…')
    out.push(units[at])
  })
  return { present: true, text: out.join('\n') }
}
