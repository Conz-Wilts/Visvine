// Who may see a resource. Pure — `lib/resources/visibility.ts` loads the
// viewer and the shares, this decides; its SQL twin (`visibleResourceWhere`)
// states the same rule for lists.
//
// A resource is visible through its SHARES, the way a Slack file is visible
// wherever it was shared: a share to the space itself reaches every member, a
// share into a channel reaches that channel's members. Space admins see every
// resource. A resource shared nowhere (every share removed) is its creator's
// and the admins' alone; a deleted one is only theirs too, in the trash.

export interface ResourceViewer {
  userId: string
  /** A space admin (or super-admin): sees every resource of the space. */
  admin: boolean
  /** An active member of the space. */
  member: boolean
  /** The space's channels this viewer is in. */
  channelIds: ReadonlySet<string>
}

export interface VisibilityFacts {
  createdBy: string | null
  deleted: boolean
  shares: ReadonlyArray<{ conversationId: string | null }>
}

/** Whether one share reaches the viewer. */
export function shareReaches(viewer: ResourceViewer, share: { conversationId: string | null }): boolean {
  if (share.conversationId === null) return viewer.member
  return viewer.channelIds.has(share.conversationId)
}

export function canSeeResource(viewer: ResourceViewer, resource: VisibilityFacts): boolean {
  if (viewer.admin) return true
  if (!viewer.member) return false
  const own = resource.createdBy !== null && resource.createdBy === viewer.userId
  if (resource.deleted) return own
  if (resource.shares.length === 0) return own
  return resource.shares.some((share) => shareReaches(viewer, share))
}

/**
 * Who may delete (trash) a resource or restore it: its creator and the admins.
 * A channel member who can see a file did not make it theirs to remove.
 */
export function canManageResource(viewer: ResourceViewer, resource: { createdBy: string | null }): boolean {
  return viewer.admin || (resource.createdBy !== null && resource.createdBy === viewer.userId)
}

export type NoteAudience = { open: true } | { open: false; channelIds: string[]; userIds: string[] }

/**
 * The access grants a resource's note needs so the context shows it to exactly
 * the people the rule above does. A share to the space leaves the note under
 * the space's own grants (`open`); channel-only shares restrict its folder and
 * grant it to each channel; shared nowhere, it is its creator's. Admins read
 * everything regardless.
 */
export function noteAudience(
  resource: Pick<VisibilityFacts, 'createdBy' | 'shares'>,
): NoteAudience {
  const { shares, createdBy } = resource
  if (shares.some((share) => share.conversationId === null)) return { open: true }
  const channelIds = [...new Set(shares.map((share) => share.conversationId).filter((id): id is string => !!id))]
  const userIds = shares.length === 0 && createdBy ? [createdBy] : []
  return { open: false, channelIds: channelIds.sort(), userIds }
}
