/**
 * Something a running Tool did that a person should look at: a frame that
 * navigated itself, a CSP violation its sandbox blocked, a member's report.
 *
 * An incident records facts about the Tool — which install and version, what
 * kind, which directive — and never the viewer's content: a CSP report's
 * blocked URL is reduced to its origin, because a Tool trying to leak data
 * puts the data in that URL.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { ResolvedTarget } from './target'

type IncidentKind = 'navigation' | 'csp' | 'report' | 'canary' | 'anomaly'
type IncidentSeverity = 'severe' | 'flag' | 'quality' | 'report'

export interface IncidentInput {
  kind: IncidentKind
  severity: IncidentSeverity
  key?: string | null
  versionId?: string | null
  installId?: string | null
  spaceId?: string | null
  viewerId?: string | null
  detail?: Record<string, unknown>
}

export async function recordIncident(input: IncidentInput): Promise<void> {
  try {
    await prisma.appToolIncident.create({
      data: {
        kind: input.kind,
        severity: input.severity,
        key: input.key ?? null,
        versionId: input.versionId ?? null,
        installId: input.installId ?? null,
        spaceId: input.spaceId ?? null,
        viewerId: input.viewerId ?? null,
        detail: (input.detail ?? {}) as object,
      },
    })
  } catch (err) {
    logger.error('tools.incident.record_failed', { err, kind: input.kind })
  }
}

/** The incident facts a resolved target carries. */
export function incidentSubject(t: ResolvedTarget, viewerId: string): Omit<IncidentInput, 'kind' | 'severity'> {
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
