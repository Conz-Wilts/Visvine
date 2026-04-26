import { DirectoryItem } from './types'
import { getHeaderBgStyle } from './typeStyles'
import { getInitials } from './utils'
import { getNodeTypeConfig } from '@/lib/types'
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types'
import Badge from '@/components/ui/Badge'
import { useProfileCache } from '@/lib/contexts/ProfileContext'

interface DirectoryCardProps {
  item: DirectoryItem
  onClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  communityAliases?: CommunityAlias[]
}

export default function NodeCard({ item, onClick, nodeTypes, communityAliases }: DirectoryCardProps) {
  const { getCached, version } = useProfileCache()
  const isPerson = item.id?.startsWith('person:')
  void version // subscribe for reactivity when any profile is updated
  const cached = isPerson ? getCached(item.id) : null

  const displayName = cached?.name ?? item.name
  const displaySubtitle = cached?.subtitle ?? item.subtitle
  const displayImageUrl = cached?.imageUrl ?? item.image_url

  const baseTypeColor = getNodeTypeConfig(item.type, nodeTypes).color
  const aliasConfig = item.alias
    ? (communityAliases ?? []).find(a => a.name === item.alias && a.nodeType === item.type)
    : undefined
  const typeColor = aliasConfig?.color ?? baseTypeColor

  return (
    <div
      className="bg-surface-1 rounded-xl overflow-hidden transition-all duration-200 cursor-pointer group flex flex-col h-[360px] w-full"
      style={{
        border: `4px solid ${typeColor}`,
        boxShadow: `0 0 12px 2px ${typeColor}55`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px 4px ${typeColor}99`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 12px 2px ${typeColor}55`;
      }}
      onClick={() => onClick?.(item)}
    >
      {/* Fixed-height header */}
      {displayImageUrl ? (
        <div className="h-[180px] shrink-0 overflow-hidden">
          <img
            src={displayImageUrl}
            alt={displayName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      ) : (
        <div className="h-[180px] shrink-0 flex items-center justify-center group-hover:brightness-105 transition-all" style={getHeaderBgStyle(item.type, nodeTypes)}>
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

        {/* Type badge */}
        <Badge variant="type-pill" color={typeColor} className="mt-1 mb-2">
          {item.alias ?? (item.type.charAt(0).toUpperCase() + item.type.slice(1))}
        </Badge>

        {/* Push buttons to bottom */}
        <div className="mt-auto pt-3 border-t border-border-subtle flex gap-2 w-full" onClick={e => e.stopPropagation()}>
          <button className="flex-1 flex items-center justify-center gap-1 rounded-full border border-border-default text-text-muted text-xs font-semibold py-2 hover:bg-surface-2 transition-all">
            Invite
          </button>
          <button className="flex-1 flex items-center justify-center gap-1 rounded-full bg-brand-green text-white text-xs font-semibold py-2 hover:opacity-90 transition-all shadow-sm">
            Message
          </button>
        </div>
      </div>
    </div>
  )
}
