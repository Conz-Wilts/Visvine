'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import { terminalLabel } from '../lib/rowState';

interface SendResponse {
  ok: true;
  runId: string | null;
  waiting: 'running' | 'cannot_run' | 'claimed' | null;
  running: boolean;
  outcome: { status: string; reason: string } | null;
  error: string | null;
}

/**
 * The box under the run: say something and the agent acts on it now.
 *
 * What you type goes through the same delivery every channel uses, and when
 * the agent is idle and you may run it, a run starts on the spot, as you, and
 * the line above follows it. It answers in the run's summary. When it is
 * already running the words wait in its mailbox for the next run — that is
 * the one case this box says anything about itself.
 */
export default function MessageAgent({
  spaceId,
  agentName,
  disabled,
  onStarted,
  onSettled,
}: {
  spaceId: string;
  agentName: string;
  disabled?: boolean;
  /** A run began for this message: the page should watch it. */
  onStarted: (runId: string) => void;
  /** The request finished (the run may still be going); the page should reload. */
  onSettled: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // The run row exists before the executor starts: reload while the request
    // waits so the line comes up live.
    const t = setInterval(onSettled, 1500);
    try {
      const res = await fetchJson<SendResponse>(`/api/communities/${spaceId}/agents/${encodeURIComponent(agentName)}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      setText('');
      if (res.runId) {
        onStarted(res.runId);
        if (res.error) setNotice(res.error);
        else if (res.outcome && res.outcome.status !== 'succeeded') setNotice(terminalLabel(res.outcome.reason));
      } else {
        setNotice(res.waiting === 'running' ? 'Sent. It reads this after the run in flight.' : 'Sent. It reads this on its next run.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      clearInterval(t);
      setBusy(false);
      onSettled();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2 rounded-md border border-border-subtle bg-surface-2 p-1.5 focus-within:ring-1 focus-within:ring-border-strong">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          disabled={disabled || busy}
          placeholder={disabled ? 'Turn it on to talk to it' : 'Ask it something…'}
          className="min-h-[2rem] w-full resize-none bg-transparent px-1.5 py-1 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-[12px] font-semibold text-brand-dark-green hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={send}
          disabled={disabled || busy || !text.trim()}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
      {notice && <p className="pl-1 text-[12px] text-text-muted">{notice}</p>}
      {error && <Alert inline>{error}</Alert>}
    </div>
  );
}
