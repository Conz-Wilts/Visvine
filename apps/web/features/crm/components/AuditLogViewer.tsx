"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  actor: { id: string; name: string; email: string };
  target: { id: string; name: string; email: string } | null;
  diff: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogViewerProps {
  communityId: string;
}

const ACTION_LABELS: Record<string, string> = {
  create_shadow: "Created shadow profile",
  csv_import: "Imported CSV",
  claim_profile: "Claimed profile",
  edit_public: "Edited public field",
  edit_private: "Edited private field",
  remove_member: "Removed member",
  change_role: "Changed role",
  bulk_edit_private: "Bulk edited field",
  bulk_change_role: "Bulk changed roles",
  bulk_remove: "Bulk removed members",
};

export function AuditLogViewer({ communityId }: AuditLogViewerProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchLog = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    const res = await fetch(`/api/crm/${communityId}/audit?${params}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries);
      setTotal(data.total);
    }
    setLoading(false);
  }, [communityId, page]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderDiff(diff: Record<string, unknown> | null) {
    if (!diff) return null;
    // For bulk actions, show summary
    if ("affected" in diff) {
      return (
        <span className="text-xs text-gray-400">
          {diff.affected as number} member{(diff.affected as number) !== 1 ? "s" : ""}
          {diff.field ? ` — ${diff.field}: ${String(diff.value)}` : ""}
          {diff.role ? ` — role: ${String(diff.role)}` : ""}
        </span>
      );
    }
    // For field edits, show before/after
    if ("before" in diff && "after" in diff) {
      const before = diff.before as Record<string, unknown>;
      const after = diff.after as Record<string, unknown>;
      const keys = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ];
      return (
        <span className="text-xs text-gray-400">
          {keys
            .map(
              (k) =>
                `${k}: ${String(before[k] ?? "—")} → ${String(after[k] ?? "—")}`
            )
            .join(", ")}
        </span>
      );
    }
    // For imports, show summary
    if ("summary" in diff) {
      const s = diff.summary as Record<string, number>;
      return (
        <span className="text-xs text-gray-400">
          {s.total} rows — {s.created} created, {s.errors ?? 0} errors
        </span>
      );
    }
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <History className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700">Audit Log</h3>
        <span className="text-xs text-gray-400 ml-auto">{total} entries</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-gray-400 animate-pulse">
          Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-sm text-gray-500">No audit log entries yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <div key={entry.id} className="px-4 py-3 flex flex-col gap-0.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">
                  {entry.actor.name}
                </span>
                <span className="text-gray-500">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                </span>
                {entry.target && entry.target.id !== entry.actor.id && (
                  <span className="text-gray-600">
                    → {entry.target.name}
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                  {formatDate(entry.created_at)}
                </span>
              </div>
              {renderDiff(entry.diff)}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded p-1 hover:bg-gray-100 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
