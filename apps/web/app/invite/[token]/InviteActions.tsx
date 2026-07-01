'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Join button for the invite landing page. Posts the token to
 * /api/communities/join-via-invite, which records a pending membership. Already-
 * active members are sent straight into the community.
 */
export default function InviteActions({
  token,
  communityId,
  initialStatus,
}: {
  token: string;
  communityId: string;
  initialStatus: 'active' | 'pending' | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'active' | 'pending' | null>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'active') {
    return (
      <button
        onClick={() => router.push(`/directory?community=${encodeURIComponent(communityId)}`)}
        className="mt-6 w-full rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white"
      >
        Open community
      </button>
    );
  }

  if (status === 'pending') {
    return (
      <p className="mt-6 rounded-lg bg-surface-2 px-4 py-3 text-sm text-text-muted">
        Your request to join has been sent. An admin will approve you shortly.
      </p>
    );
  }

  const requestJoin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/communities/join-via-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not join');
      setStatus(body.status === 'active' ? 'active' : 'pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 w-full">
      <button
        onClick={requestJoin}
        disabled={loading}
        className="w-full rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {loading ? 'Requesting…' : 'Request to join'}
      </button>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
