/**
 * The facts an incident records about a Tool — which install and version,
 * which directive — and never the viewer's content: a CSP report's blocked URL
 * is reduced to its origin, because a Tool trying to leak data puts the data
 * in that URL. Incidents are raised through lib/tools/monitor.ts.
 */
import type { ResolvedTarget } from './target'

/** The incident facts a resolved target carries. */
export function incidentSubject(
  t: ResolvedTarget,
  viewerId: string,
): { key: string; versionId: string | null; installId: string | null; spaceId: string; viewerId: string } {
  const key = 'key' in t.install ? t.install.key : `${t.spaceId}/${t.config.name}`
  return { key, versionId: t.versionId ?? null, installId: t.installId, spaceId: t.spaceId, viewerId }
}

/** A URL reduced to what may be stored: its origin, or its scheme for one that has none. */
export function originOnly(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const url = new URL(raw)
    return url.origin !== 'null' ? url.origin : `${url.protocol}`
  } catch {
    // CSP reports name some sources by keyword ('inline', 'eval', 'self').
    return /^[a-z-]{1,20}$/i.test(raw) ? raw : null
  }
}
