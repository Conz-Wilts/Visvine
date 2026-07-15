'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJsonBody } from '@/lib/fetchJson';

/**
 * Join button for the invite landing page. Posts the token to
 * /api/communities/join-via-invite, which records a pending membership. Already-
 * active members are sent straight into the community.
 */
export default function InviteActions({
  token,
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
        onClick={() => router.push('/home')}
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
      const body = await fetchJsonBody<{ status?: string } | null>('/api/communities/join-via-invite', 'POST', { token });
      setStatus(body?.status === 'active' ? 'active' : 'pending');
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
