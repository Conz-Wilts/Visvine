'use client';

/**
 * The people you and this person both stand beside — their faces, then their
 * names. Drawn only when there are any: an empty overlap is silent.
 */

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { swrFetch } from '@/features/shared/lib/requestCache';
import Avatar from '@/components/ui/Avatar';
import SpaceLink from '@/features/shared/components/SpaceLink';
import type { Mutual } from '@/app/api/profile/[personId]/mutuals/route';

interface Props {
  nodeId: string;
  /** Opens the full list; the row is plain text without it. */
  onOpen?: () => void;
  accent?: string;
}

export default function MutualsRow({ nodeId, onOpen, accent }: Props) {
  const [mutuals, setMutuals] = useState<Mutual[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setMutuals([]);
    setTotal(0);
    const url = `/api/profile/${encodeURIComponent(nodeId)}/mutuals`;
    swrFetch(url, () => fetchJson<{ mutuals?: Mutual[]; total?: number }>(url), (data) => {
      if (cancelled) return;
      setMutuals(data.mutuals ?? []);
      setTotal(data.total ?? 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId]);

  if (total === 0) return null;

  // Two names, then the count of everyone else — the shape a long list keeps
  // to one line.
  const named = mutuals.slice(0, 2);
  const rest = total - named.length;

  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div className="flex -space-x-2">
        {mutuals.slice(0, 3).map((m) => (
          <span key={m.userId} className="ring-2 ring-surface rounded-lg">
            <Avatar name={m.name} imageUrl={m.imageUrl} size="sm" />
          </span>
        ))}
      </div>
      <p className="min-w-0 text-sm text-fg-muted">
        {named.map((m, i) => (
          <span key={m.userId}>
            {i > 0 && ', '}
            {m.nodeId ? (
              <SpaceLink href={`/directory/${encodeURIComponent(m.nodeId)}`}
                         className="font-semibold text-fg-secondary hover:underline">
                {m.name}
              </SpaceLink>
            ) : (
              <span className="font-semibold text-fg-secondary">{m.name}</span>
            )}
          </span>
        ))}
        {rest > 0 && (
          <>
            {named.length > 0 && ' and '}
            {onOpen ? (
              <button type="button" onClick={onOpen} className="font-semibold hover:underline"
                      style={{ color: accent }}>
                {rest} other{rest === 1 ? '' : 's'}
              </button>
            ) : (
              <span className="font-semibold text-fg-secondary">{rest} other{rest === 1 ? '' : 's'}</span>
            )}
          </>
        )}
        {' in common'}
      </p>
    </div>
  );
}
