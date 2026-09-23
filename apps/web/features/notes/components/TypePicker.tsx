'use client'

// The type picker for a context note's header: a popover of the space's types,
// each drawn as the chip it will become.
//
// It replaced a `<select>`. A type IS a coloured word in this app — the chip is
// how it reads on a card, in the directory, in the tree — and a native select
// drew it as plain black text in a system menu, so the one thing that tells two
// types apart was gone at the moment you were choosing between them.
//
// Drawn as the shared search menu (components/ui/SearchMenu), like the Tags
// picker under it and the `[[` link picker: a type and a tag are the same
// object to a reader, so choosing one must feel the same.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { clsx } from 'clsx'
import Chip from '@/components/ui/Chip'
import {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuEmpty,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@/components/ui/SearchMenu'
import { scoreText } from '@/lib/fuzzy'
import type { NodeTypeConfig } from '@/lib/types'

const PICKED_RING = 'ring-2 ring-line ring-offset-1 ring-offset-surface'

interface TypePickerProps {
  /** Types that may be assigned. The caller owns vocabulary policy. */
  options: NodeTypeConfig[]
  /** The type currently declared, for the ring. Null when the note declares none. */
  current: string | null
  /** The word shown for "declares nothing" — a folder's `Index`, else "No type". */
  clearLabel: string
  /** Null clears the type. */
  onPick: (type: string | null) => void
  /** The chip that opened this. Counts as inside, so pressing it again closes
   *  the float instead of dismissing and reopening it in the same gesture. */
  anchorRef?: RefObject<HTMLElement | null>
  onClose: () => void
}

export function TypePicker({ options, current, clearLabel, onPick, anchorRef, onClose }: TypePickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const currentLower = current?.trim().toLowerCase() ?? null
  const q = query.trim()

  // Clearing is a row too, last, so the list it lands back in is the list you
  // picked from — and when the note is a folder it names what clearing leaves
  // behind rather than the absence of it. A query hides it: it is not a type.
  const rows = useMemo(() => {
    const types = options.filter((o) => scoreText(o.name, q) >= (q ? 60 : 1))
    return [
      ...types.map((o) => ({ kind: 'type' as const, option: o })),
      ...(q ? [] : [{ kind: 'clear' as const }]),
    ]
  }, [options, q])

  const choose = (i: number) => {
    const row = rows[i]
    if (!row) return
    onPick(row.kind === 'type' ? row.option.name : null)
    onClose()
  }
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: q, onChoose: choose, onClose })

  // Dismiss on a press anywhere else. Pointerdown, not click, so a press that
  // starts outside closes the popover before the chip under it fires.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [anchorRef, onClose])

  return (
    <div ref={ref} className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-[38px] w-72')}>
      <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search types…" />
      <SearchMenuList active={cursor.active}>
        {rows.length === 0 && <SearchMenuEmpty />}
        {rows.map((row, i) => (
          <button
            key={row.kind === 'type' ? row.option.name : ':clear:'}
            type="button"
            data-menu-row={i}
            onMouseEnter={() => cursor.setActive(i)}
            onClick={() => choose(i)}
            className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
          >
            {row.kind === 'type' ? (
              <Chip
                size="md"
                color={row.option.color}
                className={clsx(row.option.name.trim().toLowerCase() === currentLower && PICKED_RING)}
              >
                <span className="truncate">{row.option.name}</span>
              </Chip>
            ) : (
              <span className="text-fg-secondary">{clearLabel}</span>
            )}
          </button>
        ))}
      </SearchMenuList>
    </div>
  )
}
