/**
 * Catching a model that DESCRIBES a tool call instead of making one.
 *
 * Some models, asked to use tools, answer with the call written out as text —
 * a numbered plan and a fenced block of `default_api.fetch_url(...)`, or a
 * JSON object naming the tool. No call is made, so the loop sees a reply with
 * no tool calls and reads it as the final answer: the run ends after one turn,
 * having fetched nothing and written nothing, and is recorded as a success.
 * That is the worst shape a failure can take, because from the outside it
 * looks like the agent did its job.
 *
 * So the loop asks this first (lib/notes/toolLoop.ts): does this plain answer
 * contain a call it meant to make? If it does, the model is told so and given
 * another turn; if it keeps narrating, the run FAILS rather than passing off a
 * plan as work.
 *
 * Deliberately conservative — it fires only on a call SHAPE that also names a
 * tool this run actually has, because a note about a tool is not a call, and
 * an agent writing about `fetch_url` in prose must not be nudged for it.
 *
 * Pure: no I/O, and the thing worth testing is exactly which shapes count.
 */

/** A tool name as it may appear in source: letters, digits, underscore. */
const NAME = '[A-Za-z_][A-Za-z0-9_]*'

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The fenced blocks in a message, body only. */
function fencedBlocks(text: string): string[] {
  const out: string[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/**
 * The tool this text wrote out but never called, or null.
 *
 * `toolNames` is the run's own tool surface — a name that is not in it is not
 * a narrated call, it is prose.
 */
export function narratedToolCall(text: string | null | undefined, toolNames: readonly string[]): string | null {
  if (!text || toolNames.length === 0) return null
  const known = new Set(toolNames)
  const alt = toolNames.map(escape).join('|')

  // 1. A namespaced call, wherever it sits: Gemini's `default_api.fetch_url(`,
  //    OpenAI's `functions.fetch_url(`, and the `tools.`/`api.` variants.
  const namespaced = new RegExp(`\\b(?:default_api|functions|tools|api|tool)\\.(${alt})\\s*\\(`)
  const ns = namespaced.exec(text)
  if (ns) return ns[1]

  // 2. An XML-shaped call some models emit as text rather than as a call.
  const xml = new RegExp(`<(?:invoke|tool_call|function)\\b[^>]*name\\s*=\\s*["']?(${alt})["']?`)
  const x = xml.exec(text)
  if (x) return x[1]

  // 3. A fenced block: a bare `fetch_url(` call, or the JSON envelope. Fenced,
  //    because a bare name followed by a bracket in prose is not a call.
  for (const block of fencedBlocks(text)) {
    const bare = new RegExp(`(?:^|[^.\\w])(${alt})\\s*\\(`).exec(block)
    if (bare) return bare[1]
    const json = new RegExp(`["'](?:name|tool|tool_name|function)["']\\s*:\\s*["'](${NAME})["']`).exec(block)
    if (json && known.has(json[1])) return json[1]
  }

  // 4. The JSON envelope unfenced, but only beside an arguments key — that
  //    pairing is a call and nothing else.
  const envelope = new RegExp(
    `["'](?:name|tool|tool_name|function)["']\\s*:\\s*["'](${NAME})["'][\\s\\S]{0,200}?["'](?:arguments|parameters|args|input)["']\\s*:`,
  ).exec(text)
  if (envelope && known.has(envelope[1])) return envelope[1]

  return null
}

/** How many times one run is told before its narration is treated as a failure. */
export const MAX_NARRATION_NUDGES = 2

/**
 * What the model is told when it narrates. Short and mechanical: naming the
 * tool it wrote out is what makes the correction land, and "nothing ran" is
 * the fact it got wrong.
 */
export function narrationNudge(tool: string): string {
  return (
    `You wrote out a call to \`${tool}\` as text instead of calling it, so NOTHING RAN — no page was fetched, no note was written. ` +
    'The tools listed for this run are real function calls, not code for you to write. ' +
    'Do not write Python, JSON, `default_api.…` or a plan describing what you will do. ' +
    'Make the call itself now, through the tool interface, and carry on from its result.'
  )
}
