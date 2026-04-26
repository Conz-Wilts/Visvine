'use client';

import { useState, useEffect, useCallback } from 'react';

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
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});

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
    setActionLoading(submissionId);
    try {
      const res = await fetch(`/api/communities/${communityId}/submissions/${submissionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: reviewNote[submissionId] ?? '' }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setSubmissions(prev => prev.filter(s => s.id !== submissionId));
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
      <div className="flex gap-1 border-b border-border-subtle">
        {(['pending', 'approved', 'rejected'] as FilterStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
              filter === s
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-text-muted">Loading…</div>
      ) : submissions.length === 0 ? (
        <div className="py-12 text-center text-sm text-text-muted">
          No {filter} submissions
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map(sub => (
            <div key={sub.id} className="border border-border-subtle rounded-xl p-4 bg-surface-1 hover:bg-surface-2 transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      sub.contentType === 'node'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
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
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <input
                      type="text"
                      placeholder="Optional note…"
                      value={reviewNote[sub.id] ?? ''}
                      onChange={e => setReviewNote(prev => ({ ...prev, [sub.id]: e.target.value }))}
                      className="px-2 py-1 text-xs border border-border-default rounded-lg bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none w-40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(sub.id, 'approve')}
                        disabled={actionLoading === sub.id}
                        className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleAction(sub.id, 'reject')}
                        disabled={actionLoading === sub.id}
                        className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {filter !== 'pending' && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                    sub.status === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
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
