'use client';

// The one line a node read through the people flow carries above its page:
// it is a room's record, shown to a member of the house read-only
// (lib/directory/peopleFlowAccess.ts). Edit affordances are already absent —
// the node's space is not the current one, so no Context tab, no rename, no
// connection controls — and this says why.
import { BlocksIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import type { NBNode } from '@/lib/types';

export default function ViaSpaceNotice({ node }: { node: NBNode | null }) {
  const { spaces, currentSpace } = useSpace();
  const via = node?.via_space;
  if (!via) return null;
  const house = spaces.find((s) => s.id === (spaces.find((r) => r.id === via.id)?.parentId ?? currentSpace?.id));
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">
      <BlocksIcon className="h-4 w-4 shrink-0 text-brand-green" />
      <span>
        From <span className="font-medium">{via.name}</span>, a sub-space of {house ? <span className="font-medium">{house.name}</span> : 'this one'} — read-only here.
      </span>
    </div>
  );
}
