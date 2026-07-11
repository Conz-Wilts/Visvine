'use client';

import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from '@/components/ui';

interface LogEntry {
  id: string;
  actorEmail: string;
  actorName: string | null;
  action: string;
  actionLabel: string;
  targetEmail: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

const ACTION_ICONS: Record<string, string> = {
  member_added: '👤',
  member_removed: '🚫',
  role_changed: '🔄',
  submission_approved: '✅',
  submission_rejected: '❌',
  settings_updated: '⚙️',
};

const ACTION_COLORS: Record<string, string> = {
  member_added: 'bg-brand-green/15 text-brand-dark-green',
  member_removed: 'bg-red-500/10 text-red-600',
  role_changed: 'bg-blue-500/10 text-blue-600',
  submission_approved: 'bg-brand-green/15 text-brand-dark-green',
  submission_rejected: 'bg-orange-500/10 text-orange-600',
  settings_updated: 'bg-purple-500/10 text-purple-600',
};

function formatDetails(entry: LogEntry): string {
  const d = entry.details as Record<string, unknown>;
  if (entry.action === 'role_changed' && d.newRole) return `→ ${d.newRole}`;
  if (entry.action === 'member_added' && d.role) return `as ${d.role}`;
  if (entry.action === 'submission_approved' && d.contentType) return `(${d.contentType})`;
  if (entry.action === 'submission_rejected' && d.contentType) {
    return d.reviewNote ? `(${d.contentType}) — "${d.reviewNote}"` : `(${d.contentType})`;
  }
  if (entry.action === 'settings_updated' && Array.isArray(d.fields)) return d.fields.join(', ');
  return '';
}

export default function ActivityLogPanel({ communityId }: { communityId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/activity?limit=100`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLogs(data.logs);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-8 text-center text-sm text-text-muted">Loading…</div>;

  if (logs.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Admin actions in this community will appear here."
      />
    );
  }

  // Group by date
  const grouped: Record<string, LogEntry[]> = {};
  logs.forEach(log => {
    const date = new Date(log.createdAt).toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(log);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{logs.length} recent events</p>
        <button
          onClick={load}
          className="text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
        >
          Refresh
        </button>
      </div>

      {Object.entries(grouped).map(([date, entries]) => (
        <div key={date}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{date}</h3>
          <div className="space-y-2">
            {entries.map(log => {
              const icon = ACTION_ICONS[log.action] ?? '📋';
              const colorClass = ACTION_COLORS[log.action] ?? 'bg-surface-3 text-text-secondary';
              const extra = formatDetails(log);
              return (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-border-subtle bg-surface-1 hover:bg-surface-2 transition">
                  <span className="text-lg flex-shrink-0 mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                        {log.actionLabel}
                      </span>
                      {log.targetName && (
                        <span className="text-sm font-medium text-text-primary">{log.targetName}</span>
                      )}
                      {!log.targetName && log.targetEmail && (
                        <span className="text-sm text-text-secondary">{log.targetEmail}</span>
                      )}
                      {extra && <span className="text-xs text-text-muted">{extra}</span>}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      by {log.actorName ?? log.actorEmail} · {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
