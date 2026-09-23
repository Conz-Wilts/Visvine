// How a resource node names the file it shows. Pure — the node page reads it on
// the client, lib/resources/node.ts on the server.

/** The Drive file a resource node shows (`metadata.fileId`), or null. */
export function fileIdOf(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null)?.fileId
  return typeof value === 'string' && value ? value : null
}

/** A file's name as a Resource's title: `Q3 report.pdf` → `Q3 report`. */
export function resourceNameOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 && filename.length - dot <= 6 ? filename.slice(0, dot) : filename
  return stem.trim() || filename
}

/**
 * A Drive file's stable address for an `<img>` or a download: the route checks
 * the reader, then redirects to a freshly signed URL. A signed URL itself is
 * never stored or handed round — it expires, and it is a bearer capability.
 */
export function resourceRawPath(resourceId: string): string {
  return `/api/resources/${encodeURIComponent(resourceId)}/raw`
}
