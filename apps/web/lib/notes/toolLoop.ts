/**
 * The tool-calling loop every server-side agent shares (lib/agents/runner.ts
 * is the scheduled Space agent). One place owns the mechanics: send messages + tool
 * schemas, run each requested tool, feed results back, stop on a plain
 * answer, a turn cap, an abort, or a caller-supplied stop (budget).
 *
 * The model is injectable (`chatFn`) so the loop is testable against a
 * scripted model with no API key. Tools are plain handlers returning text —
 * what authority they carry is entirely the handler's business.
 */
import {
  chatWithTools,
  type AgentMessage,
  type ChatConfig,
  type ChatUsage,
  type ChatWithToolsResult,
  type ToolSpec,
} from './ai'
import { announcedNextStep, MAX_NARRATION_NUDGES, NEXT_STEP_NUDGE, narratedToolCall, narrationNudge } from './shared/narratedToolCall'

export type ChatFn = (
  messages: AgentMessage[],
  tools: ToolSpec[],
  opts: { config?: ChatConfig; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>

export interface ToolHandler {
  spec: ToolSpec
  /** Run the tool; the returned text goes back to the model verbatim. */
  run(args: Record<string, unknown>): Promise<string>
  /** One-line description of a call, for progress streams. */
  describe?(args: Record<string, unknown>): string
}

export type ToolLoopEvent =
  | { type: 'assistant'; text: string }
  | { type: 'tool'; tool: string; detail: string }
  | { type: 'tool_result'; tool: string; text: string }

type ToolLoopReason = 'finished' | 'max_turns' | 'stopped' | 'aborted' | 'error' | 'narrated'

export interface ToolLoopOptions {
  /** Seed conversation — normally a system message and the user prompt. */
  messages: AgentMessage[]
  tools: ToolHandler[]
  maxTurns: number
  chatFn?: ChatFn
  config?: ChatConfig
  signal?: AbortSignal
  onEvent?: (event: ToolLoopEvent) => void
  /**
   * Consulted before every model call with the usage so far. Return a short
   * reason string to stop the loop (result.reason = 'stopped'), or null to go on.
   */
  beforeTurn?: (state: { turn: number; usage: ChatUsage }) => string | null
}

export interface ToolLoopResult {
  reason: ToolLoopReason
  /** The `beforeTurn` reason when `reason === 'stopped'`. */
  stopReason: string | null
  /** The tool the model wrote out but never called, when `reason === 'narrated'`. */
  narratedTool: string | null
  /** The model's final plain-text answer, when it gave one. */
  finalText: string | null
  turns: number
  usage: ChatUsage
  error: Error | null
}

function addUsage(total: ChatUsage, more: ChatUsage | null): ChatUsage {
  if (!more) return total
  const cached = (total.cachedTokens ?? 0) + (more.cachedTokens ?? 0)
  const reasoning = (total.reasoningTokens ?? 0) + (more.reasoningTokens ?? 0)
  return {
    promptTokens: total.promptTokens + more.promptTokens,
    completionTokens: total.completionTokens + more.completionTokens,
    ...(cached > 0 ? { cachedTokens: cached } : {}),
    ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
  }
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const chatFn: ChatFn = opts.chatFn ?? chatWithTools
  const messages = [...opts.messages]
  const specs = opts.tools.map((t) => t.spec)
  const byName = new Map(opts.tools.map((t) => [t.spec.name, t]))
  const emit = opts.onEvent ?? (() => {})
  let usage: ChatUsage = { promptTokens: 0, completionTokens: 0 }
  /** How often this run has written a call out as text instead of making it. */
  let nudges = 0
  let promptedNextStep = false

  const done = (
    reason: ToolLoopReason,
    turns: number,
    extra: Partial<Pick<ToolLoopResult, 'stopReason' | 'finalText' | 'error' | 'narratedTool'>> = {},
  ): ToolLoopResult => ({
    reason,
    stopReason: extra.stopReason ?? null,
    narratedTool: extra.narratedTool ?? null,
    finalText: extra.finalText ?? null,
    turns,
    usage,
    error: extra.error ?? null,
  })

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (opts.signal?.aborted) return done('aborted', turn)
    const stop = opts.beforeTurn?.({ turn, usage }) ?? null
    if (stop) return done('stopped', turn, { stopReason: stop })

    let reply: ChatWithToolsResult
    try {
      reply = await chatFn(messages, specs, { config: opts.config, signal: opts.signal })
    } catch (e) {
      if (opts.signal?.aborted) return done('aborted', turn)
      return done('error', turn, { error: e instanceof Error ? e : new Error(String(e)) })
    }
    usage = addUsage(usage, reply.usage)

    if (reply.toolCalls.length === 0) {
      // A reply with no tool calls is normally the answer. It is not when the
      // answer IS a call, written out as text (lib/notes/shared/narratedToolCall.ts):
      // the model thinks it acted and nothing ran. Say so and give it the turn
      // back; a model that keeps narrating ends the run as a FAILURE, because a
      // plan recorded as a success is the one outcome nobody catches.
      const narrated = narratedToolCall(reply.content, specs.map((s) => s.name))
      if (narrated) {
        if (reply.content?.trim()) emit({ type: 'assistant', text: reply.content.trim() })
        if (nudges >= MAX_NARRATION_NUDGES) {
          return done('narrated', turn + 1, { finalText: reply.content?.trim() || null, narratedTool: narrated })
        }
        nudges++
        messages.push({ role: 'assistant', content: reply.content ?? '' })
        messages.push({ role: 'user', content: narrationNudge(narrated) })
        continue
      }
      // A reply that stops on "now I'll …" paused between steps; it is given
      // the turn back ONCE, and whatever it says then is its answer.
      if (!promptedNextStep && announcedNextStep(reply.content)) {
        promptedNextStep = true
        if (reply.content?.trim()) emit({ type: 'assistant', text: reply.content.trim() })
        messages.push({ role: 'assistant', content: reply.content ?? '' })
        messages.push({ role: 'user', content: NEXT_STEP_NUDGE })
        continue
      }
      // The final answer is returned, not emitted — callers render it their way.
      return done('finished', turn + 1, { finalText: reply.content?.trim() || null })
    }

    if (reply.content?.trim()) emit({ type: 'assistant', text: reply.content.trim() })
    messages.push({
      role: 'assistant',
      content: reply.content,
      tool_calls: reply.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    })

    for (const call of reply.toolCalls) {
      if (opts.signal?.aborted) return done('aborted', turn + 1)
      let args: Record<string, unknown>
      try {
        const parsed = JSON.parse(call.arguments) as unknown
        args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'error: arguments were not valid JSON' })
        continue
      }
      const handler = byName.get(call.name)
      emit({ type: 'tool', tool: call.name, detail: handler?.describe?.(args) ?? '' })
      let result: string
      if (!handler) {
        result = `error: unknown tool ${call.name}`
      } else {
        try {
          result = await handler.run(args)
        } catch (e) {
          result = `error: ${e instanceof Error ? e.message : 'tool failed'}`
        }
      }
      emit({ type: 'tool_result', tool: call.name, text: result })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  return done('max_turns', opts.maxTurns)
}
