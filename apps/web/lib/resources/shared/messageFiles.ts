// Which resources a message may carry. Pure — `sendMessage` loads the rows and
// asks the visibility rule, this decides. A message shares a resource into its
// channel, so the sender must be able to see it already and it must belong to
// the channel's space: a message can never lift a file its readers were not
// already allowed to be given, nor carry one across tenants.

const MAX_MESSAGE_FILES = 10

export interface CandidateFile {
  id: string
  spaceId: string
  /** Whether the sender can see it (shared/visibility.ts#canSeeResource). */
  visible: boolean
}

/** The refusal, or null when every requested resource may ride this message. */
export function messageFilesDenial(
  requested: string[],
  rows: CandidateFile[],
  conversation: { spaceId: string | null },
): string | null {
  if (requested.length > MAX_MESSAGE_FILES) return `A message carries at most ${MAX_MESSAGE_FILES} files`
  if (requested.length && !conversation.spaceId) return 'Files can be shared in a space’s channels only'
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of requested) {
    const row = byId.get(id)
    if (!row || !row.visible || row.spaceId !== conversation.spaceId) {
      return 'One of the files is not one you can share here'
    }
  }
  return null
}
