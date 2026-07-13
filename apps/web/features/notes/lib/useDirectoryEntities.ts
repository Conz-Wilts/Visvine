'use client'

// Directory entities (person/org nodes) usable in `[[ ]]` mentions and for
// entity-note resolution: the picker list + a canonical-note-path → entity map,
// built from the cached community graph (all nodes). Consumed by the profile
// Context tab (EntityContextPanel).

import { useMemo } from 'react'
import { useCommunityGraphData } from '@/hooks/useCommunityGraphData'
import { entityNotePath } from '@/lib/notes/entities'
import type { PickerEntity } from '../components/NotePicker'

export interface DirectoryEntities {
  entities: PickerEntity[]
  entityByPath: Map<string, PickerEntity>
}

export function useDirectoryEntities(): DirectoryEntities {
  const { graphData } = useCommunityGraphData()

  return useMemo(() => {
    const list: PickerEntity[] = []
    const map = new Map<string, PickerEntity>()
    for (const n of graphData.nodes) {
      const path = entityNotePath({ id: n.id, type: n.type })
      if (!path) continue
      const e: PickerEntity = {
        id: n.id,
        name: n.name,
        type: n.type,
        image_url: n.image_url ?? null,
        subtitle: n.subtitle ?? null,
      }
      list.push(e)
      map.set(path, e)
    }
    return { entities: list, entityByPath: map }
  }, [graphData])
}
