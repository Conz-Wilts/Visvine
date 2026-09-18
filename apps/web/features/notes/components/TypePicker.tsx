'use client'

// The type picker for a context note's header: a popover of the space's types,
// each drawn as the chip it will become.
//
// It replaced a `<select>`. A type IS a coloured word in this app — the chip is
// how it reads on a card, in the directory, in the tree — and a native select
// drew it as plain black text in a system menu, so the one thing that tells two
// types apart was gone at the moment you were choosing between them.
//
// Floats like TagCombobox (same surface and shadow) because they
// sit one above the other in the same header, and a type and a tag are the same
// object to a reader.

import { useEffect, useRef, type RefObject } from 'react'
import Chip from '@/components/ui/Chip'
import type { NodeTypeConfig } from '@/lib/types'

interface TypePickerProps {
  /** Types that may be assigned. The caller owns vocabulary policy. */
  options: NodeTypeConfig[]
  /** The type currently declared, for the tick. Null when the note declares none. */
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
  const currentLower = current?.trim().toLowerCase() ?? null

  // Dismiss on a press anywhere else or on Escape. Pointerdown, not click, so a
  // press that starts outside closes the popover before the chip under it fires.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [anchorRef, onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-[38px] z-20 w-64 rounded-xl border border-border-subtle bg-surface-1 p-2 shadow-float"
    >
      <div className="flex max-h-60 flex-wrap gap-1.5 overflow-auto">
        {options.map((option) => {
          const picked = option.name.trim().toLowerCase() === currentLower
          return (
            <Chip
              key={option.name}
              size="xl"
              color={option.color}
              onClick={() => { onPick(option.name); onClose() }}
              className={picked ? 'ring-2 ring-border-default ring-offset-1 ring-offset-surface-1' : ''}
            >
              {option.name}
            </Chip>
          )
        })}
      </div>
      {/* Clearing is a chip too, so the row it lands back in is the row you
          picked from — and when the note is a folder it names what clearing
          leaves behind rather than the absence of it. */}
      <button
        type="button"
        onClick={() => { onPick(null); onClose() }}
        className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-text-secondary transition hover:bg-surface-2"
      >
        {clearLabel}
      </button>
    </div>
  )
}
