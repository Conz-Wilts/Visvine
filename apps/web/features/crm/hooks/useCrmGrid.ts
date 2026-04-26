"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useState,
  Dispatch,
} from "react";
import { MemberRow } from "@/lib/crm/memberService";
import { useDebounce } from "@/hooks/useDebounce";

// ─── State ───────────────────────────────────────────────────────────────────

export interface GridState {
  members: MemberRow[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  search: string;
  filter: string | null;
  sort: { column: string; direction: "asc" | "desc" };
  overlay: Map<string, Record<string, unknown>>;
  selected: Set<string>; // user_ids selected for bulk ops
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type GridAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: { members: MemberRow[]; total: number } }
  | { type: "FETCH_ERROR"; payload: string }
  | { type: "SET_SEARCH"; payload: string }
  | { type: "SET_FILTER"; payload: string | null }
  | { type: "SET_SORT"; payload: { column: string; direction: "asc" | "desc" } }
  | { type: "SET_PAGE"; payload: number }
  | { type: "APPLY_OVERLAY"; payload: { userId: string; field: string; value: unknown } }
  | { type: "REVERT_OVERLAY"; payload: { userId: string; field: string } }
  | { type: "PREPEND_MEMBER"; payload: MemberRow }
  | { type: "REMOVE_MEMBER"; payload: string }
  | { type: "TOGGLE_SELECT"; payload: string }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "REMOVE_SELECTED"; payload: string[] };

const initialState: GridState = {
  members: [],
  total: 0,
  page: 1,
  limit: 50,
  loading: false,
  error: null,
  search: "",
  filter: null,
  sort: { column: "name", direction: "asc" },
  overlay: new Map(),
  selected: new Set(),
};

function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, loading: true, error: null };

    case "FETCH_SUCCESS":
      return {
        ...state,
        loading: false,
        members: action.payload.members,
        total: action.payload.total,
        overlay: new Map(),
        selected: new Set(),
      };

    case "FETCH_ERROR":
      return { ...state, loading: false, error: action.payload };

    case "SET_SEARCH":
      return { ...state, search: action.payload, page: 1 };

    case "SET_FILTER":
      return { ...state, filter: action.payload, page: 1 };

    case "SET_SORT":
      return { ...state, sort: action.payload, page: 1 };

    case "SET_PAGE":
      return { ...state, page: action.payload };

    case "APPLY_OVERLAY": {
      const next = new Map(state.overlay);
      const existing = next.get(action.payload.userId) ?? {};
      next.set(action.payload.userId, {
        ...existing,
        [action.payload.field]: action.payload.value,
      });
      return { ...state, overlay: next };
    }

    case "REVERT_OVERLAY": {
      const next = new Map(state.overlay);
      const existing = { ...(next.get(action.payload.userId) ?? {}) };
      delete existing[action.payload.field];
      if (Object.keys(existing).length === 0) {
        next.delete(action.payload.userId);
      } else {
        next.set(action.payload.userId, existing);
      }
      return { ...state, overlay: next };
    }

    case "PREPEND_MEMBER":
      return {
        ...state,
        members: [action.payload, ...state.members],
        total: state.total + 1,
      };

    case "REMOVE_MEMBER":
      return {
        ...state,
        members: state.members.filter((m) => m.user_id !== action.payload),
        total: state.total - 1,
      };

    case "TOGGLE_SELECT": {
      const next = new Set(state.selected);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, selected: next };
    }

    case "SELECT_ALL":
      return {
        ...state,
        selected: new Set(state.members.map((m) => m.user_id)),
      };

    case "DESELECT_ALL":
      return { ...state, selected: new Set() };

    case "REMOVE_SELECTED": {
      const removedSet = new Set(action.payload);
      return {
        ...state,
        members: state.members.filter((m) => !removedSet.has(m.user_id)),
        total: state.total - action.payload.length,
        selected: new Set(),
      };
    }

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface CrmGridContextValue {
  state: GridState;
  dispatch: Dispatch<GridAction>;
  applyOverlay: (userId: string, field: string, value: unknown) => void;
  revertOverlay: (userId: string, field: string) => void;
  refetch: () => void;
}

export const CrmGridContext = createContext<CrmGridContextValue | null>(null);

export function useCrmGrid(): CrmGridContextValue {
  const ctx = useContext(CrmGridContext);
  if (!ctx) throw new Error("useCrmGrid must be used inside CrmGridProvider");
  return ctx;
}

// ─── Provider hook (used in CrmGrid.tsx) ─────────────────────────────────────

export function useCrmGridProvider(communityId: string) {
  const [state, dispatch] = useReducer(gridReducer, initialState);
  const [fetchTick, setFetchTick] = useState(0);
  const debouncedSearch = useDebounce(state.search, 300);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatch({ type: "FETCH_START" });
      try {
        const params = new URLSearchParams({
          page: String(state.page),
          limit: String(state.limit),
          sort: `${state.sort.column}:${state.sort.direction}`,
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (state.filter) params.set("filter", state.filter);

        const res = await fetch(`/api/crm/${communityId}/members?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled)
          dispatch({ type: "FETCH_SUCCESS", payload: data });
      } catch (e) {
        if (!cancelled)
          dispatch({ type: "FETCH_ERROR", payload: String(e) });
      }
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, state.page, state.limit, debouncedSearch, state.filter, state.sort, fetchTick]);

  const applyOverlay = useCallback(
    (userId: string, field: string, value: unknown) =>
      dispatch({ type: "APPLY_OVERLAY", payload: { userId, field, value } }),
    []
  );

  const revertOverlay = useCallback(
    (userId: string, field: string) =>
      dispatch({ type: "REVERT_OVERLAY", payload: { userId, field } }),
    []
  );

  const refetch = useCallback(() => setFetchTick((t) => t + 1), []);

  return { state, dispatch, applyOverlay, revertOverlay, refetch };
}
