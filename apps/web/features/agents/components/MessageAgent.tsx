'use client';

import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * Say something to the agent — the box in its sidebar.
 *
 * The in-app channel. What you type lands in the agent's mailbox and is read on
 * its next run — the same path an email or a Slack mention takes, because there
 * is one loop behind all of them. It is not a chat box: the agent answers by
 * doing its work, and what it did shows up on the run beside this box and in
 * the notes it writes.
 */
export default function MessageAgent({ spaceId, agentName }: { spaceId: string; agentName: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(agentName)}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      setText('');
      setNotice('Sent. It reads this on its next run.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
        }}
        rows={2}
        placeholder="What do you want it to do?"
        className="w-full resize-y rounded-md border border-border-subtle bg-surface-2 p-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-strong"
      />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-text-tertiary">{notice ?? 'Read on its next run.'}</p>
        <Button variant="ghost" size="sm" onClick={send} disabled={busy || !text.trim()}>
          Send
        </Button>
      </div>
      {error && <Alert inline>{error}</Alert>}
    </div>
  );
}
