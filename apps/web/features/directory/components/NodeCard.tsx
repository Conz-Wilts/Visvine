import React from 'react'
import { DirectoryItem } from './types'
import { getHeaderBgStyle } from './typeStyles'
import { getInitials } from './utils'
import { getNodeTypeConfig, getNodeGlyph, findAlias, nodeTypeLabel } from '@/lib/types'
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types'
import Badge from '@/components/ui/Badge'
import PersonSilhouette from '@/components/ui/PersonSilhouette'
import TypeSilhouette from '@/components/ui/TypeSilhouette'
import { useProfileCache } from '@/features/shared/contexts/ProfileContext'

interface DirectoryCardProps {
  item: DirectoryItem
  onClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  communityAliases?: CommunityAlias[]
}

function NodeCard({ item, onClick, nodeTypes, communityAliases }: DirectoryCardProps) {
  const { getCached, version } = useProfileCache()
  const isPerson = item.id?.startsWith('person:')
  void version // subscribe for reactivity when any profile is updated
  const cached = isPerson ? getCached(item.id) : null

  const displayName = cached?.name ?? item.name
  const displaySubtitle = cached?.subtitle ?? item.subtitle
  const displayImageUrl = cached?.imageUrl ?? item.image_url

  const glyph = getNodeGlyph(item.type)
  const baseTypeColor = getNodeTypeConfig(item.type, nodeTypes).color
  const aliasConfig = findAlias(communityAliases, item.alias, item.type)
  const typeColor = aliasConfig?.color ?? baseTypeColor

  // Glow colors exposed as CSS vars so the hover state is pure CSS (no JS
  // mouse handlers writing inline styles on every hover).
  const cardStyle = {
    borderColor: typeColor,
    '--card-glow': `${typeColor}55`,
    '--card-glow-strong': `${typeColor}99`,
  } as React.CSSProperties

  return (
    <div
      className="bg-surface-1 rounded-2xl overflow-hidden cursor-pointer group flex flex-col h-[360px] w-full border-4 transition-[box-shadow,transform] duration-200 active:scale-[0.98] [box-shadow:0_6px_16px_rgba(0,0,0,0.08),0_0_12px_2px_var(--card-glow)] hover:[box-shadow:0_10px_24px_rgba(0,0,0,0.12),0_0_20px_4px_var(--card-glow-strong)]"
      style={cardStyle}
      onClick={() => onClick?.(item)}
    >
      {/* Fixed-height header */}
      {displayImageUrl ? (
        <div className="h-[180px] shrink-0 overflow-hidden">
          <img
            src={displayImageUrl}
            alt={displayName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      ) : isPerson ? (
        <div className="h-[180px] shrink-0">
          <PersonSilhouette color={typeColor} />
        </div>
      ) : glyph ? (
        <div className="h-[180px] shrink-0">
          <TypeSilhouette glyph={glyph} color={typeColor} />
        </div>
      ) : (
        <div className="h-[180px] shrink-0 flex items-center justify-center group-hover:brightness-105 transition-all" style={getHeaderBgStyle(typeColor)}>
          <span className="text-2xl font-bold text-white drop-shadow-sm">
            {getInitials(displayName)}
          </span>
        </div>
      )}

      {/* Content area — fills remaining height */}
      <div className="px-4 pt-3 pb-3 flex flex-col flex-1 min-h-0 items-center text-center">
        {/* Name — single line */}
        <h3 className="font-semibold text-text-primary text-sm leading-tight line-clamp-1 w-full mb-2">
          {displayName}
        </h3>

        {/* Subtitle — single line */}
        <p className="text-text-primary font-semibold text-xs leading-snug line-clamp-2 w-full mb-2">
          {displaySubtitle ?? ''}
        </p>

        {/* Type badge — pinned to bottom center */}
        <Badge variant="type-chip" color={typeColor} className="mt-auto mb-2">
          {nodeTypeLabel(item.type, item.alias, communityAliases, nodeTypes)}
        </Badge>
      </div>
    </div>
  )
}

export default React.memo(NodeCard)
