"use client";

import { useState } from "react";
import { X, Tag, Shield, Trash2 } from "lucide-react";
import { FieldDefinition } from "@/lib/schemas/crm";
import { useCrmGrid } from "../hooks/useCrmGrid";

interface BulkActionsBarProps {
  communityId: string;
  privateFields: FieldDefinition[];
}

export function BulkActionsBar({
  communityId,
  privateFields,
}: BulkActionsBarProps) {
  const { state, dispatch, refetch } = useCrmGrid();
  const [loading, setLoading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const count = state.selected.size;
  if (count === 0) return null;

  const selectedIds = [...state.selected];

  async function bulkAction(body: Record<string, unknown>) {
    setLoading(true);
    const res = await fetch(`/api/crm/${communityId}/members/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: selectedIds, ...body }),
    });
    setLoading(false);
    if (res.ok) {
      refetch();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.message ?? data.error ?? "Bulk action failed.");
    }
    setShowTagPicker(false);
    setShowRolePicker(false);
    setConfirmRemove(false);
  }

  // Find select-type private fields for bulk tagging
  const selectFields = privateFields.filter(
    (f) => f.type === "select" && f.options && f.options.length > 0
  );

  return (
    <div
      className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2.5 text-sm"
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="font-medium text-blue-700">
        {count} selected
      </span>

      <button
        onClick={() => dispatch({ type: "DESELECT_ALL" })}
        className="rounded p-1 text-blue-500 hover:bg-blue-100"
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="mx-1 h-4 w-px bg-blue-200" />

      {/* Bulk tag */}
      {selectFields.length > 0 && (
        <div className="relative">
          <button
            onClick={() => { setShowTagPicker(!showTagPicker); setShowRolePicker(false); setConfirmRemove(false); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            <Tag className="h-3.5 w-3.5" />
            Set field
          </button>
          {showTagPicker && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {selectFields.map((field) => (
                <div key={field.key} className="px-3 py-1.5">
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    {field.label}
                  </p>
                  {field.options!.map((opt) => (
                    <button
                      key={opt}
                      onClick={() =>
                        bulkAction({
                          action: "update_private",
                          field: field.key,
                          value: opt,
                        })
                      }
                      className="block w-full px-2 py-1 text-left text-sm text-gray-700 rounded hover:bg-gray-100"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk role change */}
      <div className="relative">
        <button
          onClick={() => { setShowRolePicker(!showRolePicker); setShowTagPicker(false); setConfirmRemove(false); }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          <Shield className="h-3.5 w-3.5" />
          Change role
        </button>
        {showRolePicker && (
          <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {(["admin", "moderator", "member"] as const).map((role) => (
              <button
                key={role}
                onClick={() => bulkAction({ action: "change_role", role })}
                className="block w-full px-4 py-2 text-left text-sm capitalize text-gray-700 hover:bg-gray-100"
              >
                {role}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk remove */}
      <div className="relative">
        {!confirmRemove ? (
          <button
            onClick={() => { setConfirmRemove(true); setShowTagPicker(false); setShowRolePicker(false); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600">
              Remove {count} member{count !== 1 ? "s" : ""}?
            </span>
            <button
              onClick={() =>
                bulkAction({ action: "remove" }).then(() =>
                  dispatch({ type: "REMOVE_SELECTED", payload: selectedIds })
                )
              }
              disabled={loading}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {loading && (
        <span className="text-xs text-blue-500 animate-pulse ml-auto">
          Processing...
        </span>
      )}
    </div>
  );
}
