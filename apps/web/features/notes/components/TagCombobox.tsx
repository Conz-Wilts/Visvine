'use client'

// Tag picker for the context-note header, drawn as the Grid bar's TagMenu so
// the two read as one family: the "+ Add tag" chip stays where it is and a
// menu floats under it — a search box, then every tag the space knows as its
// own chip, then "Create" with a colour swatch row when the text names a tag
// that does not exist yet. Picking an existing tag calls onAdd; creating calls
// onCreate with the chosen colour. A click outside or Escape calls onClose.

import { useRef, useState, useMemo, type ReactNode } from 'react'
import { clsx } from 'clsx'
import Chip from '@/components/ui/Chip'
import SearchInput from '@/components/ui/SearchInput'
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown'
import { useClickOutside } from '@/features/shared/hooks/useClickOutside'
import { TAG_SWATCHES, resolveTagBase, tagKey, tagPalette } from '@/lib/tagColors'

const MAX_TAG_LENGTH = 40

interface TagComboboxProps {
  /** Whether the menu is showing. The trigger (children) is drawn either way. */
  open: boolean
  /** The "+ Add tag" chip the menu hangs from. */
  children: ReactNode
  /** Space tags in use and not already on this entity, sorted. Merged with
   *  the registry below, so a caller need not chase down every source. */
  suggestions: string[]
  /** Lower-cased tags already on this entity, to suppress a redundant "Create". */
  existing: Set<string>
  /** Space tag → base-colour registry, for colouring suggestions. */
  registry: Record<string, string>
  onAdd: (tag: string) => void
  onCreate: (tag: string, color: string) => void
  onClose: () => void
}

export function TagCombobox({
  open, children, suggestions, existing, registry, onAdd, onCreate, onClose,
}: TagComboboxProps) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => { if (open) onClose() })

  return (
    <div ref={ref} className="relative">
      {children}
      {open && (
        <TagMenu
          suggestions={suggestions}
          existing={existing}
          registry={registry}
          onAdd={onAdd}
          onCreate={onCreate}
          onClose={onClose}
        />
      )}
    </div>
  )
}

function TagMenu({
  suggestions, existing, registry, onAdd, onCreate, onClose,
}: Omit<TagComboboxProps, 'open' | 'children'>) {
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)

  const query = draft.trim().toLowerCase()

  // Every tag the space knows, not just the ones currently ON something:
  // the colour registry holds tags whose last node was retyped or deleted, and
  // a plain note's tags are as real as an entity's. The list scrolls, so it is
  // shown whole rather than truncated — a hidden tag gets re-created by hand,
  // which is exactly how near-duplicate tags appear.
  const pool = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const t of suggestions) {
      const key = tagKey(t)
      if (key) byKey.set(key, t.trim())
    }
    for (const key of Object.keys(registry)) {
      if (key && !byKey.has(key) && !existing.has(key)) byKey.set(key, key)
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b))
  }, [suggestions, registry, existing])

  const matches = useMemo(
    () => (query ? pool.filter((t) => t.toLowerCase().includes(query)) : pool),
    [pool, query],
  )

  const trimmed = draft.trim()
  const showCreate =
    !!trimmed &&
    !existing.has(query) &&
    !pool.some((t) => t.toLowerCase() === query)

  // Keyboard-selectable rows: matching suggestions, then the optional Create.
  const rows: Array<{ kind: 'tag' | 'create'; value: string }> = [
    ...matches.map((value) => ({ kind: 'tag' as const, value })),
    ...(showCreate ? [{ kind: 'create' as const, value: trimmed }] : []),
  ]
  const active = Math.min(highlight, rows.length - 1)

  const commit = (row: { kind: 'tag' | 'create'; value: string } | undefined) => {
    if (!row) { onClose(); return }
    if (row.kind === 'create') onCreate(row.value, resolveTagBase(row.value, registry))
    else onAdd(row.value)
    onClose()
  }

  return (
    <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[300px]')}>
      <div
        className="border-b border-border-subtle p-2"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (rows.length) commit(rows[active])
            else onClose()
          } else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
      >
        <SearchInput
          value={draft}
          onChange={(v) => { setDraft(v.slice(0, MAX_TAG_LENGTH)); setHighlight(0) }}
          placeholder="Search or create…"
          size="md"
          autoFocus
        />
      </div>

      {rows.length > 0 && (
        <ul role="listbox" className="max-h-[320px] overflow-y-auto overscroll-contain py-1 custom-scrollbar">
          {rows.map((row, i) => (
            <li key={`${row.kind}:${row.value}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(row)}
                className={clsx(
                  'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors',
                  i === active && 'bg-surface-2',
                )}
              >
                {row.kind === 'create' ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-text-muted">+</span>
                    <span className="text-text-secondary">Create</span>
                    <span className="truncate font-medium text-text-primary">“{row.value}”</span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1">
                    <Chip size="md" color={tagPalette(row.value, registry).base}>
                      <span className="truncate">{row.value}</span>
                    </Chip>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <div className="flex flex-wrap gap-1.5 border-t border-border-subtle px-4 py-2.5">
          {TAG_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Create “${trimmed}” in this colour`}
              onClick={() => { onCreate(trimmed, color); onClose() }}
              className="h-5 w-5 rounded-full border border-black/10 transition hover:scale-110"
              style={{ background: color }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
