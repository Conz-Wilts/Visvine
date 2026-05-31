'use client'

import { useEffect, useRef, useState } from 'react'

type DirectoryView = 'grid' | 'table' | 'graph'

interface SearchAndFiltersProps {
  currentView: DirectoryView
  onViewChange: (view: DirectoryView) => void
}

const VIEWS: { id: DirectoryView; label: string; icon: React.ReactNode }[] = [
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
]

function measureBtn(btn: HTMLButtonElement, container: HTMLDivElement) {
  const b = btn.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  return { left: b.left - c.left, width: b.width }
}

export default function SearchAndFilters({ currentView, onViewChange }: SearchAndFiltersProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number } | null>(null)
  const animatedRef = useRef(false)

  // Initial placement — no transition, fires after first paint
  useEffect(() => {
    const container = containerRef.current
    const activeIndex = VIEWS.findIndex(v => v.id === currentView)
    const btn = buttonRefs.current[activeIndex]
    if (!container || !btn) return
    setPillStyle(measureBtn(btn, container))
    // Allow transitions from next change onwards
    requestAnimationFrame(() => { animatedRef.current = true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Slide to new position on view change
  useEffect(() => {
    if (!animatedRef.current) return
    const container = containerRef.current
    const activeIndex = VIEWS.findIndex(v => v.id === currentView)
    const btn = buttonRefs.current[activeIndex]
    if (!container || !btn) return
    setPillStyle(measureBtn(btn, container))
  }, [currentView])

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 rounded-full border border-border-default bg-surface-1 p-1 shadow-sm"
    >
      {pillStyle && (
        <span
          className="absolute top-1 bottom-1 rounded-full bg-brand-green shadow-sm"
          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: 'left 220ms cubic-bezier(0.4,0,0.2,1), width 220ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      )}

      {VIEWS.map(({ id, label, icon }, i) => (
        <button
          key={id}
          ref={el => { buttonRefs.current[i] = el }}
          onClick={() => onViewChange(id)}
          className={`relative z-10 flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-200 ${
            currentView === id ? 'text-white' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}
