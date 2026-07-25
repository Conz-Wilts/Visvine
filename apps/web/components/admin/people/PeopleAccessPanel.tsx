'use client';

// Console → People & access: the merged successor of the old Members, Teams,
// and Context access sections. One data load (members + teams + grant overview
// + brain tree + access requests) feeds every tab, so a member's role, team
// membership, effective context permissions, and what they're still waiting on
// are always in view together — and every mutation reloads the lot, so the tabs
// can never disagree with each other.

import { useCallback, useEffect, useState } from 'react';
import { Alert, UnderlineTabs } from '@/components/ui';
import { useConsoleAction } from '@/components/console/ConsoleSaveContext';
import { fetchJson } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings';
import PeopleTab from './PeopleTab';
import TeamsTab from './TeamsTab';
import AccessTab from './AccessTab';
import RequestsTab from './RequestsTab';
import { flattenTree, type CommunityMember, type PeopleData } from './shared';

type TabId = 'people' | 'teams' | 'access' | 'requests';

interface Props {
  communityId: string;
  /** Feeds the console nav badge: members awaiting approval + open access requests. */
  onPendingCountChange?: (count: number) => void;
}

export default function PeopleAccessPanel({ communityId, onPendingCountChange }: Props) {
  const [tab, setTab] = useState<TabId>('people');
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runAction = useConsoleAction();

  const reload = useCallback(async () => {
    const [membersRes, teamsRes, overview, treeRes, settingsRes, requestsRes] = await Promise.all([
      fetchJson<{ members: CommunityMember[] }>(`/api/communities/${communityId}/members`),
      notesApi.listTeams(communityId),
      notesApi.getAccessOverview(communityId).catch(() => null),
      notesApi.tree(communityId).catch(() => null),
      notesApi.getBrainSettings(communityId).catch(() => null),
      notesApi.listAccessRequests(communityId).catch(() => null),
    ]);
    setData({
      members: membersRes.members,
      teams: teamsRes.teams,
      overview,
      paths: flattenTree(treeRes?.tree ?? null),
      tree: treeRes?.tree ?? null,
      contextName: settingsRes?.settings.contextName ?? DEFAULT_CONTEXT_NAME,
      requests: requestsRes?.requests ?? [],
    });
  }, [communityId]);

  useEffect(() => {
    setData(null);
    setError(null);
    reload().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Failed to load people and access'),
    );
  }, [reload]);

  // One "needs your attention" number for the whole section: people waiting to
  // join plus members waiting on context access.
  const pendingRequests = data ? data.requests.filter((r) => r.status === 'pending').length : 0;
  useEffect(() => {
    if (data) {
      onPendingCountChange?.(
        data.members.filter((m) => m.status === 'pending').length + pendingRequests,
      );
    }
  }, [data, pendingRequests, onPendingCountChange]);

  /** Run a mutation through the console status pill, then refresh everything. */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await runAction(async () => {
          await fn();
          await reload();
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setBusy(false);
      }
    },
    [runAction, reload],
  );

  return (
    <div className="space-y-6">
      <UnderlineTabs<TabId>
        tabs={[
          { id: 'people', label: 'Members' },
          { id: 'teams', label: 'Teams' },
          { id: 'access', label: 'Context access' },
          { id: 'requests', label: pendingRequests > 0 ? `Requests (${pendingRequests})` : 'Requests' },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="People and access sections"
      />

      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {data === null ? (
        <p className="text-sm text-text-muted">Loading people and access…</p>
      ) : tab === 'people' ? (
        <PeopleTab communityId={communityId} data={data} busy={busy} run={run} />
      ) : tab === 'teams' ? (
        <TeamsTab communityId={communityId} data={data} busy={busy} run={run} />
      ) : tab === 'access' ? (
        <AccessTab communityId={communityId} data={data} busy={busy} run={run} reload={reload} />
      ) : (
        <RequestsTab communityId={communityId} data={data} busy={busy} run={run} />
      )}
    </div>
  );
}
