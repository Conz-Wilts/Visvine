"use client";

import { useRef, useCallback, KeyboardEvent } from "react";
import { ColumnDef } from "../utils/buildColumns";
import { GridHeaderRow } from "./GridHeaderRow";
import { GridRow } from "./GridRow";
import { useCrmGrid } from "../hooks/useCrmGrid";
import { Users, Upload } from "lucide-react";
import { Skeleton } from "@/components/ui";

interface GridTableProps {
  columns: ColumnDef[];
  communityId: string;
  canManage: boolean;
}

function GridSkeleton({ columns }: { columns: ColumnDef[] }) {
  const colCount = Math.max(4, columns.length);
  return (
    <div className="overflow-x-auto" role="status" aria-label="Loading members">
      <table className="min-w-full table-auto">
        <thead>
          <tr className="border-b border-gray-200">
            {Array.from({ length: colCount }).map((_, i) => (
              <th key={i} className="px-4 py-3 text-left">
                <Skeleton className="h-3 w-20 bg-gray-200" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-gray-100">
              <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full bg-gray-200" />
                  <Skeleton className="h-3.5 w-32 bg-gray-200" />
                </div>
              </td>
              {Array.from({ length: colCount - 1 }).map((_, i) => (
                <td key={i} className="px-4 py-4">
                  <Skeleton className="h-3 w-24 bg-gray-200" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GridTable({ columns, communityId, canManage }: GridTableProps) {
  const { state, dispatch } = useCrmGrid();
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableSectionElement>) => {
      const target = e.target as HTMLElement;
      const row = target.closest("tr");
      if (!row) return;

      let next: Element | null = null;
      if (e.key === "ArrowDown") {
        next = row.nextElementSibling;
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        next = row.previousElementSibling;
        e.preventDefault();
      }
      if (next instanceof HTMLElement) {
        next.focus();
      }
    },
    []
  );

  if (state.loading && state.members.length === 0) {
    return <GridSkeleton columns={columns} />;
  }

  if (state.error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-red-500" role="alert">
        {state.error}
      </div>
    );
  }

  // Empty state with helpful prompt
  if (!state.loading && state.members.length === 0) {
    const hasActiveFilters = state.search || state.filter;
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-3" role="status">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <Users className="h-7 w-7 text-gray-400" />
        </div>
        {hasActiveFilters ? (
          <>
            <p className="text-sm font-medium text-gray-700">No members match your filters</p>
            <p className="text-xs text-gray-400 text-center max-w-sm">
              Try adjusting your search or removing filters to see more results.
            </p>
            <button
              onClick={() => {
                dispatch({ type: "SET_SEARCH", payload: "" });
                dispatch({ type: "SET_FILTER", payload: null });
              }}
              className="mt-1 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Clear all filters
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">No members yet</p>
            <p className="text-xs text-gray-400 text-center max-w-sm">
              Get started by adding members manually or importing a CSV file
              with your contacts.
            </p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Upload className="h-3.5 w-3.5" />
                Use the &quot;Import CSV&quot; button above
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table
        className="min-w-full table-auto"
        role="grid"
        aria-label="Community member directory"
        aria-rowcount={state.total}
      >
        <thead>
          <GridHeaderRow columns={columns} canManage={canManage} />
        </thead>
        <tbody
          ref={tbodyRef}
          onKeyDown={handleKeyDown}
          role="rowgroup"
        >
          {state.members.map((member, index) => (
            <GridRow
              key={member.user_id}
              member={member}
              columns={columns}
              communityId={communityId}
              canManage={canManage}
              rowIndex={index + 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
