'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentReadiness, AgentSubscriber } from '@/lib/agents/service';
import type { ConnectorReadiness } from '@/lib/connectors/service';

/**
 * Who an agent runs FOR, and whether each person's runs would actually work.
 *
 * Every fire runs once per name on this list, as that person — so a
 * `mode: user` connector spends THEIR linked account. Putting your name down
 * is self-service (the run reaches only what you can already reach); the
 * notices underneath are the mismatch check: the connectors this agent
 * declares that YOU still have to connect before your runs do anything.
 */

/** The lines for whatever on this readiness list is not ready. */
export function ConnectorReadinessNotices({
  items,
  mine,
  who,
  isAdmin,
}: {
  items: ConnectorReadiness[];
  /** Whether the judged identity is the viewer ("your account") or someone else (`who`). */
  mine: boolean;
  who: string | null;
  isAdmin: boolean;
}) {
  const issues = items.filter((r) => r.status !== 'ok');
  if (issues.length === 0) return null;
  const adminLink = isAdmin ? (
    <>
      {' — '}
      <Link href="/admin?section=connectors" className="font-semibold text-brand-dark-green hover:underline">
        open Connectors
      </Link>
    </>
  ) : null;
  const owner = who ?? 'its author';
  return (
    <ul className="flex flex-col gap-1 text-[13px] text-amber-700">
      {issues.map((r) => {
        const provider = r.auth?.provider ?? r.connector;
        const connect = r.connectUrl ? (
          <>
            {' — '}
            <a href={r.connectUrl} className="font-semibold text-brand-dark-green hover:underline">
              connect it
            </a>
          </>
        ) : null;
        let line: React.ReactNode;
        switch (r.status) {
          case 'missing':
            line = (
              <>
                Uses a connector this space doesn’t have: {r.connector}
                {adminLink}
              </>
            );
            break;
          case 'disabled':
            line = (
              <>
                The {r.connector} connector is turned off{adminLink}
              </>
            );
            break;
          case 'invalid':
            line = <>The {r.connector} connector has a problem{r.detail ? `: ${r.detail}` : ''}</>;
            break;
          case 'needs_connection':
            line =
              r.auth?.mode === 'space' ? (
                <>
                  No {provider} account is connected for this space{isAdmin ? connect : ' — a space admin connects it'}
                </>
              ) : mine ? (
                <>
                  {r.connector} needs your {provider} account{connect}
                </>
              ) : (
                <>
                  {owner} hasn’t connected a {provider} account for {r.connector} yet
                </>
              );
            break;
          case 'broken':
            line = (
              <>
                The {provider} connection for {r.connector} stopped working
                {r.detail ? ` (${r.detail})` : ''}
                {mine || (r.auth?.mode === 'space' && isAdmin) ? connect : ` — ${owner} reconnects it`}
              </>
            );
            break;
          default:
            line = r.connector;
        }
        return <li key={r.connector}>{line}</li>;
      })}
    </ul>
  );
}

export default function RunsForPanel({
  spaceId,
  agentName,
  subscribers,
  viewerSubscribed,
  readiness,
  isAdmin,
  onChanged,
}: {
  spaceId: string;
  agentName: string;
  subscribers: AgentSubscriber[];
  viewerSubscribed: boolean;
  readiness: AgentReadiness;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const call = async (method: 'POST' | 'DELETE', userId?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(agentName)}/subscribers`, {
        method,
        ...(userId ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) } : {}),
      });
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  const others = subscribers.filter((s) => s.userId !== readiness.runAsUserId);
  const names = [readiness.runAsName ?? 'its author', ...others.map((s) => s.name ?? 'a member')];

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-text-primary">
          Runs for <span className="font-medium">{names.join(', ')}</span>
          <span className="text-text-muted"> — every fire runs once per person, as that person.</span>
        </p>
        <Button variant={viewerSubscribed ? 'ghost' : 'brand'} size="sm" disabled={busy} onClick={() => call(viewerSubscribed ? 'DELETE' : 'POST')}>
          {viewerSubscribed ? 'Remove me' : 'Add me'}
        </Button>
      </div>
      {isAdmin && others.length > 0 && (
        <p className="text-text-muted">
          {others.map((s, i) => (
            <span key={s.userId}>
              {i > 0 && ' · '}
              {s.name ?? 'a member'}{' '}
              <button type="button" className="text-text-muted hover:text-red-600 hover:underline" disabled={busy} onClick={() => void call('DELETE', s.userId)}>
                remove
              </button>
            </span>
          ))}
        </p>
      )}
      {notice && <p className="text-red-600">{notice}</p>}
      {/* The mismatch check for the VIEWER: what they still have to connect
          before runs in their name reach anything. */}
      <ConnectorReadinessNotices items={readiness.viewer} mine who={null} isAdmin={isAdmin} />
    </div>
  );
}
