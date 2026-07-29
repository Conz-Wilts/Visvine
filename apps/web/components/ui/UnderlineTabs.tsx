'use client';

import React, { useRef, useEffect, useState } from 'react';

export interface UnderlineTab<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface UnderlineTabsProps<T extends string> {
  tabs: UnderlineTab<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  /** Extra classes for the outer wrapper (e.g. width/alignment). */
  className?: string;
  /**
   * When set, each tab gets id `{idPrefix}-tab-{id}` and aria-controls
   * `{idPrefix}-panel-{id}` so callers can wire matching role="tabpanel" ids.
   */
  idPrefix?: string;
}

// Match the profile/directory tab bars: the green underline slides on the same
// curve/duration so every tab bar across the app reads as one system.
const TAB_MOTION = 'duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]';

/**
 * Text tab bar with a sliding green underline under the active tab — the same
 * control as the Directory's Grid / Context switcher, generalized so
 * other surfaces (Events view + scope selectors) share one look. Optional icons
 * sit inline before the label. Inline (not sticky) so callers place it freely.
 */
export default function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className = '',
  idPrefix,
}: UnderlineTabsProps<T>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Slide the underline to the active tab whenever it (or the tab set) changes.
  const tabsKey = tabs.map((t) => t.id).join('|');
  useEffect(() => {
    const idx = tabs.findIndex((t) => t.id === value);
    const btn = tabRefs.current[idx];
    if (btn) {
      setIndicatorStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tabsKey]);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % tabs.length;
      onChange(tabs[next].id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + tabs.length) % tabs.length;
      onChange(tabs[prev].id);
      tabRefs.current[prev]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex items-center border-b border-border-subtle ${className}`}
    >
      {tabs.map((tab, idx) => (
        <button
          key={tab.id}
          ref={(el) => { tabRefs.current[idx] = el; }}
          role="tab"
          id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className={`flex h-12 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium outline-none transition-colors duration-150 ${
            value === tab.id
              ? 'text-brand-black'
              : 'text-brand-grey hover:text-brand-black'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}

      {/* Animated green underline indicator */}
      <div
        className={`absolute bottom-0 h-0.5 bg-brand-green transition-all ${TAB_MOTION}`}
        style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
      />
    </div>
  );
}
