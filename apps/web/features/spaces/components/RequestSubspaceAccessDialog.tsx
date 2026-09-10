'use client';

// The door on a locked sub-space — what a member of the parent gets when they
// press a row they cannot open.
//
// It says three things and offers one act: this space is private, this many
// people are in it, and here is how to ask. Nothing about what is inside is
// here to say — no context, no member list, no tool rail — because none of it
// crossed the boundary to get here (lib/spaces/subspaceAccess.ts).
//
// Asking is not entering. The request lands as a `pending` membership its
// admins answer on Members → Wants to join, the same queue an invite link's
// request lands in, so there is one place an admin says yes.

import { useState } from 'react';
import { Modal, Button } from '@/components/ui';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import type { LockedSubspace } from '@/lib/spaces/subspaceAccess';

export default function RequestSubspaceAccessDialog({
  space,
  parentName,
  onClose,
}: {
  space: LockedSubspace;
  parentName: string;
  onClose: () => void;
}) {
  const { requestSubspaceAccess } = useSpace();
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(space.requested);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (asking || asked) return;
    setAsking(true);
    setError(null);
    try {
      await requestSubspaceAccess(space.id);
      setAsked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setAsking(false);
    }
  };

  return (
    <Modal onClose={onClose} title={space.name} size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <SpaceAvatar name={space.name} imageUrl={space.imageUrl ?? undefined} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text-primary">{space.name}</div>
            <div className="truncate text-xs text-text-muted">
              Private sub-space of {parentName} · {space.memberCount}{' '}
              {space.memberCount === 1 ? 'member' : 'members'}
            </div>
          </div>
        </div>

        {space.description && <p className="text-sm text-text-secondary">{space.description}</p>}

        <p className="text-sm text-text-muted">
          {asked
            ? 'Your request is with this space’s admins. You’ll be able to open it once one of them approves.'
            : 'You can see that this space exists because you’re in ' +
              parentName +
              '. Its context, members and tools stay closed until an admin here lets you in.'}
        </p>

        {error && <div className="border-l-2 border-red-500 py-1 pl-3 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>
            {asked ? 'Done' : 'Cancel'}
          </Button>
          {!asked && (
            <Button variant="brand" onClick={() => void ask()} disabled={asking}>
              {asking ? 'Sending…' : 'Request access'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
