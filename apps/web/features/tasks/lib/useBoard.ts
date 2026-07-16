'use client';

// Board state for the Tasks page: one fetch of the whole board, refetched on
// focus/visibility and a light interval (no SSE — matches the repo's
// request/response convention), with optimistic mutations that snapshot state
// and roll back on API failure. Plain React state — the app has no SWR/query
// library by design.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import type { BoardResponse, ColumnDTO, TaskDTO, TaskDraft } from './types';

const POLL_MS = 25_000;

interface BoardState {
  columns: ColumnDTO[];
  tasks: TaskDTO[];
}

export interface UseBoardResult {
  board: BoardState | null;
  members: BoardResponse['members'];
  loading: boolean;
  error: string | null;
  clearError: () => void;
  /** Local-only update, used by drag handlers mid-drag. */
  setBoard: React.Dispatch<React.SetStateAction<BoardState | null>>;
  /** Snapshot for drag rollback. */
  snapshot: () => BoardState | null;
  /** Restore a snapshot (drag rollback). */
  restore: (s: BoardState | null) => void;
  /** While true, poll/focus refetches are skipped (drag in progress). */
  setDragging: (dragging: boolean) => void;
  refetch: () => Promise<void>;
  createTask: (columnId: string, draft: TaskDraft) => Promise<void>;
  updateTask: (taskId: string, draft: TaskDraft) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  /** Persist a drop already applied locally; rolls back to `prev` on failure. */
  commitMove: (
    taskId: string,
    columnId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null,
    prev: BoardState | null,
  ) => Promise<void>;
  createColumn: (name: string, color: string) => Promise<void>;
  updateColumn: (columnId: string, patch: { name?: string; color?: string }) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
  /** Persist a column order already applied locally; rolls back on failure. */
  commitColumnOrder: (orderedIds: string[], prev: BoardState | null) => Promise<void>;
}

