"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { ColumnDef } from "../utils/buildColumns";
import { useCrmGrid } from "../hooks/useCrmGrid";

interface GridHeaderRowProps {
  columns: ColumnDef[];
  canManage: boolean;
}

const SORTABLE_KEYS = new Set(["name", "email", "joined_at", "role"]);

export function GridHeaderRow({ columns, canManage }: GridHeaderRowProps) {
  const { state, dispatch } = useCrmGrid();

  const allSelected =
    state.members.length > 0 &&
    state.members.every((m) => state.selected.has(m.user_id));
  const someSelected = state.selected.size > 0 && !allSelected;

  function toggleSort(key: string) {
    if (!SORTABLE_KEYS.has(key)) return;
    const direction =
      state.sort.column === key && state.sort.direction === "asc"
        ? "desc"
        : "asc";
    dispatch({ type: "SET_SORT", payload: { column: key, direction } });
  }

  return (
    <tr className="border-b border-gray-200 bg-gray-50" role="row">
      {canManage && (
        <th className="w-10 px-3 py-2" role="columnheader" scope="col">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={() =>
              allSelected
                ? dispatch({ type: "DESELECT_ALL" })
                : dispatch({ type: "SELECT_ALL" })
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            aria-label={allSelected ? "Deselect all members" : "Select all members"}
          />
        </th>
      )}
      {columns.map((col) => {
        const sortable = SORTABLE_KEYS.has(col.key);
        const active = state.sort.column === col.key;

        return (
          <th
            key={col.key}
            onClick={() => toggleSort(col.key)}
            role="columnheader"
            scope="col"
            aria-sort={
              active
                ? state.sort.direction === "asc"
                  ? "ascending"
                  : "descending"
                : sortable
                  ? "none"
                  : undefined
            }
            className={`px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide select-none ${
              sortable ? "cursor-pointer hover:text-gray-700" : ""
            }`}
          >
            <span className="inline-flex items-center gap-1">
              {col.label}
              {sortable && active && (
                state.sort.direction === "asc"
                  ? <ChevronUp className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />
              )}
            </span>
          </th>
        );
      })}
      <th className="w-8" role="columnheader" scope="col">
        <span className="sr-only">Actions</span>
      </th>
    </tr>
  );
}
