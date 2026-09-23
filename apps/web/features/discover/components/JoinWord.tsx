'use client';

import { doorLabel, type ViewerDoor } from '@/features/spaces/lib/viewerDoor';

/**
 * Join is a word in the accent, never a bar. Once in, it goes quiet. The word
 * is the door's (lib/spaces/subspaces.ts): "Join" walks in, "Ask to join"
 * lands a request an admin answers ("Asked" once pressed), and an
 * invite-only door offers nothing to press.
 */
export default function JoinWord({
  joined,
  door = 'active',
  asked = false,
  onJoin,
  className = '',
}: {
  joined: boolean;
  door?: ViewerDoor;
  asked?: boolean;
  onJoin: () => void;
  className?: string;
}) {
  const quiet = joined || asked || door === 'deny';
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!quiet) onJoin(); }}
      disabled={quiet}
      className={`shrink-0 text-[13px] font-semibold transition-colors ${
        quiet ? 'cursor-default text-fg-muted' : 'text-accent-strong hover:underline'
      } ${className}`}
    >
      {joined ? 'Joined' : doorLabel(door, asked)}
    </button>
  );
}
