'use client';

import Link from 'next/link';
import type { AgentNeeds as Needs } from '@/lib/agents/shared/needs';

/**
 * What stands between this agent and a working run, for the person reading.
 *
 * One line per need: why, then the fix as a link where there is somewhere to
 * go — the sign-in, the console's Connectors section — and the brief's own
 * settings for a service the instructions name that the brief never declared.
 * A need only an admin can meet says so to a member, so they know they are
 * waiting rather than missing a step. The judgement is the server's
 * (lib/agents/shared/needs.ts), the same one create_agent and rehearse_agent
 * hand an MCP client, so the page and the tool never disagree about what is
 * missing.
 */
export default function AgentNeeds({
  needs,
  isAdmin,
  onEditSettings,
}: {
  needs: Needs;
  isAdmin: boolean;
  onEditSettings: () => void;
}) {
  if (needs.needs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-[13px] text-amber-700">
      {needs.needs.map((n) => {
        const canFix = n.who === 'member' || isAdmin;
        let fix: React.ReactNode;
        if (!canFix) {
          fix = <span className="text-text-muted"> — a space admin sets this up</span>;
        } else if (n.status === 'undeclared') {
          fix = (
            <>
              {' — '}
              <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={onEditSettings}>
                add it to the brief
              </button>
            </>
          );
        } else if (n.href) {
          const label = n.status === 'needs_connection' ? 'sign in' : n.status === 'broken' ? 'sign in again' : 'open Connectors';
          const external = /^https?:/.test(n.href);
          fix = (
            <>
              {' — '}
              {external ? (
                <a href={n.href} className="font-semibold text-brand-dark-green hover:underline">
                  {label}
                </a>
              ) : (
                <Link href={n.href} className="font-semibold text-brand-dark-green hover:underline">
                  {label}
                </Link>
              )}
            </>
          );
        } else {
          fix = <span className="text-text-muted"> — {n.fix}</span>;
        }
        return (
          <li key={`${n.status}:${n.need}`} title={n.fix}>
            {n.why}
            {fix}
          </li>
        );
      })}
    </ul>
  );
}
