'use client';

/** Everyone you and this person both stand beside, one row each. */

import { useEffect, useState } from 'react';
import { Modal, Avatar } from '@visvine/ui';
import SpaceLink from '@/features/shared/components/SpaceLink';
import { fetchJson } from '@/lib/fetchJson';
import type { Mutual } from '@/app/api/profile/[personId]/mutuals/route';

export default function MutualsModal({ nodeId, onClose }: {
  nodeId: string; onClose: () => void;
}) {
  const [mutuals, setMutuals] = useState<Mutual[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ mutuals?: Mutual[] }>(`/api/profile/${encodeURIComponent(nodeId)}/mutuals?all=1`)
      .then((data) => { if (!cancelled) setMutuals(data.mutuals ?? []); })
      .catch(() => { if (!cancelled) setMutuals([]); });
    return () => { cancelled = true; };
  }, [nodeId]);

  return (
    <Modal open title="Mutuals" onClose={onClose} size="sm">
      <div className="p-2">
        {mutuals === null && <p className="px-4 py-6 text-sm text-fg-muted">Loading…</p>}
        {mutuals?.map((m) => {
          const row = (
            <>
              <Avatar name={m.name} imageUrl={m.imageUrl} size="md" />
              <span className="min-w-0 truncate text-sm font-semibold text-fg">{m.name}</span>
            </>
          );
          return m.nodeId ? (
            <SpaceLink key={m.userId} href={`/directory/${encodeURIComponent(m.nodeId)}`} onClick={onClose}
                       className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-subtle">
              {row}
            </SpaceLink>
          ) : (
            <div key={m.userId} className="flex items-center gap-3 rounded-lg px-3 py-2">{row}</div>
          );
        })}
      </div>
    </Modal>
  );
}
