'use client';

import { useCallback, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { selfJoinAliases, type Space } from '@/lib/types';

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

  const isJoined = useCallback((id: string) => joinedSpaces.some((s) => s.id === id), [joinedSpaces]);

  const confirm = useCallback(
    async (spaceId: string, alias?: string) => {
      setJoining(true);
      try {
        await joinSpace(spaceId, alias);
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

  return { join, confirm, cancel, pending, joining, isJoined };
}
