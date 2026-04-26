import { useEffect, useRef, useState } from 'react'
import NodeCard from './NodeCard'
import type { DirectoryItem } from './types'
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types'
import { EmptyState } from '@/components/ui'

function NodeCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden h-[360px] w-full flex flex-col bg-surface-1 border-4 border-surface-3 animate-pulse">
      <div className="h-[180px] shrink-0 bg-surface-3" />
      <div className="px-4 pt-3 pb-3 flex flex-col flex-1 gap-2 items-center">
        <div className="h-3.5 rounded bg-surface-3 w-3/4" />
        <div className="h-5 rounded-full bg-surface-3 w-20" />
        <div className="h-3 rounded bg-surface-3 w-2/3" />
        <div className="h-3 rounded bg-surface-3 w-1/2" />
        <div className="mt-auto pt-3 border-t border-surface-3 flex gap-2 w-full">
          <div className="flex-1 h-8 rounded-full bg-surface-3" />
          <div className="flex-1 h-8 rounded-full bg-surface-3" />
        </div>
      </div>
    </div>
  )
}

interface DirectoryGridProps {
  items: DirectoryItem[]
  loading?: boolean
  onCardClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  communityAliases?: CommunityAlias[]
}

export default function NodeGrid({ items, loading = false, onCardClick, nodeTypes, communityAliases }: DirectoryGridProps) {
  const [visibleCount, setVisibleCount] = useState(0)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const prevIdsKeyRef = useRef<string>('')

  useEffect(() => {
    const idsKey = items.map(i => i.id).join(',')
    if (idsKey === prevIdsKeyRef.current) return
    prevIdsKeyRef.current = idsKey

    // Clear any in-progress stagger timers
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []

    // Reset all cards to hidden
    setVisibleCount(0)

    // Stagger each card in one at a time
    items.forEach((_, i) => {
      const t = setTimeout(() => {
        setVisibleCount(i + 1)
      }, i * 80)
      timeoutsRef.current.push(t)
    })

    return () => {
      timeoutsRef.current.forEach(clearTimeout)
      prevIdsKeyRef.current = ''
    }
  }, [items])

  if (loading) return (
    <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(auto-fill, 260px)', gap: '24px', justifyContent: 'space-evenly' }}>
      {Array.from({ length: 12 }).map((_, i) => <NodeCardSkeleton key={i} />)}
    </div>
  )

  if (items.length === 0) {
    return <EmptyState title="No entries" description="No entries found. Try adjusting your filters." />
  }

  return (
    <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(auto-fill, 260px)', gap: '24px', justifyContent: 'space-evenly' }}>
      {items.map((item, i) => (
        <div
          key={item.id}
          className="transition-all duration-500 ease-out"
          style={{
            opacity: i < visibleCount ? 1 : 0,
            transform: i < visibleCount ? 'translateY(0)' : 'translateY(20px)',
          }}
        >
          <NodeCard item={item} onClick={onCardClick} nodeTypes={nodeTypes} communityAliases={communityAliases} />
        </div>
      ))}
    </div>
  )
}
