'use client'

// Tag picker for the context-note header, drawn as the shared search menu
// (components/ui/SearchMenu) like every other list you choose from: the
// "+ Add tag" chip stays where it is and a menu floats under it — a search
// field, then every tag the space knows as its own chip, then "Create" with a
// colour swatch row when the text names a tag that does not exist yet. Picking an existing tag calls onAdd; creating calls
// onCreate with the chosen colour. A click outside or Escape calls onClose.

import { useRef, useState, useMemo, type ReactNode } from 'react'
import { clsx } from 'clsx'
import Chip from '@/components/ui/Chip'
import {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@/components/ui/SearchMenu'
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
  const commit = (row: { kind: 'tag' | 'create'; value: string } | undefined) => {
    if (!row) { onClose(); return }
    if (row.kind === 'create') onCreate(row.value, resolveTagBase(row.value, registry))
    else onAdd(row.value)
    onClose()
  }
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: query, onChoose: (i) => commit(rows[i]), onClose })

  return (
    <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full mt-1.5 w-72')}>
      <SearchMenuInput
        value={draft}
        onChange={setDraft}
        onKeyDown={cursor.onKeyDown}
        placeholder="Search or create…"
        maxLength={MAX_TAG_LENGTH}
      />

      {rows.length > 0 && (
        <SearchMenuList active={cursor.active}>
          {rows.map((row, i) => (
            <button
              key={`${row.kind}:${row.value}`}
              type="button"
              data-menu-row={i}
              onMouseEnter={() => cursor.setActive(i)}
              onClick={() => commit(row)}
              className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
            >
              {row.kind === 'create' ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-fg-muted">+</span>
                  <span className="text-fg-secondary">Create</span>
                  <span className="truncate font-medium text-fg">“{row.value}”</span>
                </span>
              ) : (
                <Chip size="md" color={tagPalette(row.value, registry).base}>
                  <span className="truncate">{row.value}</span>
                </Chip>
              )}
            </button>
          ))}
        </SearchMenuList>
      )}

      {showCreate && (
        <div className="flex flex-wrap gap-1.5 border-t border-line-subtle px-4 py-2.5">
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
