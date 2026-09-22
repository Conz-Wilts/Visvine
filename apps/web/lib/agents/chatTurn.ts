/**
 * One chat turn through the tool loop — DB-free, so a test drives it with a
 * scripted model. lib/agents/chat.ts assembles the inputs from the space and
 * stores what comes back; this only orders the messages, watches the budget
 * and folds the trace.
 */
import type { AgentMessage, ChatConfig } from '@/lib/notes/ai'
import { runToolLoop, type ChatFn, type ToolHandler, type ToolLoopEvent, type ToolLoopResult } from '@/lib/notes/toolLoop'
import { perTurnStop, type BudgetState } from './budget'
import { compactTrace, type ChatTrace } from './shared/chat'

export interface ChatTurnInput {
  system: string
  memoryMessage: string | null
  history: AgentMessage[]
  userTurn: string
  tools: ToolHandler[]
  config?: ChatConfig
  maxTurns: number
  signal?: AbortSignal
  budget: BudgetState
  chatFn?: ChatFn
  onEvent?: (event: ToolLoopEvent) => void
}

export type ChatTurnResult = ToolLoopResult & { trace: ChatTrace[] }

export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const events: ToolLoopEvent[] = []
  const result = await runToolLoop({
    messages: [
      { role: 'system', content: input.system },
      ...(input.memoryMessage ? [{ role: 'system' as const, content: input.memoryMessage }] : []),
      ...input.history,
      { role: 'user', content: input.userTurn },
    ],
    tools: input.tools,
    maxTurns: input.maxTurns,
    chatFn: input.chatFn,
    config: input.config,
    signal: input.signal,
    beforeTurn: ({ usage }) => perTurnStop(input.budget, usage),
    onEvent: (e) => {
      events.push(e)
      input.onEvent?.(e)
    },
  })
  return { ...result, trace: compactTrace(events) }
}
