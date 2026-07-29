// Attaching a freshly-created directory node to its canonical cross-community
// Identity. Extracted from app/api/data/nodes/route.ts so the note-first create
// endpoint (app/api/directory/entities/route.ts) runs the SAME resolution — two
// copies of this would drift, and the failure mode is silent: a node that simply
// never merges with its identity, with no error anywhere.

import prisma from '@/lib/prisma'
import type { NBNode } from '@/lib/types'
import { tryResolveIdentity, confirmIdentity, type ResolveResult } from './resolve'
import type { IdentityKind } from './match'

/** Which canonical-identity kind (if any) a node type participates in. */
function identityKindFor(type: string): IdentityKind | null {
  const t = type.toLowerCase()
  if (t === 'person' || t === 'people') return 'person'
  if (t === 'organization' || t === 'organisation' || t === 'org' || t === 'group') return 'organization'
  return null
}

export interface AttachIdentityResult {
  identityId: string | null
  /** Possible-match suggestions for inline confirmation; null when an explicit pick won. */
  resolution: ResolveResult | null
}

/**
 * Resolve the identity for a node about to be (or just) created.
 *
 * An explicit `identityId` from the finder is a human choice, so it's trusted and
 * recorded as confirmed. Without one the server resolves on its own — the client
 * can never silently force a merge.
 *
 * Returns `{ identityId: null, resolution: null }` for types with no identity
 * (resources, events, community-invented types).
 */
export async function attachIdentity(
  node: Pick<NBNode, 'id' | 'type' | 'name' | 'url' | 'location' | 'metadata'>,
  opts: { identityId?: string | null; actorUserId?: string | null } = {},
): Promise<AttachIdentityResult> {
  const kind = identityKindFor(node.type)
  if (!kind) return { identityId: null, resolution: null }

  const meta = (node.metadata as Record<string, unknown>) ?? {}
  const actorUserId = opts.actorUserId ?? null

  if (opts.identityId) {
    // Honour the explicit pick from the finder if it exists.
    const chosen = await prisma.identity.findFirst({
      where: { id: opts.identityId, kind },
      select: { id: true },
    })
    if (chosen) {
      await confirmIdentity(node.id, chosen.id, { actorUserId, reason: 'picked from finder' })
      return { identityId: chosen.id, resolution: null }
    }
  }

  const resolution = await tryResolveIdentity(
    node.id,
    {
      kind,
      name: node.name,
      // Only EXPLICIT signals feed matching — never coerce subtitle into a
      // company, which would risk auto-merging two same-named people.
      email: kind === 'person' ? ((meta.email as string) ?? null) : null,
      linkedinUrl: (meta.linkedinUrl as string) ?? null,
      website:
        kind === 'organization'
          ? (((meta.website as string) ?? (meta.url as string) ?? node.url) ?? null)
          : null,
      company: kind === 'person' ? ((meta.companyName as string) ?? null) : null,
      location: node.location ?? null,
    },
    { actorUserId },
  )

  return { identityId: resolution?.identityId ?? null, resolution }
}
