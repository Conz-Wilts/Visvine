'use client';

import { useState } from 'react';
import type { SuggestionItem } from '@/lib/identity/steward';

/**
 * Admin review queue for cross-community identity dedup. Each row is a possible
 * match the resolver flagged but did NOT auto-merge (same name, weak corroboration).
 * The steward decides: "Same person" folds the node's identity into the candidate;
 * "Different" records an anti-match so it's never suggested again.
 */
export default function IdentityReviewTable({ initial }: { initial: SuggestionItem[] }) {
  const [items, setItems] = useState<SuggestionItem[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keyOf = (s: SuggestionItem) => `${s.nodeId}|${s.candidateIdentityId}`;

  async function act(s: SuggestionItem, action: 'merge' | 'reject') {
    setError(null);
    setBusy(keyOf(s));
    try {
      const body =
        action === 'merge'
          ? { action, nodeId: s.nodeId, targetIdentityId: s.candidateIdentityId }
          : { action, nodeId: s.nodeId, identityId: s.candidateIdentityId };
      const res = await fetch('/api/identities/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Action failed');
      }
      setItems((prev) => prev.filter((x) => keyOf(x) !== keyOf(s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
        No possible duplicates to review. 🎉
      </p>
    );
  }

  return (
    <div className="mt-12">
      <p className="mb-4 text-sm text-neutral-500">
        {items.length} possible {items.length === 1 ? 'duplicate' : 'duplicates'} to review
      </p>
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      <div className="space-y-3">
        {items.map((s) => {
          const k = keyOf(s);
          const isBusy = busy === k;
          return (
            <div
              key={k}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-black">{s.nodeName}</span>
                  {s.nodeCommunityName && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                      {s.nodeCommunityName}
                    </span>
                  )}
                  <span className="text-neutral-400">↔</span>
                  <span className="font-medium text-black">{s.candidateName}</span>
                  {s.candidateCommunities.map((c) => (
                    <span key={c} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                      {c}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  {s.reason} · {(s.confidence * 100).toFixed(0)}% confidence
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => act(s, 'merge')}
                  className="rounded-full bg-black px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  Same person
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => act(s, 'reject')}
                  className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
                >
                  Different
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
