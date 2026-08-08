'use client'

// The Type / Tags block under a note's title, read-only, on every surface that
// shows a note it isn't editing: the standalone note view and the Context
// browser's note column.
//
// A note's type and tags always show. The type is resolved against the types
// the community created in its console, so the chip carries the console's own
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

import { getNodeTypeConfig } from '@/lib/types'
import { tagPalette } from '@/lib/tagColors'
import type { NodeTypeConfig } from '@/lib/types'

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted'
const CHIP_CLASS = 'inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold text-white'

interface NoteMetaRowsProps {
  /** The note's frontmatter type, named and coloured by the community console. */
  type?: string | null
  tags: string[]
  /** The community's configured node types, from the console. */
  nodeTypes?: NodeTypeConfig[]
  tagColors?: Record<string, string> | null
  className?: string
}

export function NoteMetaRows({ type, tags, nodeTypes, tagColors, className = '' }: NoteMetaRowsProps) {
  const trimmedType = type?.trim() || null
  const typeConfig = trimmedType ? getNodeTypeConfig(trimmedType, nodeTypes) : null
  if (!typeConfig && tags.length === 0) return null

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {typeConfig && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <span className="flex">
            {/* The console's own spelling of the type, not the note's — one name
                for one type, wherever you meet it. */}
            <span className={CHIP_CLASS} style={{ background: typeConfig.color }}>
              {typeConfig.name}
            </span>
          </span>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className={CHIP_CLASS} style={{ background: tagPalette(tag, tagColors).base }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
