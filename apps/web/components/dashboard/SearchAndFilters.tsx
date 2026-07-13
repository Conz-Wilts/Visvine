'use client'

import { ViewToggle, type ViewToggleOption } from '@/components/ui'
import type { DirectoryView } from '@/lib/directoryView'

interface SearchAndFiltersProps {
  currentView: DirectoryView
  onViewChange: (view: DirectoryView) => void
  /** Show the Context option (the community has the notes tool enabled). */
  showContext?: boolean
}

const VIEWS: ViewToggleOption<DirectoryView>[] = [
  {
    id: 'graph',
    label: 'Graph',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7a3 3 0 116 0 3 3 0 01-6 0zM3 17a3 3 0 116 0 3 3 0 01-6 0zM15 17a3 3 0 116 0 3 3 0 01-6 0zM9.5 9.5l-3 5M14.5 9.5l3 5" />
      </svg>
    ),
  },
  {
    id: 'grid',
    label: 'Grid',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    id: 'table',
    label: 'Table',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    id: 'context',
    // Same document glyph as the Context feature tile (lib/features.tsx) so the
    // toggle, console card, and Create tile stay one visual family.
    label: 'Context',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export default function SearchAndFilters({ currentView, onViewChange, showContext = true }: SearchAndFiltersProps) {
  const options = showContext ? VIEWS : VIEWS.filter((v) => v.id !== 'context')
  return (
    <span data-tour="view-toggle" className="inline-flex">
      <ViewToggle options={options} value={currentView} onChange={onViewChange} />
    </span>
  )
}
