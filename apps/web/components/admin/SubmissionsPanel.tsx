'use client';

import { useState, useEffect, useCallback } from 'react';
import { Alert, Button, EmptyState, Input, TabNav } from '@/components/ui';
import { useConsoleAction } from '@/components/console/ConsoleSaveContext';

interface Submission {
  id: string;
  submittedBy: string;
  submitterName: string | null;
  contentType: 'node' | 'link';
  data: Record<string, unknown>;
  status: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

type FilterStatus = 'pending' | 'approved' | 'rejected';

export default function SubmissionsPanel({ communityId }: { communityId: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const runAction = useConsoleAction();

  const load = useCallback(async (status: FilterStatus) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/submissions?status=${status}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSubmissions(data.submissions);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { load(filter); }, [load, filter]);

  const handleAction = async (submissionId: string, action: 'approve' | 'reject') => {
    setActionError('');
    setActionLoading(submissionId);
    try {
      await runAction(async () => {
        const res = await fetch(`/api/communities/${communityId}/submissions/${submissionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reviewNote: reviewNote[submissionId] ?? '' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Failed to ${action}`);
        setSubmissions(prev => prev.filter(s => s.id !== submissionId));
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const renderData = (sub: Submission) => {
    if (sub.contentType === 'node') {
      const n = sub.data as { name?: string; type?: string; subtitle?: string; location?: string };
      return (
        <div>
          <div className="font-medium text-text-primary">{n.name}</div>
          <div className="text-xs text-text-muted">{n.type}{n.subtitle ? ` · ${n.subtitle}` : ''}{n.location ? ` · ${n.location}` : ''}</div>
        </div>
      );
    }
    if (sub.contentType === 'link') {
      const l = sub.data as { source?: string; target?: string; relationship?: string };
      return (
        <div className="text-xs text-text-muted">
          <span className="font-medium text-text-primary">{l.source}</span>
          <span className="mx-1 text-text-muted">→ {l.relationship} →</span>
          <span className="font-medium text-text-primary">{l.target}</span>
        </div>
      );
    }
    return <pre className="text-xs text-text-muted whitespace-pre-wrap">{JSON.stringify(sub.data, null, 2)}</pre>;
  };

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <TabNav
        tabs={[
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
        ]}
        activeTab={filter}
        onTabChange={id => setFilter(id as FilterStatus)}
      />

      {actionError && (
        <Alert variant="error" onDismiss={() => setActionError('')}>{actionError}</Alert>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-text-muted">Loading…</div>
      ) : submissions.length === 0 ? (
        <EmptyState title={`No ${filter} submissions`} />
      ) : (
        <div className="space-y-3">
          {submissions.map(sub => (
            <div key={sub.id} className="border border-border-subtle rounded-xl p-4 bg-surface-1 hover:bg-surface-2 transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      sub.contentType === 'node'
                        ? 'bg-blue-500/10 text-blue-600'
                        : 'bg-purple-500/10 text-purple-600'
                    }`}>
                      {sub.contentType}
                    </span>
                    <span className="text-xs text-text-muted">
                      by {sub.submitterName ?? sub.submittedBy} · {new Date(sub.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {renderData(sub)}
                  {sub.reviewNote && (
                    <div className="mt-2 text-xs text-text-muted italic">Note: {sub.reviewNote}</div>
                  )}
                </div>

                {filter === 'pending' && (
                  <div className="flex w-44 flex-shrink-0 flex-col gap-2">
                    <Input
                      type="text"
                      placeholder="Optional note…"
                      value={reviewNote[sub.id] ?? ''}
                      onChange={e => setReviewNote(prev => ({ ...prev, [sub.id]: e.target.value }))}
                      className="!px-2.5 !py-1.5 !text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="pill-primary"
                        onClick={() => handleAction(sub.id, 'approve')}
                        disabled={actionLoading === sub.id}
                        className="flex-1 !px-3 !py-1.5 !text-xs"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="pill-secondary"
                        onClick={() => handleAction(sub.id, 'reject')}
                        disabled={actionLoading === sub.id}
                        className="flex-1 !bg-red-500/10 !px-3 !py-1.5 !text-xs !text-red-600"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {filter !== 'pending' && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                    sub.status === 'approved'
                      ? 'bg-brand-green/15 text-brand-dark-green'
                      : 'bg-red-500/10 text-red-600'
                  }`}>
                    {sub.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
