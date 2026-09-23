// Which Drive files a message may carry. Pure — `sendMessage` loads the rows,
// this decides. A message carries only files its sender dropped into its own
// channel: anything else would let a message lift another channel's file (or a
// file someone else uploaded) into a place its readers were never given it.

const MAX_MESSAGE_FILES = 10

export interface CandidateFile {
  id: string
  uploadedBy: string
  conversationId: string | null
}

/** The refusal, or null when every requested file may ride this message. */
export function messageFilesDenial(
  requested: string[],
  rows: CandidateFile[],
  sender: { userId: string; conversationId: string },
): string | null {
  if (requested.length > MAX_MESSAGE_FILES) return `A message carries at most ${MAX_MESSAGE_FILES} files`
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of requested) {
    const row = byId.get(id)
    if (!row || row.uploadedBy !== sender.userId || row.conversationId !== sender.conversationId) {
      return 'One of the files was not dropped into this conversation by you'
    }
  }
  return null
}
