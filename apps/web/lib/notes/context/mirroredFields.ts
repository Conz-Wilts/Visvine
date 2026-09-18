// The frontmatter an entity's note carries FROM its record. Two readers: the
// record save pushes these into the note (entityNodes.ts
// syncEntityNoteFrontmatter), and the index contract holds the note to them
// on every write (store.ts entityContractOf), so a raw edit to one of them is
// put back rather than drifting the note from the record. A leaf on purpose —
// the store imports it, so it must not import the store.

import { entityKindOf } from '../entities'
import { findNodeTypeConfig } from '../../types/context'
import { readSpaceConfig } from '../../spaces/spaceConfig'

export type EntityRecord = {
  id: string
  type: string
  spaceId: string
  name?: string | null
  location?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * The record fields an entity's note mirrors in its frontmatter, beyond
 * `title:`. Two sources. The schedulable basics of an event — what the event
 * page edits, and what someone reading `events/<slug>.md` needs to know
 * without opening the page; event `status` is deliberately absent, it would
 * collide with the note lifecycle `status:`. And the fields the SPACE tracks
 * about the type (NodeTypeConfig.fields, lib/directory/table.ts): a value
 * typed into the Directory's table lands in the note under the same key, so
 * the note says what the record says and an agent reads it there. A field a
 * space stops tracking is left in the frontmatter as it was — removing the
 * column never rewrites notes.
 */
export async function mirroredFields(node: EntityRecord): Promise<Record<string, unknown>> {
  const meta = node.metadata ?? {}
  const out: Record<string, unknown> = {}
  if (entityKindOf(node.type) === 'event') {
    out.start_at = meta.start_at ?? null
    out.end_at = meta.end_at ?? null
    out.location = node.location ?? null
    out.capacity = meta.capacity ?? null
  }
  const config = await readSpaceConfig(node.spaceId)
  const type = findNodeTypeConfig(node.type, config?.nodeTypes ?? undefined)
  for (const field of type?.fields ?? []) {
    if (field.key in out) continue
    out[field.key] = meta[field.key] ?? null
  }
  return out
}
