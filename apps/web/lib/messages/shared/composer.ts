import type { ComposerPayload } from '@/lib/messages/types'

/** The body a composer's payload is sent as: files by id, never the drawn copies. */
export function withoutDraftFiles(payload: ComposerPayload): Omit<ComposerPayload, 'files'> {
  const { files: _files, ...body } = payload
  void _files
  return body
}
