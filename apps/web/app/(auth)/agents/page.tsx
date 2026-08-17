'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { PageTitle, Skeleton } from '@/components/ui';
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
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      );
    }
    if (error) {
      return <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>;
    }
    return (
      <div className="flex flex-col gap-4">
        {schedulerDelayed && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              The scheduler hasn&apos;t ticked{data.heartbeatAt ? ` since ${new Date(data.heartbeatAt).toLocaleString()}` : ' yet'} — active agents will not fire
              until it does. (In production this is the Cloud Scheduler job; in dev, POST /api/internal/agents/tick.)
            </p>
          </div>
        )}
        {notice && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-[13px] ${
              notice.tone === 'ok' ? 'bg-brand-light-bg text-brand-dark-green' : notice.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.message}
          </div>
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
    <div className="mx-auto w-full max-w-5xl pb-16">
      <PageTitle title="Agents" />
      <div className="mt-4">{body()}</div>
    </div>
  );
}
