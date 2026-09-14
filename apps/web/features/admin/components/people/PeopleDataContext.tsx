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
import { cachedFetch, contextKeys } from '@/features/notes/lib/contextPrefetch';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
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
const peopleKey = (spaceId: string) => `admin:people:${spaceId}`;

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

  // One composite read, through the shared request cache: a return to the
  // console paints the last roll at once and revalidates behind it, and the
  // tree and settings share their keys with the Directory's own prefetch. A
  // write invalidates the key first, so `reload` after an action is fresh.
  const load = useCallback(
    (onData: (next: PeopleData) => void) =>
      swrFetch(
        peopleKey(spaceId),
        async () => {
          const [membersRes, aliasesRes, overview, treeRes, settingsRes, requestsRes] = await Promise.all([
            fetchJson<{ members: SpaceMember[] }>(`/api/spaces/${spaceId}/members`),
            notesApi.listAliases(spaceId),
            notesApi.getAccessOverview(spaceId).catch(() => null),
            cachedFetch(contextKeys.tree(spaceId), () => notesApi.tree(spaceId)).catch(() => null),
            cachedFetch(contextKeys.settings(spaceId), () => notesApi.getContextSettings(spaceId)).catch(() => null),
            notesApi.listAccessRequests(spaceId).catch(() => null),
          ]);
          return {
            members: membersRes.members,
            aliases: aliasesRes.aliases,
            overview,
            paths: flattenTree(treeRes?.tree ?? null),
            tree: treeRes?.tree ?? null,
            contextName: contextDisplayName(settingsRes?.settings.contextName, spaceName),
            requests: requestsRes?.requests ?? [],
          };
        },
        onData,
      ),
    [spaceId, spaceName],
  );

  const reload = useCallback(async () => {
    invalidateRequestCache(peopleKey(spaceId), contextKeys.tree(spaceId), contextKeys.settings(spaceId));
    await load(setData);
  }, [load, spaceId]);

  useEffect(() => {
    let live = true;
    setError(null);
    load((next) => {
      if (live) setData(next);
    }).catch((e: unknown) => {
      if (live) setError(e instanceof Error ? e.message : 'Failed to load people and access');
    });
    return () => {
      live = false;
    };
  }, [load]);

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
