'use client';

// One load of everything the People, Aliases and Invite console sections need —
// members, aliases, the grant overview, the brain tree and open access requests
// — shared by all three, with every mutation reloading the lot. That is what
// keeps them from ever disagreeing: they are three views of one snapshot, not
// three components each fetching their own.
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
import { useConsoleAction } from '@/components/console/ConsoleSaveContext';
import { fetchJson } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings';
import { flattenTree, type CommunityMember, type PeopleData } from './shared';

interface PeopleDataValue {
  communityId: string;
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
 * The three sections share one provider, so without the reset a refusal raised
 * on Aliases would still be sitting at the top of Invite when you switched to
 * it. An error belongs to the mutation that raised it and to the section you
 * were on when it happened, so each section starts clean.
 */
export function usePeopleSection(): PeopleDataValue {
  const value = useContext(PeopleDataCtx);
  if (!value) throw new Error('usePeopleSection must be used inside <PeopleDataProvider>');
  const { setError } = value;
  useEffect(() => setError(null), [setError]);
  return value;
}

export default function PeopleDataProvider({
  communityId,
  onPendingCountChange,
  children,
}: {
  communityId: string;
  /** Feeds the console nav badge: members awaiting approval + open access requests. */
  onPendingCountChange?: (count: number) => void;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runAction = useConsoleAction();

  const reload = useCallback(async () => {
    const [membersRes, aliasesRes, overview, treeRes, settingsRes, requestsRes] = await Promise.all([
      fetchJson<{ members: CommunityMember[] }>(`/api/communities/${communityId}/members`),
      notesApi.listAliases(communityId),
      notesApi.getAccessOverview(communityId).catch(() => null),
      notesApi.tree(communityId).catch(() => null),
      notesApi.getBrainSettings(communityId).catch(() => null),
      notesApi.listAccessRequests(communityId).catch(() => null),
    ]);
    setData({
      members: membersRes.members,
      aliases: aliasesRes.aliases,
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

  // One "needs your attention" number for the whole People group: people waiting
  // to join plus members waiting on context access. Both are resolved on People.
  const pending = data
    ? data.members.filter((m) => m.status === 'pending').length +
      data.requests.filter((r) => r.status === 'pending').length
    : 0;
  useEffect(() => {
    if (data) onPendingCountChange?.(pending);
  }, [data, pending, onPendingCountChange]);

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
    () => ({ communityId, data, busy, error, setError, run }),
    [communityId, data, busy, error, run],
  );

  return <PeopleDataCtx.Provider value={value}>{children}</PeopleDataCtx.Provider>;
}
