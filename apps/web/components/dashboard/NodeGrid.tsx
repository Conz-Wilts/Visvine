import React from 'react'
import { VirtuosoGrid, type GridComponents } from 'react-virtuoso'
import NodeCard from './NodeCard'
import type { DirectoryItem } from './types'
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types'
import { EmptyState, Skeleton } from '@/components/ui'

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, 260px)',
  gap: '24px',
  justifyContent: 'space-evenly',
}

function NodeCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden h-[360px] w-full flex flex-col bg-surface-1 border-4 border-surface-3">
      <Skeleton className="h-[180px] shrink-0 rounded-none" />
      <div className="px-4 pt-3 pb-3 flex flex-col flex-1 gap-2 items-center">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-5 rounded-full w-20" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="mt-auto pt-3 border-t border-surface-3 flex gap-2 w-full">
          <Skeleton className="flex-1 h-8 rounded-full" />
          <Skeleton className="flex-1 h-8 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// VirtuosoGrid renders its windowed items into this grid container.
const GridList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function GridList({ style, children, ...props }, ref) {
    return (
      <div ref={ref} {...props} style={{ ...style, ...GRID_STYLE }}>
        {children}
      </div>
    )
  }
)

// Cast through `unknown`: react-virtuoso resolves a second copy of @types/react,
// so its ref types are nominally distinct from the app's. The runtime contract
// is identical.
const gridComponents = {
  List: GridList,
  Item: ({ children, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
    <div {...props}>{children}</div>
  ),
} as unknown as GridComponents

interface DirectoryGridProps {
  items: DirectoryItem[]
  loading?: boolean
  onCardClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  communityAliases?: CommunityAlias[]
}

export default function NodeGrid({ items, loading = false, onCardClick, nodeTypes, communityAliases }: DirectoryGridProps) {
  if (loading) return (
    <div style={GRID_STYLE} className="w-full">
      {Array.from({ length: 12 }).map((_, i) => <NodeCardSkeleton key={i} />)}
    </div>
  )

  if (items.length === 0) {
    return <EmptyState title="No entries" description="No entries found. Try adjusting your filters." />
  }

  // Viewport-windowed grid: only the cards on screen are mounted. Uses the page
  // (window) scroller so it behaves like the previous full-page grid.
  return (
    <VirtuosoGrid
      useWindowScroll
      data={items}
      components={gridComponents}
      computeItemKey={(_, item) => item.id}
      itemContent={(_, item) => (
        <NodeCard item={item} onClick={onCardClick} nodeTypes={nodeTypes} communityAliases={communityAliases} />
      )}
    />
  )
}
