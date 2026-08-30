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

type ToolLoopReason = 'finished' | 'max_turns' | 'stopped' | 'aborted' | 'error'

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
  /** The model's final plain-text answer, when it gave one. */
  finalText: string | null
  turns: number
  usage: ChatUsage
  error: Error | null
}

function addUsage(total: ChatUsage, more: ChatUsage | null): ChatUsage {
  if (!more) return total
  return {
    promptTokens: total.promptTokens + more.promptTokens,
    completionTokens: total.completionTokens + more.completionTokens,
  }
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const chatFn: ChatFn = opts.chatFn ?? chatWithTools
  const messages = [...opts.messages]
  const specs = opts.tools.map((t) => t.spec)
  const byName = new Map(opts.tools.map((t) => [t.spec.name, t]))
  const emit = opts.onEvent ?? (() => {})
  let usage: ChatUsage = { promptTokens: 0, completionTokens: 0 }

  const done = (
    reason: ToolLoopReason,
    turns: number,
    extra: Partial<Pick<ToolLoopResult, 'stopReason' | 'finalText' | 'error'>> = {},
  ): ToolLoopResult => ({
    reason,
    stopReason: extra.stopReason ?? null,
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
