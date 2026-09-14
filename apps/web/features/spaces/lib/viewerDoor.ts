// The door a viewer meets on a space they can see, from the client's copy of
// the dials (docs/sub-spaces.md): the house door when they are in the space it
// sits inside, the world door otherwise. One pure answer so Discover, the hub
// page and the band all offer the same word.
import { joinOutcome, type SubspaceJoinOutcome } from '@/lib/spaces/subspaces';
import type { Space } from '@/lib/types';

export type ViewerDoor = SubspaceJoinOutcome;

export function viewerDoorFor(space: Space, joinedIds: ReadonlySet<string>): ViewerDoor {
  const parentStanding = space.parentId && joinedIds.has(space.parentId) ? 'active' : null;
  return joinOutcome(
    {
      visibility: space.visibility ?? null,
      parentId: space.parentId ?? null,
      listing: space.listing ?? null,
      houseDoor: space.houseDoor ?? null,
      worldDoor: space.worldDoor ?? null,
      personalOwnerId: null,
    },
    parentStanding,
  );
}

/** The word on the button for that door, before and after pressing it. */
export function doorLabel(door: ViewerDoor, asked: boolean): string {
  if (door === 'active') return 'Join';
  if (door === 'pending') return asked ? 'Asked' : 'Ask to join';
  return 'Invite only';
}
