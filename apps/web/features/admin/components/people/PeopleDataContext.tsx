'use client';

// One load of everything the Members and Types console sections need — members,
// aliases, the grant overview, the context tree and open access requests —
// shared by both, with every mutation reloading the lot. That is what keeps the
// invite link, the queues, the alias panel and the members table from ever
// disagreeing: they are views of one snapshot, not components each fetching
// their own.
//
// It also owns the single definition of "waiting" (people wanting to join plus
// members wanting context access), which the console nav renders as a badge.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useConsoleAction } from '@/features/admin/components/console/ConsoleSaveContext';
import { fetchJson } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextDisplayName } from '@/lib/notes/shared/contextSettings';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { flattenTree, type SpaceMember, type PeopleData } from './shared';

interface PeopleDataValue {
  spaceId: string;
  /** null until the first load lands. */
  data: PeopleData | null;
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** Run a mutation through the console status pill, then refresh everything. */
  run: (fn: () => Promise<unknown>) => Promise<void>;
}

const PeopleDataCtx = createContext<PeopleDataValue | null>(null);

/**
 * The shared snapshot, plus a cleared error on mount — call this from a console
 * section's top-level component.
 *
 * Both sections share one provider, so without the reset a refusal raised on
 * Members would still be sitting at the top of Types when you switched to it. An
 * error belongs to the mutation that raised it and to the section you were on
 * when it happened, so each section starts clean.
 */
export function usePeopleSection(): PeopleDataValue {
  const value = useContext(PeopleDataCtx);
  if (!value) throw new Error('usePeopleSection must be used inside <PeopleDataProvider>');
  const { setError } = value;
  useEffect(() => setError(null), [setError]);
  return value;
}

export default function PeopleDataProvider({
  spaceId,
  onPendingCountChange,
  children,
}: {
  spaceId: string;
  /** Feeds the console tab badges: members awaiting approval, and open access requests. */
  onPendingCountChange?: (counts: { members: number; requests: number }) => void;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runAction = useConsoleAction();
  // Only for the root's label: a context nobody has renamed goes by the space's
  // own name, the same way the sidebar's root folder does.
  const { currentSpace } = useSpace();
  const spaceName = currentSpace?.name ?? null;

  const reload = useCallback(async () => {
    const [membersRes, aliasesRes, overview, treeRes, settingsRes, requestsRes] = await Promise.all([
      fetchJson<{ members: SpaceMember[] }>(`/api/communities/${spaceId}/members`),
      notesApi.listAliases(spaceId),
      notesApi.getAccessOverview(spaceId).catch(() => null),
      notesApi.tree(spaceId).catch(() => null),
      notesApi.getContextSettings(spaceId).catch(() => null),
      notesApi.listAccessRequests(spaceId).catch(() => null),
    ]);
    setData({
      members: membersRes.members,
      aliases: aliasesRes.aliases,
      overview,
      paths: flattenTree(treeRes?.tree ?? null),
      tree: treeRes?.tree ?? null,
      contextName: contextDisplayName(settingsRes?.settings.contextName, spaceName),
      requests: requestsRes?.requests ?? [],
    });
  }, [spaceId, spaceName]);

  useEffect(() => {
    setData(null);
    setError(null);
    reload().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Failed to load people and access'),
    );
  }, [reload]);

  // Two "needs your attention" numbers, added into the one badge on the section
  // that resolves them both — people waiting to join, and members asking for
  // context access.
  const pendingMembers = data ? data.members.filter((m) => m.status === 'pending').length : 0;
  const pendingRequests = data ? data.requests.filter((r) => r.status === 'pending').length : 0;
  useEffect(() => {
    if (data) onPendingCountChange?.({ members: pendingMembers, requests: pendingRequests });
  }, [data, pendingMembers, pendingRequests, onPendingCountChange]);

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

  const value = useMemo(
    () => ({ spaceId, data, busy, error, setError, run }),
    [spaceId, data, busy, error, run],
  );

  return <PeopleDataCtx.Provider value={value}>{children}</PeopleDataCtx.Provider>;
}
