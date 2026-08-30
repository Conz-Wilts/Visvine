'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, EmptyState, SettingsSection, Skeleton } from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useCreateSurface } from '@/features/shared/contexts/CreateModalContext';
import { agentPageHref } from '@/lib/agents/config';
import type { AgentSummary } from '@/lib/agents/service';
import { setupBlocker, statusLine } from '../lib/rowState';
import ActivateAgentDialog from './ActivateAgentDialog';
import StatusDot from './StatusDot';

/**
 * Agents, as a console section — the roster, and the switch.
 *
 * It exists because activation is an ADMIN act and had no admin surface. An
 * agent's own page has always carried Turn on, but you had to already know the
 * agent was there to reach it, and nothing in the console said agents existed
 * at all. So the one act only an admin can perform lived at an address only
 * somebody who had found the agent could visit. This is that address.
 *
 * The two-note split (lib/agents/config) is what the section is shaped around,
 * because it is the thing people get wrong: a brief is written by any member
 * and does NOTHING, and an admin turning it on is a separate, reviewed act.
 * Hence two groups rather than one sorted list — "waiting to be turned on" is
 * a queue with something to do about it, the way Tool review is, and burying
 * those rows among the running ones would hide the only work this page asks
 * for.
 *
 * Everything else about an agent — its brief, its runs, its spend, its skills
 * — stays on the agent's own page. A row links there rather than reproducing
 * it: the note is the agent, and this is a list.
 */
export interface AgentRoster {
  agents: AgentSummary[] | null;
  /** Briefs with no activation — what the console's badge counts. */
  waiting: number;
  error: string | null;
  reload: () => void;
}

/**
 * The roster, loaded once for both the section and the badge that counts what
 * is waiting — the same arrangement Tool review uses, so "waiting" has one
 * definition rather than one per component.
 */
export function useAgentRoster(spaceId: string | null): AgentRoster {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!spaceId) {
      setAgents(null);
      return;
    }
    let live = true;
    fetchJson<{ agents: AgentSummary[] }>(`/api/communities/${spaceId}/agents`)
      .then((data) => {
        if (!live) return;
        setAgents(data.agents);
        setError(null);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        setAgents([]);
      });
    return () => {
      live = false;
    };
  }, [spaceId, nonce]);

  return {
    agents,
    waiting: agents?.filter((a) => !a.activation.active).length ?? 0,
    error,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

export default function AgentsPanel({ roster }: { roster: AgentRoster }) {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const openCreate = useCreateSurface();
  const { agents, reload } = roster;

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [activating, setActivating] = useState<AgentSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const turnOff = useCallback(
    async (name: string) => {
      if (!spaceId) return;
      setBusy(name);
      try {
        await fetchJsonBody(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}`, 'PATCH', {
          active: false,
        });
        setWarning(null);
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not turn it off.');
      } finally {
        setBusy(null);
      }
    },
    [spaceId, reload],
  );

  if (!spaceId) return null;
  if (agents === null) return <Skeleton className="h-32 w-full" />;
  const loadError = error ?? roster.error;

  const live = agents.filter((a) => a.activation.active);
  const off = agents.filter((a) => !a.activation.active);

  const row = (a: AgentSummary) => {
    const status = statusLine(a);
    // The same blocker the agent's own page shows, so an admin is never offered
    // a switch that will refuse them: a brief that does not parse, or a model
    // with no key stored, cannot be activated whatever they click.
    const blocker = a.activation.active ? null : setupBlocker(a, true);
    return (
      <li key={a.path} className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
        <StatusDot tone={status.tone} />
        <div className="min-w-0 flex-1">
          <Link
            href={agentPageHref(a.name)}
            className="text-sm font-medium text-text-primary hover:text-brand-dark-green hover:underline"
          >
            {a.title}
          </Link>
          <p className={`truncate text-xs ${status.problem ? 'text-amber-700' : 'text-text-muted'}`}>
            {blocker ? blocker.text : status.text}
          </p>
        </div>
        <p className="hidden shrink-0 font-mono text-[11px] text-text-muted sm:block">
          {[a.model, ...a.connectors, ...a.tools].filter(Boolean).join(' · ')}
        </p>
        {a.activation.active ? (
          <Button variant="neutral" size="sm" disabled={busy === a.name} onClick={() => void turnOff(a.name)}>
            Turn off
          </Button>
        ) : (
          <Button variant="brand" size="sm" disabled={!!blocker || !!a.invalid} onClick={() => setActivating(a)}>
            Turn on
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {loadError && <Alert>{loadError}</Alert>}
      {warning && <Alert>{warning}</Alert>}

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="An agent is a brief — what to do on every run — that you then turn on with a schedule. Anyone in the space can write one; only an admin turns it on."
          action={{ label: 'Write an agent', onClick: () => openCreate('agent') }}
          actionStyle="solid"
        />
      ) : (
        <>
          <SettingsSection
            title="Waiting to be turned on"
            description="These have a brief but no schedule, so they never run. Turning one on is the review point — read its brief first."
            action={
              <Button variant="neutral" size="sm" onClick={() => openCreate('agent')}>
                New agent
              </Button>
            }
          >
            {off.length === 0 ? (
              <p className="text-xs text-text-muted">Nothing waiting.</p>
            ) : (
              <ul className="border-t border-border-subtle">{off.map(row)}</ul>
            )}
          </SettingsSection>

          <SettingsSection
            title="Running"
            description="On a schedule or a trigger, spending the space's model key on every run."
          >
            {live.length === 0 ? (
              <p className="text-xs text-text-muted">No agent is turned on.</p>
            ) : (
              <ul className="border-t border-border-subtle">{live.map(row)}</ul>
            )}
          </SettingsSection>
        </>
      )}

      {activating && (
        <ActivateAgentDialog
          spaceId={spaceId}
          agent={activating}
          onClose={() => setActivating(null)}
          onDone={(w) => {
            setActivating(null);
            setWarning(w);
            reload();
          }}
        />
      )}
    </div>
  );
}
