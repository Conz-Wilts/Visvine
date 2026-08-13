'use client'

// The Type / Tags block under a note's title, read-only, on every surface that
// shows a note it isn't editing: the standalone note view and the Context
// browser's note column.
//
// A note's type and tags always show. The type is resolved against the types
// the space created in its console, so the chip carries the console's own
// spelling and colour; a type the console doesn't know still shows (a note that
// says what it is must be able to say so) but falls back to the neutral grey
// treatment — which is the visible signal that the type wants creating in the
// console, where it becomes filterable, aliasable and coloured.
//
// Chips are rounded squares in the note's own colours, the shape tags take
// everywhere else they aren't editable.
//
// Label above value, not beside it — a note's column is narrow and a label
// gutter would eat a third of it.

import Chip from '@/components/ui/Chip'
import { findAlias, getNodeTypeConfig, nodeTypeLabel } from '@/lib/types'
import { tagPalette } from '@/lib/tagColors'
import type { SpaceAlias, NodeTypeConfig } from '@/lib/types'

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted'

interface NoteMetaRowsProps {
  /** The note's frontmatter type, named and coloured by the space console. */
  type?: string | null
  /**
   * The alias the note's directory node holds, when it has one. A type is shown
   * by its alias wherever the space gave it one — "Portfolio Company", not
   * "Space" — so the chip here matches the node's card in the directory.
   * Unrecognised values fall back to the type name (nodeTypeLabel), which is
   * what keeps an event's public slug from surfacing as a type.
   */
  alias?: string | null
  tags: string[]
  /** The space's configured node types, from the console. */
  nodeTypes?: NodeTypeConfig[]
  /** The space's aliases — the registry an alias has to appear in to count. */
  aliases?: SpaceAlias[]
  tagColors?: Record<string, string> | null
  className?: string
}

export function NoteMetaRows({
  type, alias, tags, nodeTypes, aliases, tagColors, className = '',
}: NoteMetaRowsProps) {
  const trimmedType = type?.trim() || null
  const typeConfig = trimmedType ? getNodeTypeConfig(trimmedType, nodeTypes) : null
  // An alias carries its own colour, the one the directory card is painted in.
  const aliasConfig = trimmedType ? findAlias(aliases, alias, trimmedType) : undefined
  if (!typeConfig && tags.length === 0) return null

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {typeConfig && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <span className="flex">
            {/* The console's own spelling of the type, not the note's — one name
                for one type, wherever you meet it — and its alias in preference
                to it, since that's the name the space actually uses. */}
            <Chip size="lg" color={aliasConfig?.color ?? typeConfig.color}>
              {nodeTypeLabel(trimmedType, alias, aliases, nodeTypes)}
            </Chip>
          </span>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Chip key={tag} size="lg" color={tagPalette(tag, tagColors).base}>
                {tag}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
