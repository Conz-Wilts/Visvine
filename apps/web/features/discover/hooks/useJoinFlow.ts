'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { selfJoinAliases, type Space } from '@/lib/types';
import { viewerDoorFor, type ViewerDoor } from '@/features/spaces/lib/viewerDoor';

/**
 * Joining from Discover: one press when the space offers no role to pick, a
 * role dialog when it does. A user joins as a person, so only Person-scoped,
 * non-admin aliases are ever offered — you never make yourself an admin by
 * joining. The dialog state lives here so every Discover view shares one.
 */
export function useJoinFlow() {
  const { joinSpace, joinedSpaces } = useSpace();
  const [pending, setPending] = useState<Space | null>(null);
  const [joining, setJoining] = useState(false);
  // Spaces whose door was "ask" and has been pressed: the word goes quiet
  // ("Asked") until an admin there answers.
  const [asked, setAsked] = useState<Set<string>>(() => new Set());

  const joinedIds = useMemo(() => new Set(joinedSpaces.map((s) => s.id)), [joinedSpaces]);
  const isJoined = useCallback((id: string) => joinedIds.has(id), [joinedIds]);
  const isAsked = useCallback((id: string) => asked.has(id), [asked]);
  /** The door this viewer meets on a space (lib/spaces/subspaces.ts#joinOutcome). */
  const doorFor = useCallback((space: Space): ViewerDoor => viewerDoorFor(space, joinedIds), [joinedIds]);

  const confirm = useCallback(
    async (spaceId: string, alias?: string) => {
      setJoining(true);
      try {
        const status = await joinSpace(spaceId, alias);
        if (status === 'pending') setAsked((prev) => new Set(prev).add(spaceId));
      } finally {
        setJoining(false);
        setPending(null);
      }
    },
    [joinSpace],
  );

  const join = useCallback(
    (space: Space) => {
      if (selfJoinAliases(space.aliases).length > 0) setPending(space);
      else void confirm(space.id);
    },
    [confirm],
  );

  const cancel = useCallback(() => setPending(null), []);

  return { join, confirm, cancel, pending, joining, isJoined, isAsked, doorFor };
}
