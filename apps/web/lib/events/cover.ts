/**
 * A file already in the Drive becomes an event's poster, or a person's photo.
 *
 * Uploading a cover from a browser is one path (POST /api/upload) and it starts
 * from bytes the person just picked. This is the other one: the bytes are
 * already stored, described and — for a document — indexed, so the only thing
 * missing is the re-encode into the media bucket's variants. Everything an
 * agent does with the Drive goes through here rather than re-downloading a
 * signed URL and posting it back, because a signed URL is a capability and this
 * is a copy inside the tenant.
 *
 * Two rules this module owns:
 *
 * 1. **The `Resource` row is the tenant check.** A caller names a resource id,
 *    never an object path — the row says which space owns the bytes, and a row
 *    from another space is a 404 here even for an admin of this one.
 * 2. **The media prefix is derived, not passed.** `mediaPrefixBare('event', …)`
 *    is the same prefix /api/upload writes and `purgeNodeObjects` deletes, so a
 *    cover set this way is collected with the event like any other.
 */
import { ApiError } from '@/lib/api/route'
import { requireVisibleResource } from '@/lib/resources/visibility'
import { logResourceAccess, type AccessVia } from '@/lib/resources/accessLog'
import { downloadResourceFile, getMediaUrl, uploadProfileImage } from '@/lib/gcs'
import { mediaPrefixBare, type MediaEntityType } from '@/lib/storage/objectPaths'

export interface CoverFromResourceInput {
  spaceId: string
  /** The event node id the image is keyed by — 'event:<slug>'. */
  eventId: string
  /** A Drive file in `spaceId`, of fileType 'image'. */
  resourceId: string
  /** Who is using it: they must be able to see it, and the use is recorded. */
  reader: ResourceReader
}

/** The person (and, through an agent or the MCP, the door) using a resource. */
interface ResourceReader {
  userId: string
  email?: string | null
  via?: AccessVia
  agentName?: string | null
  runId?: string | null
}

/**
 * Re-encode a Drive image into an event's image variants and return the URL to
 * store as `coverImageUrl`. Nothing about the event is read or written here —
 * the caller owns the record — so this works for a draft id too, exactly as the
 * browser upload does.
 */
export async function coverUrlFromResource(input: CoverFromResourceInput): Promise<string> {
  const { spaceId, eventId, resourceId, reader } = input
  if (!eventId.startsWith('event:') || eventId.length <= 'event:'.length) {
    throw new ApiError(400, `Not an event id: '${eventId}'`)
  }
  return imageUrlFromResource({ spaceId, kind: 'event', entityId: eventId, resourceId, reader })
}

export interface ImageFromResourceInput {
  spaceId: string
  /** Whose image this is — decides the media prefix, and so what collects it. */
  kind: MediaEntityType
  /** The node id (or, for `space`, the space id) the variants are keyed by. */
  entityId: string
  /** A Drive file in `spaceId`, of fileType 'image'. */
  resourceId: string
  reader: ResourceReader
}

/**
 * Re-encode a Drive image into an entity's image variants — an event's poster,
 * a person's photo, an organisation's logo — and return the URL to store. The
 * caller owns the record and its write gate; this owns the tenant check on the
 * file and the prefix.
 */
export async function imageUrlFromResource(input: ImageFromResourceInput): Promise<string> {
  const { spaceId, kind, entityId, resourceId, reader } = input

  // Absent, another space's, and one the reader cannot see (a private
  // channel's file) are deliberately the same answer.
  let resource
  try {
    resource = await requireVisibleResource(resourceId, reader.userId, reader.email)
  } catch {
    throw new ApiError(404, `No file '${resourceId}' in this space`)
  }
  if (resource.spaceId !== spaceId) throw new ApiError(404, `No file '${resourceId}' in this space`)
  if (resource.kind !== 'image') {
    throw new ApiError(400, `'${resource.name}' is ${resource.kind === 'link' ? 'a link' : `a ${resource.kind}`}, not an image`)
  }
  // Legacy rows may hold a link rather than an object of ours; there is nothing
  // to copy from those.
  if (!resource.gcsPath || resource.gcsPath.startsWith('http') || resource.gcsPath.startsWith('/uploads')) {
    throw new ApiError(400, `'${resource.name}' has no stored file to use`)
  }

  const bytes = await downloadResourceFile(resource.gcsPath)
  const prefix = mediaPrefixBare(kind, entityId)
  await uploadProfileImage(prefix, bytes)
  await logResourceAccess({
    resourceId,
    spaceId,
    userId: reader.userId,
    via: reader.via ?? 'web',
    action: 'use',
    agentName: reader.agentName,
    runId: reader.runId,
    targetNodeId: kind === 'space' ? null : entityId,
  })
  // The cache-buster is what makes replacing an image visible: the variant
  // paths are fixed, so without it the browser keeps the old one.
  return `${getMediaUrl(`${prefix}/avatar-lg.webp`)}?v=${Date.now()}`
}
