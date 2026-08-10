'use client'

// Directory entities (person/org nodes) usable in `[[ ]]` mentions and for
// entity-note resolution: the picker list + a canonical-note-path → entity map,
// built from the cached community context (all nodes). Consumed by the profile
// Context tab (EntityContextPanel).

import { useMemo } from 'react'
import { useCommunityContextData } from '@/features/notes/hooks/useCommunityContextData'
import { entityNotePath } from '@/lib/notes/entities'
import type { PickerEntity } from '../components/NotePicker'

export interface DirectoryEntities {
  entities: PickerEntity[]
  entityByPath: Map<string, PickerEntity>
  /** Every distinct tag used across the community, sorted — powers the tag picker. */
  allTags: string[]
}

export function useDirectoryEntities(): DirectoryEntities {
  const { contextData } = useCommunityContextData()

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
      const path = entityNotePath({ id: n.id, type: n.type })
      if (!path) continue
      const e: PickerEntity = {
        id: n.id,
        name: n.name,
        type: n.type,
        image_url: n.image_url ?? null,
        subtitle: n.subtitle ?? null,
        // The alias rides along because a node's type is shown by its alias
        // wherever the directory shows it, and an entity note is that node seen
        // from the notes side — the context browser labels its chips from here.
        alias: n.alias ?? null,
      }
      list.push(e)
      map.set(path, e)
    }
    const allTags = [...tagByKey.values()].sort((a, b) => a.localeCompare(b))
    return { entities: list, entityByPath: map, allTags }
  }, [contextData])
}
