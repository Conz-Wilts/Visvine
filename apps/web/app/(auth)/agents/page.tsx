'use client';

import { useCallback, useEffect, useState } from 'react';
import { } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { Skeleton, Alert } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';
import AgentsRoster from '@/features/agents/components/AgentsRoster';
import ModelKeysCard, { type ProviderInfo } from '@/features/agents/components/ModelKeysCard';
import { DELAYED_AFTER_MS } from '@/lib/agents/limits';

/**
 * The Agents tool: the roster of every agents/<name>.md brief in the space
 * with its activation, last run and next run; admins additionally see spend
 * and manage the space's model keys. Clicking an agent opens its node page
 * (brief, activation, runs). Sits beside /connectors as a plain page — the
 * pane shell belongs to /directory/*.
 */
interface RosterResponse {
  agents: AgentSummary[];
  heartbeatAt: string | null;
  isAdmin: boolean;
  currentUserId: string;
  spaceTimezone: string | null;
  providers: ProviderInfo[];
  modelKeys: { name: string; updatedAt: string }[];
}

export default function AgentsPage() {
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'ok' | 'warn' | 'bad' } | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await fetchJson<RosterResponse>(`/api/communities/${spaceId}/agents`);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load agents');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
    // A live roster: running / due states change on their own.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [spaceId, spaceLoading, load]);

  const schedulerDelayed =
    !!data &&
    data.agents.some((a) => a.activation.active) &&
    (data.heartbeatAt === null || Date.now() - new Date(data.heartbeatAt).getTime() > DELAYED_AFTER_MS);

  const body = () => {
    if (spaceLoading || loading || !data) {
      return (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      );
    }
    if (error) {
      return <Alert>{error}</Alert>;
    }
    return (
      <div className="flex flex-col gap-8">
        {schedulerDelayed && (
          <Alert variant="warning">
            The scheduler hasn&apos;t ticked{data.heartbeatAt ? ` since ${new Date(data.heartbeatAt).toLocaleString()}` : ' yet'} — active agents will not fire
            until it does. (In production this is the Cloud Scheduler job; in dev, POST /api/internal/agents/tick.)
          </Alert>
        )}
        {notice && (
          <Alert inline variant={notice.tone === 'ok' ? 'success' : notice.tone === 'warn' ? 'warning' : 'error'}>
            {notice.message}
          </Alert>
        )}
        <AgentsRoster
          spaceId={spaceId!}
          agents={data.agents}
          isAdmin={data.isAdmin}
          currentUserId={data.currentUserId}
          spaceTimezone={data.spaceTimezone}
          onChanged={load}
          onNotice={(message, tone) => setNotice({ message, tone })}
        />
        {data.isAdmin && <ModelKeysCard spaceId={spaceId!} providers={data.providers} stored={data.modelKeys} onChanged={load} />}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl pt-6 pb-16">
      <div className="mt-4">{body()}</div>
    </div>
  );
}
