/**
 * A long run's older tool results, shortened before they are sent again —
 * pure, no I/O.
 *
 * The tool loop resends the whole conversation every turn, so a 30k page read
 * on turn one is paid for on turn twenty too. A result more than
 * `keepTurns` model turns old and longer than `minChars` goes out as its
 * opening and a line saying it was trimmed. The model still sees what it
 * called and roughly what came back, and can call again for the rest; the
 * run's own trace keeps everything. Recent results are never touched, so a
 * job that reads, sorts and then writes within a few turns reads in full.
 */
import type { AgentMessage } from '../ai'

const KEEP_RESULT_TURNS = 6
const MIN_TRIM_CHARS = 8_000
const KEEP_HEAD_CHARS = 3_000

export function compactOlderResults(
  messages: readonly AgentMessage[],
  opts: { keepTurns?: number; minChars?: number; keepHead?: number } = {},
): AgentMessage[] {
  const keepTurns = opts.keepTurns ?? KEEP_RESULT_TURNS
  const minChars = opts.minChars ?? MIN_TRIM_CHARS
  const keepHead = opts.keepHead ?? KEEP_HEAD_CHARS
  const turns = messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length
  let turn = 0
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) turn++
    if (m.role !== 'tool' || turns - turn < keepTurns || m.content.length <= minChars) return m
    return {
      ...m,
      content: `${m.content.slice(0, keepHead)}\n…[older result trimmed: ${(m.content.length - keepHead).toLocaleString('en-US')} more characters. Call the tool again if you need them.]`,
    }
  })
}
