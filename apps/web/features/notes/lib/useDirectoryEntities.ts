'use client'

// Directory entities (person/org nodes) usable in `[[ ]]` mentions and for
// entity-note resolution: the picker list + an entity-note-path → entity map,
// built from the cached space context (all nodes). The map registers BOTH forms
// of every entity path (people/x.md and people/x/index.md — see the "entity
// folders" note in lib/notes/entities.ts) so a link written before or after the
// note became a folder resolves; resolveEntityOwner reads it. Consumed by the
// profile Context tab (EntityContextPanel), the tree and the rails.

import { useMemo } from 'react'
import { useSpaceContextData } from '@/features/notes/hooks/useSpaceContextData'
import { entityNotePaths } from '@/lib/notes/entities'
import type { PickerEntity } from '../components/NotePicker'

export interface DirectoryEntities {
  entities: PickerEntity[]
  /** Keyed by every entity-note path form (flat + folder index). */
  entityByPath: Map<string, PickerEntity>
  /** Every distinct tag used across the space, sorted — powers the tag picker. */
  allTags: string[]
}

export function useDirectoryEntities(): DirectoryEntities {
  const { contextData } = useSpaceContextData()

  return useMemo(() => {
    const list: PickerEntity[] = []
    const map = new Map<string, PickerEntity>()
    // Dedupe tags case-insensitively, keeping the first spelling encountered.
    const tagByKey = new Map<string, string>()
    for (const n of contextData.nodes) {
      for (const tag of n.tags ?? []) {
        const key = tag.trim().toLowerCase()
        if (key && !tagByKey.has(key)) tagByKey.set(key, tag.trim())
      }
      // metadata rides along because it is what says where the note LIVES:
      // an adopted entity's note is wherever it was declared, not under the
      // namespace its type implies (see lib/notes/entities.ts).
      const paths = entityNotePaths({ id: n.id, type: n.type, metadata: n.metadata ?? null })
      if (paths.length === 0) continue
      const e: PickerEntity = {
        id: n.id,
        name: n.name,
        type: n.type,
        metadata: n.metadata ?? null,
        image_url: n.image_url ?? null,
        subtitle: n.subtitle ?? null,
        // The alias rides along because a node's type is shown by its alias
        // wherever the directory shows it, and an entity note is that node seen
        // from the notes side — the context browser labels its chips from here.
        alias: n.alias ?? null,
      }
      list.push(e)
      for (const path of paths) map.set(path, e)
    }
    const allTags = [...tagByKey.values()].sort((a, b) => a.localeCompare(b))
    return { entities: list, entityByPath: map, allTags }
  }, [contextData])
}
