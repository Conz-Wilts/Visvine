'use client';

// The door on a locked sub-space — what a member of the parent gets when they
// press a row they cannot open.
//
// A lock, one sentence and one act. Nothing about what is inside is here to
// say — no context, no member list, no tool rail — because none of it crossed
// the boundary to get here (lib/spaces/subspaceAccess.ts). Asking swaps the
// panel for its confirmation.
//
// Two doors, decided by the sub-space's own admins (its house door):
//
// - 'request': asking is not entering. The request lands as a `pending`
//   membership its admins answer on Members → Wants to join, the same queue
//   an invite link's request lands in, so there is one place an admin says yes.
// - 'parent': the room is open to anyone already in the house. The button
//   reads "Join", the membership lands active, and the dialog walks in.

import { useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { CheckIcon, LockIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { invalidateRequestCache } from '@/features/shared/lib/requestCache';
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
  const { requestSubspaceAccess, joinSpace, refreshSpace, setCurrentSpace } = useSpace();
  const open = space.houseDoor === 'open';
  const inviteOnly = space.houseDoor === 'invite';
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

  // Joining an open room: the row lands active, the space list is re-read so
  // the room is a space of the viewer's, and they are put inside it.
  const join = async () => {
    if (asking) return;
    setAsking(true);
    setError(null);
    try {
      await joinSpace(space.id);
      invalidateRequestCache(`spaces:subspaces:${space.parentId}`);
      await refreshSpace();
      onClose();
      setCurrentSpace(space, '/directory');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
      setAsking(false);
    }
  };

  const sent = asked && !open;

  return (
    <Modal onClose={onClose} maxWidth="max-w-xs" ariaLabel={space.name}>
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-text-secondary">
          {sent ? <CheckIcon className="h-5 w-5" /> : <LockIcon className="h-5 w-5" />}
        </span>

        <div>
          <h2 className="text-base font-semibold text-text-primary">
            {sent
              ? 'Request sent'
              : open
                ? `Join ${space.name}?`
                : `You don’t have access to ${space.name}`}
          </h2>
          {(open || (inviteOnly && !sent)) && (
            <p className="mt-1 text-sm text-text-muted">{open ? `Open to ${parentName}` : 'Invite only'}</p>
          )}
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        {sent || inviteOnly ? (
          <Button variant="neutral" className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            variant="brand"
            className="w-full"
            onClick={() => void (open ? join() : ask())}
            loading={asking}
            loadingText={open ? 'Joining…' : 'Sending…'}
          >
            {open ? 'Join' : 'Request access'}
          </Button>
        )}
      </div>
    </Modal>
  );
}
