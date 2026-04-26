"use client";

import { useState } from "react";
import { Search, Filter, UserPlus, Upload, Download } from "lucide-react";
import { FieldDefinition } from "@/lib/schemas/crm";
import { useCrmGrid } from "../hooks/useCrmGrid";
import { AddMemberModal } from "./AddMemberModal";
import { ImportModal } from "./ImportModal";

interface GridToolbarProps {
  communityId: string;
  currentUserRole: string;
  privateFields: FieldDefinition[];
}

export function GridToolbar({
  communityId,
  currentUserRole,
  privateFields,
}: GridToolbarProps) {
  const { state, dispatch } = useCrmGrid();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");

  const isAdmin = currentUserRole === "admin";

  function applyFilter() {
    if (filterField && filterValue) {
      dispatch({ type: "SET_FILTER", payload: `${filterField}:${filterValue}` });
    } else {
      dispatch({ type: "SET_FILTER", payload: null });
    }
  }

  function clearFilter() {
    setFilterField("");
    setFilterValue("");
    dispatch({ type: "SET_FILTER", payload: null });
  }

  const exportUrl = `/api/crm/${communityId}/members/export?${new URLSearchParams({
    sort: `${state.sort.column}:${state.sort.direction}`,
    ...(state.search ? { search: state.search } : {}),
    ...(state.filter ? { filter: state.filter } : {}),
  })}`;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 sm:gap-3 border-b border-gray-200 px-3 sm:px-4 py-3"
        role="toolbar"
        aria-label="Member directory tools"
      >
        {/* Search */}
        <div className="relative flex-1 min-w-0 sm:min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={state.search}
            onChange={(e) => dispatch({ type: "SET_SEARCH", payload: e.target.value })}
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search members"
          />
        </div>

        {/* Filter by private field — hidden on small screens when no filter active */}
        {privateFields.length > 0 && (
          <div className="hidden sm:flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" aria-hidden="true" />
            <select
              value={filterField}
              onChange={(e) => setFilterField(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter field"
            >
              <option value="">Filter by...</option>
              {privateFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            {filterField && (
              <input
                type="text"
                placeholder="Value..."
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Filter value"
              />
            )}
            {filterField && (
              <button
                onClick={clearFilter}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* Export */}
          <a
            href={exportUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            aria-label="Export members as CSV"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </a>

          {isAdmin && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Import CSV</span>
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Member</span>
              </button>
            </>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddMemberModal
          communityId={communityId}
          privateFields={privateFields}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showImportModal && (
        <ImportModal
          communityId={communityId}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </>
  );
}
