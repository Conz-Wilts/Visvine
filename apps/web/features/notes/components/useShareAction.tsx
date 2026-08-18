'use client'

// Where a note surface's Share control lives.
//
// Share answers "who can see this note", which is a property of the note, not of
// the text you're editing — so it belongs with the bar chrome, at the right end
// of the pane tab row beside the Connections toggle, and it stays put while the
// editor's toolbar tray opens, closes and swaps between Edit and Raw. Rendered
// there it's styled like a tab: same height, type and colour as Page/Context/Raw.
//
// The tab row isn't guaranteed, though — a panel can render without one — so the
// hook also hands back a `fallback` in the editor toolbar's own pill styling.
// Exactly one of the two is non-null, so Share can never be missing and can
// never appear twice.

import { createPortal } from 'react-dom'
import { Share2Icon } from '@/features/shared/icons';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext'

export function useShareAction({ onOpen, title }: { onOpen: () => void; title: string }): {
  /** Render in the panel's tree; null when there's no tab row to host it. */
  slot: React.ReactNode
  /** For NoteEditor's toolbarTrailSlot (or the header, with no editor up);
   *  null when the tab row took it. */
  fallback: React.ReactNode
} {
  const { tabTrailHost } = useContextPanel()

  if (!tabTrailHost) {
    return {
      slot: null,
      fallback: (
        <button
          type="button"
          onClick={onOpen}
          title={title}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-2"
        >
          <Share2Icon className="h-3.5 w-3.5" />
          Share
        </button>
      ),
    }
  }

  return {
    slot: createPortal(
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className="flex h-12 shrink-0 items-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap text-brand-grey outline-none transition-colors duration-150 hover:text-brand-black"
      >
        <Share2Icon className="h-4 w-4" />
        Share
      </button>,
      tabTrailHost,
    ),
    fallback: null,
  }
}