export function useBoard(communityId: string | null): UseBoardResult {
  const [board, setBoardState] = useState<BoardState | null>(null);
  const [members, setMembers] = useState<BoardResponse['members']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const draggingRef = useRef(false);
  const boardRef = useRef<BoardState | null>(null);
  boardRef.current = board;

  const base = communityId ? `/api/communities/${communityId}/tasks` : null;

  const refetch = useCallback(async () => {
    if (!base || draggingRef.current) return;
    try {
      const data = await fetchJson<BoardResponse>(`${base}/board`);
      // A slow response landing mid-drag would yank the lifted card.
      if (draggingRef.current) return;
      setBoardState({ columns: data.columns, tasks: data.tasks });
      setMembers(data.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    setBoardState(null);
    setMembers([]);
    setLoading(true);
    setError(null);
    if (!base) return;
    void refetch();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refetch();
    }, POLL_MS);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [base, refetch]);

  /**
   * Optimistic wrapper: applies `apply` to current state, runs the request,
   * and restores the pre-apply snapshot on failure. `reconcile` (optional)
   * folds the server response back in on success.
   */
  const mutate = useCallback(
    async <T>(
      apply: (s: BoardState) => BoardState,
      request: () => Promise<T>,
      reconcile?: (s: BoardState, result: T) => BoardState,
    ) => {
      const prev = boardRef.current;
      if (prev) setBoardState(apply(prev));
      try {
        const result = await request();
        if (reconcile) {
          setBoardState((s) => (s ? reconcile(s, result) : s));
        }
      } catch (err) {
        setBoardState(prev);
        setError(err instanceof Error ? err.message : 'Request failed');
        throw err;
      }
    },
    [],
  );

  const draftBody = (draft: TaskDraft) => ({
    title: draft.title,
    description: draft.description,
    assigneeId: draft.assigneeId,
    dueDate: draft.dueDate,
    labels: draft.labels,
  });

  const createTask = useCallback(
    async (columnId: string, draft: TaskDraft) => {
      if (!base) return;
      // No optimistic insert — the server assigns id/position; one round-trip
      // then splice the task in.
      const { task } = await fetchJsonBody<{ task: TaskDTO }>(`${base}`, 'POST', {
        columnId,
        ...draftBody(draft),
      }).catch((err) => {
        setError(err instanceof Error ? err.message : 'Request failed');
        throw err;
      });
      setBoardState((s) => (s ? { ...s, tasks: [...s.tasks, task] } : s));
    },
    [base],
  );

  const updateTask = useCallback(
    async (taskId: string, draft: TaskDraft) => {
      if (!base) return;
      await mutate(
        (s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...draftBody(draft) } : t)),
        }),
        () => fetchJsonBody<{ task: TaskDTO }>(`${base}/${taskId}`, 'PATCH', draftBody(draft)),
        (s, { task }) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? task : t)) }),
      );
    },
    [base, mutate],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (!base) return;
      await mutate(
        (s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }),
        () => fetchJsonBody(`${base}/${taskId}`, 'DELETE', {}),
      );
    },
    [base, mutate],
  );

  const commitMove = useCallback(
    async (
      taskId: string,
      columnId: string,
      beforeTaskId: string | null,
      afterTaskId: string | null,
      prev: BoardState | null,
    ) => {
      if (!base) return;
      try {
        const { task } = await fetchJsonBody<{ task: TaskDTO }>(`${base}/${taskId}/move`, 'POST', {
          columnId,
          beforeTaskId,
          afterTaskId,
        });
        setBoardState((s) =>
          s ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? task : t)) } : s,
        );
      } catch (err) {
        setBoardState(prev);
        setError(err instanceof Error ? err.message : 'Move failed');
        // Positions may genuinely be stale (someone else moved cards) — resync.
        void refetch();
      }
    },
    [base, refetch],
  );

  const createColumn = useCallback(
    async (name: string, color: string) => {
      if (!base) return;
      const { column } = await fetchJsonBody<{ column: ColumnDTO }>(`${base}/columns`, 'POST', {
        name,
        color,
      }).catch((err) => {
        setError(err instanceof Error ? err.message : 'Request failed');
        throw err;
      });
      setBoardState((s) => (s ? { ...s, columns: [...s.columns, column] } : s));
    },
    [base],
  );

  const updateColumn = useCallback(
    async (columnId: string, patch: { name?: string; color?: string }) => {
      if (!base) return;
      await mutate(
        (s) => ({
          ...s,
          columns: s.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
        }),
        () => fetchJsonBody<{ column: ColumnDTO }>(`${base}/columns/${columnId}`, 'PATCH', patch),
      );
    },
    [base, mutate],
  );

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (!base) return;
      await mutate(
        (s) => ({
          columns: s.columns.filter((c) => c.id !== columnId),
          tasks: s.tasks.filter((t) => t.columnId !== columnId),
        }),
        () => fetchJsonBody(`${base}/columns/${columnId}`, 'DELETE', {}),
      );
    },
    [base, mutate],
  );

  const commitColumnOrder = useCallback(
    async (orderedIds: string[], prev: BoardState | null) => {
      if (!base) return;
      try {
        const { columns } = await fetchJsonBody<{ columns: ColumnDTO[] }>(
          `${base}/columns/reorder`,
          'PUT',
          { orderedIds },
        );
        setBoardState((s) => (s ? { ...s, columns } : s));
      } catch (err) {
        setBoardState(prev);
        setError(err instanceof Error ? err.message : 'Reorder failed');
      }
    },
    [base],
  );

  return {
    board,
    members,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    setBoard: setBoardState,
    snapshot: useCallback(() => {
      const s = boardRef.current;
      return s ? { columns: [...s.columns], tasks: [...s.tasks] } : null;
    }, []),
    restore: useCallback((s: BoardState | null) => setBoardState(s), []),
    setDragging: useCallback((dragging: boolean) => {
      draggingRef.current = dragging;
    }, []),
    refetch,
    createTask,
    updateTask,
    deleteTask,
    commitMove,
    createColumn,
    updateColumn,
    deleteColumn,
    commitColumnOrder,
  };
}
