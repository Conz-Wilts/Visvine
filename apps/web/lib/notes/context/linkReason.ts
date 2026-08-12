// The "why" of a context link, stored under `Link.metadata.context`. Two tiers:
// per-note excerpts (the prose block around each [[mention]], captured
// deterministically at sync time by lib/notes/entityLinks.ts) and an optional
// AI-written `reason` phrase derived from those excerpts (lib/notes/linkReasons.ts).
//
// Excerpts are keyed by the MENTIONING note's path, not folded into one field:
// when A and B mention each other the edge is a single row owned by one of them,
// and each note's save must be able to refresh its own excerpt without
// clobbering the other's. `reasonHash` records which excerpt set the reason was
// generated from, so an unchanged note never re-triggers the LLM.
//
// Pure and dependency-free (no crypto here — hashes are computed by the server
// writer) so both the server sync and client panels can import it.

export interface LinkContextExcerpt {
  /** The stripped prose block around the mention, capped at ~500 chars. */
  text: string
  /** sha256 of `text`, stamped by the writer. */
  hash: string
}

export interface LinkContextMeta {
  /** Per-direction excerpts, keyed by the mentioning note's path. */
  excerpts: Record<string, LinkContextExcerpt>
  /** AI phrase stating why the two are linked, ≤120 chars. */
  reason?: string
  /** combinedExcerptHash() value the reason was generated from. */
  reasonHash?: string
  /** aiModelName() at generation time. */
  reasonModel?: string
  updatedAt?: string
}

/** The `context` payload off a Link's metadata, or null when absent/malformed. */
export function readLinkContextMeta(metadata: unknown): LinkContextMeta | null {
  const context = (metadata as Record<string, unknown> | null)?.context
  if (typeof context !== 'object' || context === null) return null
  const raw = context as Record<string, unknown>
  const excerpts: Record<string, LinkContextExcerpt> = {}
  const rawExcerpts = raw.excerpts
  if (typeof rawExcerpts === 'object' && rawExcerpts !== null) {
    for (const [path, value] of Object.entries(rawExcerpts as Record<string, unknown>)) {
      const entry = value as Record<string, unknown> | null
      if (typeof entry?.text === 'string' && typeof entry?.hash === 'string') {
        excerpts[path] = { text: entry.text, hash: entry.hash }
      }
    }
  }
  return {
    excerpts,
    reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : undefined,
    reasonHash: typeof raw.reasonHash === 'string' ? raw.reasonHash : undefined,
    reasonModel: typeof raw.reasonModel === 'string' ? raw.reasonModel : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  }
}

/**
 * Identity of the excerpt set a reason was generated from: the per-excerpt
 * hashes joined in key order. Joining stored hashes (rather than re-hashing
 * text) keeps this module crypto-free and therefore client-importable.
 */
export function combinedExcerptHash(meta: LinkContextMeta): string {
  return Object.keys(meta.excerpts)
    .sort()
    .map((key) => `${key}:${meta.excerpts[key].hash}`)
    .join('|')
}

/**
 * Next `metadata.context` for an edge after `fromPath`'s save: `fromPath`'s own
 * excerpt is replaced (or dropped when null — the mention is gone or yields no
 * prose), other notes' excerpts are kept while `keepKey` says their note still
 * resolves, and dead keys are pruned. Returns null when nothing actually
 * changed, so callers can skip the metadata write on a debounced re-save.
 * Hashes are computed by the caller — this module stays crypto-free.
 */
export function nextContextMeta(
  prior: LinkContextMeta | null,
  fromPath: string,
  excerpt: LinkContextExcerpt | null,
  keepKey: (path: string) => boolean,
): LinkContextMeta | null {
  const excerpts: LinkContextMeta['excerpts'] = {}
  for (const [key, value] of Object.entries(prior?.excerpts ?? {})) {
    if (key === fromPath) continue
    if (!keepKey(key)) continue
    excerpts[key] = value
  }
  if (excerpt) excerpts[fromPath] = excerpt

  const before = prior?.excerpts ?? {}
  const beforeKeys = Object.keys(before).sort()
  const afterKeys = Object.keys(excerpts).sort()
  const unchanged =
    beforeKeys.length === afterKeys.length &&
    beforeKeys.every((key, i) => key === afterKeys[i] && before[key].hash === excerpts[key].hash)
  if (unchanged) return null

  return { ...(prior ?? {}), excerpts, updatedAt: new Date().toISOString() }
}

/** Full metadata payload for a row: foreign keys preserved, `context` replaced. */
export function mergeContextMeta(
  rowMetadata: unknown,
  context: LinkContextMeta,
): Record<string, unknown> {
  const base =
    typeof rowMetadata === 'object' && rowMetadata !== null
      ? (rowMetadata as Record<string, unknown>)
      : {}
  return { ...base, context }
}

/** The first non-empty excerpt text, preferring `fromPath`'s own, or null. */
export function firstExcerpt(meta: LinkContextMeta | null, fromPath?: string): string | null {
  if (!meta) return null
  if (fromPath && meta.excerpts[fromPath]?.text) return meta.excerpts[fromPath].text
  for (const key of Object.keys(meta.excerpts).sort()) {
    if (meta.excerpts[key].text) return meta.excerpts[key].text
  }
  return null
}
