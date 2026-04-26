"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCrmGrid } from "../hooks/useCrmGrid";

export function GridPagination() {
  const { state, dispatch } = useCrmGrid();
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));

  if (totalPages <= 1 && state.total === 0) return null;

  return (
    <nav
      className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-gray-200 px-4 py-3"
      aria-label="Member list pagination"
    >
      <p className="text-sm text-gray-500" aria-live="polite">
        Showing{" "}
        <span className="font-medium">
          {Math.min((state.page - 1) * state.limit + 1, state.total)}–
          {Math.min(state.page * state.limit, state.total)}
        </span>{" "}
        of <span className="font-medium">{state.total}</span>
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => dispatch({ type: "SET_PAGE", payload: state.page - 1 })}
          disabled={state.page <= 1 || state.loading}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <span className="px-3 text-sm text-gray-700" aria-current="page">
          {state.page} / {totalPages}
        </span>

        <button
          onClick={() => dispatch({ type: "SET_PAGE", payload: state.page + 1 })}
          disabled={state.page >= totalPages || state.loading}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
