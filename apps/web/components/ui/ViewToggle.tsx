'use client'

import { useEffect, useRef, useState } from 'react'

export interface ViewToggleOption<T extends string> {
  id: T
  label: string
  icon?: React.ReactNode
}

interface ViewToggleProps<T extends string> {
  options: ViewToggleOption<T>[]
  value: T
  onChange: (id: T) => void
  /** Extra classes for the outer container (e.g. to override height). */
  className?: string
  /** 'sm' fits compact chrome rows (profile tab header); 'md' is the page-level default. */
  size?: 'md' | 'sm'
}

function measureBtn(btn: HTMLButtonElement, container: HTMLDivElement) {
  const b = btn.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  return { left: b.left - c.left, width: b.width }
}

/**
 * Segmented view selector drawn as a row of words with a 2px accent underline
 * sliding beneath the active one — the same signal the pane tab bar uses, at
 * toolbar scale, so a view switch never reads as a bordered control. The
 * option set may change at runtime (options appearing/disappearing); the
 * underline re-measures and slides to wherever the active option lands.
 */
export default function ViewToggle<T extends string>({ options, value, onChange, className = '', size = 'md' }: ViewToggleProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number } | null>(null)
  // Suppress the slide on the very first measure (the pill mounts in place);
  // every change after that animates.
  const animatedRef = useRef(false)

  // Re-measure whenever the active option or the option set changes. optionsKey
  // keeps the effect from firing on unrelated parent re-renders that hand us a
  // fresh-but-equal options array.
  const optionsKey = options.map((o) => o.id).join('|')
  useEffect(() => {
    const container = containerRef.current
    const activeIndex = options.findIndex((o) => o.id === value)
    const btn = buttonRefs.current[activeIndex]
    if (!container || !btn) {
      setPillStyle(null)
      return
    }
    setPillStyle(measureBtn(btn, container))
    requestAnimationFrame(() => {
      animatedRef.current = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, optionsKey])

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center gap-1 ${
        size === 'sm' ? 'h-9' : 'h-12'
      } ${className}`}
    >
      {pillStyle && (
        <span
          className="absolute bottom-0 h-0.5 rounded-full bg-brand-green"

          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: animatedRef.current
              ? 'left 220ms cubic-bezier(0.4,0,0.2,1), width 220ms cubic-bezier(0.4,0,0.2,1)'
              : undefined,
          }}
        />
      )}

      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            buttonRefs.current[i] = el
          }}
          onClick={() => onChange(o.id)}
          className={`relative z-10 flex h-full items-center gap-1.5 font-semibold transition-colors duration-200 ${
            size === 'sm' ? 'px-2.5 text-[11px]' : 'px-3 text-xs'
          } ${value === o.id ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
