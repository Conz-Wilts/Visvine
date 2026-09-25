/**
 * A Tool's collections, as the server pages them — the rules themselves are
 * the contract's (@visvine/tool-protocol/collections), re-exported here.
 */
export {
  collectionChangePath,
  collectionDenial,
  DETACHED_DAYS,
  LIST_LIMIT_MAX,
  MAX_ROW_BYTES,
  queryDenial,
  readsOwnOnly,
  rowSizeDenial,
  type CollectionAct,
} from '@visvine/tool-protocol/collections'

/** A page's cursor: the last row's time and id, so a page never repeats or skips one. */
export function encodeCursor(row: { createdAt: Date | string; id: string }): string {
  return Buffer.from(`${new Date(row.createdAt).toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    const createdAt = new Date(at)
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null
  } catch {
    return null
  }
}
