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

import { useMemo, useState } from 'react'
import Chip, { CHIP_ACCENT_HOVER, chipClass } from '@/components/ui/Chip'
import { findAlias, getNodeTypeConfig, nodeTypeLabel } from '@/lib/types'
import { tagKey, tagPalette } from '@/lib/tagColors'
import type { SpaceAlias, NodeTypeConfig } from '@/lib/types'
import { TagCombobox } from './TagCombobox'

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
  /** Turns the plain Context header into a small metadata editor. */
  editable?: boolean
  /** Types that may be assigned here. The caller owns vocabulary policy. */
  typeOptions?: NodeTypeConfig[]
  /** False where a type is structural (for example, an entity folder index). */
  canEditType?: boolean
  onTypeChange?: (type: string | null) => void
  onTagsChange?: (tags: string[]) => void
  /** Existing tags in this context, used as suggestions. */
  tagSuggestions?: string[]
  /** Persist the colour of a newly-created tag in the space registry. */
  onCreateTagColor?: (tag: string, color: string) => void
  className?: string
}

export function NoteMetaRows({
  type, alias, tags, nodeTypes, aliases, tagColors, editable = false, typeOptions, canEditType = true,
  onTypeChange, onTagsChange, tagSuggestions = [], onCreateTagColor, className = '',
}: NoteMetaRowsProps) {
  const [addingTag, setAddingTag] = useState(false)
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const trimmedType = type?.trim() || null
  const typeEditable = editable && canEditType
  const typeConfig = trimmedType ? getNodeTypeConfig(trimmedType, nodeTypes) : null
  // An alias carries its own colour, the one the directory card is painted in.
  const aliasConfig = trimmedType ? findAlias(aliases, alias, trimmedType) : undefined
  const colors = { ...(tagColors ?? {}), ...tagColorOverride }
  const tagsLower = useMemo(() => new Set(tags.map((tag) => tag.toLowerCase())), [tags])
  const options = useMemo(() => {
    const byName = new Map<string, NodeTypeConfig>()
    for (const option of typeOptions ?? nodeTypes ?? []) {
      const name = option.name?.trim()
      if (name) byName.set(name.toLowerCase(), option)
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [typeOptions, nodeTypes])

  const changeTags = (next: string[]) => onTagsChange?.(next)
  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (!tag || tagsLower.has(tag.toLowerCase())) return
    changeTags([...tags, tag])
  }
  const createTag = (raw: string, color: string) => {
    const tag = raw.trim()
    if (!tag) return
    setTagColorOverride((current) => ({ ...current, [tagKey(tag)]: color }))
    onCreateTagColor?.(tag, color)
    addTag(tag)
  }

  if (!typeConfig && tags.length === 0 && !editable) return null

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {(typeConfig || typeEditable) && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <span className="flex">
            {/* The console's own spelling of the type, not the note's — one name
                for one type, wherever you meet it — and its alias in preference
                to it, since that's the name the space actually uses. */}
            {typeEditable ? (
              <span className="flex items-center gap-1">
                <select
                  aria-label="Note type"
                  value={trimmedType ?? ''}
                  onChange={(event) => onTypeChange?.(event.target.value || null)}
                  className="h-7 max-w-full rounded-lg border border-border-default bg-surface-1 px-2.5 text-[13px] font-semibold text-text-primary outline-none focus:border-brand-green"
                >
                  <option value="">No type</option>
                  {trimmedType && !options.some((option) => option.name.toLowerCase() === trimmedType.toLowerCase()) && (
                    <option value={trimmedType}>{trimmedType}</option>
                  )}
                  {options.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
                </select>
                {trimmedType && (
                  <button
                    type="button"
                    aria-label="Remove type"
                    title="Remove type"
                    onClick={() => onTypeChange?.(null)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-default text-lg leading-none text-text-muted transition hover:border-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </span>
            ) : typeConfig ? (
              <Chip size="lg" color={aliasConfig?.color ?? typeConfig.color}>
                {nodeTypeLabel(trimmedType, alias, aliases, nodeTypes)}
              </Chip>
            ) : null}
          </span>
        </div>
      )}

      {(tags.length > 0 || editable) && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Chip key={tag} size="lg" color={tagPalette(tag, colors).base}>
                {tag}
              </Chip>
            ))}
            {editable && (addingTag ? (
              <TagCombobox
                suggestions={tagSuggestions.filter((tag) => !tagsLower.has(tag.toLowerCase()))}
                existing={tagsLower}
                registry={colors}
                accentBase={typeConfig?.color ?? '#2f8d72'}
                onAdd={addTag}
                onCreate={createTag}
                onClose={() => setAddingTag(false)}
              />
            ) : (
              <button type="button" onClick={() => setAddingTag(true)}
                      className={chipClass({ tone: 'dashed', size: 'lg', className: CHIP_ACCENT_HOVER })}
                      style={{ ['--accent' as string]: typeConfig?.color ?? '#2f8d72' }}>
                + Add tag
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
