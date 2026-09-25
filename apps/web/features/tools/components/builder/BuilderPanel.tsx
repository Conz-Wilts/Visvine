'use client';

/**
 * The Tool builder's conversation: the person's standing thread with the AI
 * that builds Tools in this space (lib/tools/builder.ts). It sits in the
 * Workbench beside the preview, so what it writes appears as it writes it —
 * each `workbench` event hands the Tool's name up, and the page reloads the
 * files and the preview.
 *
 * With no model in the space there is nothing to answer, and the panel says
 * where to build instead: the space's MCP address, for an AI client of the
 * person's own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Button, Skeleton, Textarea } from '@visvine/ui';
import { CheckIcon, CopyIcon } from '@/features/shared/icons';
import { useCopied } from '@/features/shared/hooks/useCopied';
import { MarkdownMessage } from '@/features/messages/components/MessageRow';
import type { ChatMessageDto } from '@/lib/agents/shared/chat';
import type { BuilderResponse } from '@/lib/tools/api';
import { clearBuilder, fetchBuilder, streamBuilder } from '../../lib/client';

/** How a call reads while it runs: the act, and what it touched. */
const ACT: Record<string, string> = {
  list_tools: 'Looking at the tools here',
  read_tool: 'Reading',
  create_tool: 'Creating',
  write_tool: 'Writing',
  check_tool: 'Checking',
  list_context: 'Looking at the folders',
  read_context: 'Reading',
};

function activityLine(tool: string, detail: string): string {
  const act = ACT[tool] ?? tool;
  return detail ? `${act} ${detail}` : act;
}

export default function BuilderPanel({
  spaceId,
  tool,
  onWorkbench,
  className,
}: {
  spaceId: string;
  /** The Tool the Workbench has open; null on the Build page before one exists. */
  tool: string | null;
  /** A call created or wrote this Tool. */
  onWorkbench: (tool: string) => void;
  className?: string;
}) {
  const [thread, setThread] = useState<BuilderResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // A turn streams for a minute or more; the page it reports to may have moved
  // on by then (a new Tool, a new address), so it always reaches the current one.
  const onWorkbenchRef = useRef(onWorkbench);
  useEffect(() => {
    onWorkbenchRef.current = onWorkbench;
  }, [onWorkbench]);
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  const [copied, copy] = useCopied(2000);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const next = await fetchBuilder(spaceId, signal);
      setThread(next);
      setMessages([...next.messages].reverse());
      return next;
    },
    [spaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the builder');
    });
    return () => controller.abort();
  }, [load]);

  // A turn this page did not start (sent from another tab, or before a
  // reload) is answered where it runs; poll until its answer lands.
  const pending = !sending && messages.some((m) => m.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void load().catch(() => {}), 2500);
    return () => clearInterval(id);
  }, [pending, load]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, activity]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setActivity([]);
    setDraft('');
    try {
      await streamBuilder(spaceId, { text, tool: toolRef.current }, (event) => {
        switch (event.type) {
          case 'user':
            setMessages((list) => [...list, event.message, { ...event.message, id: `${event.message.id}:answer`, role: 'assistant', text: '', status: 'pending', trace: [] }]);
            break;
          case 'tool':
            setActivity((lines) => [...lines, activityLine(event.tool, event.detail)]);
            break;
          case 'workbench':
            onWorkbenchRef.current(event.tool);
            break;
          case 'done':
            setMessages((list) => [...list.filter((m) => !m.id.endsWith(':answer')), event.message]);
            break;
          case 'error':
            setError(event.message);
            setMessages((list) => list.filter((m) => !m.id.endsWith(':answer')));
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The builder did not answer');
      setDraft(text);
    } finally {
      setSending(false);
      setActivity([]);
    }
  };

  const startOver = async () => {
    await clearBuilder(spaceId).catch(() => {});
    setMessages([]);
    setError(null);
  };

  if (!thread && !error) {
    return (
      <div className={clsx('flex flex-col gap-3 p-5', className)}>
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
    );
  }

  if (thread && !thread.ready.ok) {
    return (
      <div className={clsx('flex flex-col gap-3 p-5 text-sm', className)}>
        <p className="text-fg">{thread.ready.message}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-xs text-fg-secondary">
            {thread.mcp}
          </code>
          <Button size="sm" variant="ghost" onClick={() => void copy(thread.mcp)} aria-label="Copy the MCP address">
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ol className="flex flex-col gap-4">
          {messages.map((message) =>
            message.role === 'user' ? (
              <li key={message.id} className="ml-8 self-end rounded-xl bg-surface-subtle px-3.5 py-2 text-sm text-fg">
                <p className="whitespace-pre-wrap">{message.text}</p>
              </li>
            ) : (
              <li key={message.id} className="flex flex-col gap-1.5 text-sm text-fg">
                {message.status === 'pending' ? (
                  <p className="text-fg-muted">{activity[activity.length - 1] ?? 'Thinking'}…</p>
                ) : (
                  <>
                    <div className={clsx(message.status === 'failed' && 'text-danger-strong')}>
                      <MarkdownMessage text={message.text} />
                    </div>
                    {message.trace.length > 0 && (
                      <p className="text-xs text-fg-muted">{message.trace.map((call) => activityLine(call.tool, call.detail)).join(' · ')}</p>
                    )}
                  </>
                )}
              </li>
            ),
          )}
        </ol>
      </div>

      {error && <p className="border-t border-line-subtle px-5 py-2 text-[13px] text-danger-strong">{error}</p>}

      <div className="flex items-end gap-2 border-t border-line-subtle px-4 py-3">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={tool ? 'What should change?' : 'Describe the tool'}
          aria-label="Message the builder"
          className="min-h-[44px] flex-1 resize-none"
        />
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="brand" onClick={() => void send()} loading={sending} disabled={!draft.trim()}>
            Send
          </Button>
          {messages.length > 0 && !sending && (
            <Button size="sm" variant="ghost" onClick={() => void startOver()}>
              New
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
