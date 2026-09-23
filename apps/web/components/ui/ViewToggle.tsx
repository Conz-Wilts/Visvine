'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from '@visvine/tokens';

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
  /**
   * 'sm' fits compact chrome rows (profile tab header); 'md' is the page-level
   * default; 'lg' is the page's own top nav, drawn to the pane tab bar's
   * metrics (48px row, 3px underline) so a page outside the pane shell reads
   * with the same nav line as one inside it.
   */
  size?: 'md' | 'sm' | 'lg'
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
      className={`relative flex items-center ${size === 'lg' ? '' : 'gap-1'} ${
        size === 'sm' ? 'h-9' : 'h-12'
      } ${className}`}
    >
      {pillStyle && (
        <span
          className={`absolute bottom-0 rounded-full bg-accent ${size === 'lg' ? 'h-[3px]' : 'h-0.5'}`}

          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: animatedRef.current
              ? `left 220ms ${motion.easeCss.standard}, width 220ms ${motion.easeCss.standard}`
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
          className={`relative z-10 flex h-full items-center gap-1.5 transition-colors duration-200 ${
            size === 'sm'
              ? 'px-2.5 text-[11px] font-semibold'
              : size === 'lg'
                ? 'px-4 text-sm font-medium'
                : 'px-3 text-xs font-semibold'
          } ${value === o.id ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
