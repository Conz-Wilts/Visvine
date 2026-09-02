'use client';

import Link from 'next/link';
import type { ConnectorReadiness } from '@/lib/connectors/service';

/**
 * Whether a person's runs of an agent would actually work.
 *
 * Every fire runs once per name on the agent's list, as that person — so a
 * `mode: user` connector spends THEIR linked account. These lines are the
 * mismatch check: the connectors this agent declares that the named person
 * still has to connect before their runs do anything. They sit under the
 * schedule and the fan-out list in the agent's sidebar.
 */

export default function ConnectorReadinessNotices({
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
            // Missing HERE, and — for the viewer's own runs — missing from
            // their settings too, since a connector they connected for
            // themselves would have resolved (lib/connectors/service.ts).
            line = (
              <>
                Uses a connector this space doesn’t have: {r.connector}
                {adminLink}
                {mine && (
                  <>
                    {' — or '}
                    <Link
                      href="/settings?connectors=1"
                      className="font-semibold text-brand-dark-green hover:underline"
                    >
                      connect it for yourself
                    </Link>
                  </>
                )}
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
