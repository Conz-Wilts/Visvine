/**
 * A file arriving from outside the app — an AI chat, a link, a drop page —
 * becomes a Drive file, under the same gates as a browser upload.
 *
 * Every door that is not the Drive's own upload route comes through here:
 * `upload_file` (a URL, a chat client's download link, base64) and the upload
 * token's two doors (`PUT /api/uploads/<token>`, the `/drop/<token>` page). So
 * the two gates are asked in one place — the person is an active member of the
 * space, and the Drive is open to them there — and the file is named before the
 * Drive decides what it is (shared/incomingName.ts).
 */
import { ApiError } from '@/lib/api/route'
import { featureAccessForbidden, spaceMemberForbidden } from '@/lib/auth'
import { MAX_RESOURCE_BYTES, uploadResource, type UploadedFile } from '@/lib/resources/service'
import type { ShareVia } from '@/lib/resources/shares'
import { incomingFileName, incomingMimeType } from '@/lib/resources/shared/incomingName'

export interface IncomingFile {
  userId: string
  email?: string | null
  spaceId: string
  folderId?: string | null
  name?: string | null
  mimeType?: string | null
  bytes: Buffer
  /** A channel it is being posted into: shared there by the message, not to the space. */
  conversationId?: string | null
  via?: ShareVia
  agentName?: string | null
}

/** Throws ApiError(403) unless `userId` may add files to `spaceId`'s Drive. */
export async function requireDriveWriter(userId: string, spaceId: string, email?: string | null): Promise<void> {
  if (await spaceMemberForbidden(userId, spaceId, email)) {
    throw new ApiError(403, 'Only an active member of the space can add files to it')
  }
  if (await featureAccessForbidden(userId, spaceId, 'directory', email)) {
    throw new ApiError(403, 'The Drive is not available to you in this space')
  }
}

export async function receiveFile(input: IncomingFile): Promise<UploadedFile> {
  await requireDriveWriter(input.userId, input.spaceId, input.email)
  if (input.bytes.length === 0) throw new ApiError(400, 'The file is empty')
  if (input.bytes.length > MAX_RESOURCE_BYTES) {
    throw new ApiError(400, `File must be less than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB`)
  }
  const filename = incomingFileName(input.name, input.mimeType, input.bytes)
  try {
    return await uploadResource({
      spaceId: input.spaceId,
      filename,
      mimeType: incomingMimeType(filename, input.mimeType),
      buffer: input.bytes,
      uploadedBy: input.userId,
      folderId: input.folderId ?? null,
      conversationId: input.conversationId ?? null,
      via: input.via,
      agentName: input.agentName ?? null,
    })
  } catch (err) {
    // An image the re-encoder cannot read is the caller's to fix, not a fault;
    // anything else is one, and goes up as it is.
    if (err instanceof Error && /unsupported image format|input buffer/i.test(err.message)) {
      throw new ApiError(400, `'${filename}' is not an image Visvine can read`)
    }
    throw err
  }
}
