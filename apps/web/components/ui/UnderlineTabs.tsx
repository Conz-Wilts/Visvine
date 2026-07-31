'use client';

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff } from './tabIndicatorHandoff';
import { TAB_MOTION } from './tabMotion';

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
  /** Participate in the cross-page underline handoff under this key (see
   *  tabIndicatorHandoff) — mounting shortly after a keyed sibling unmounted
   *  slides the underline from its last position instead of snapping. */
  handoffKey?: string;
}

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
  handoffKey,
}: UnderlineTabsProps<T>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Transitions stay off until the first frame is painted — a bar that mounts
  // mid-navigation (this one replaces the note view's Context/Raw bar at the
  // identical position) must appear finished, not slide its underline out from
  // width 0. Real tab changes still animate. Same arming as ProfileTabBar.
  const [armed, setArmed] = useState(false);

  // The underline rect of the keyed bar this one just replaced, claimed once at
  // mount. Null outside a fresh navigation.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(handoffKey);

  // Slide the underline to the active tab whenever it (or the tab set) changes.
  // Measured before paint so the first frame already has it in place.
  const tabsKey = tabs.map((t) => t.id).join('|');
  useLayoutEffect(() => {
    const idx = tabs.findIndex((t) => t.id === value);
    const btn = tabRefs.current[idx];
    if (!btn) return;
    const target = { left: btn.offsetLeft, width: btn.offsetWidth };
    if (handoffKey) publishTabIndicator(handoffKey, target);
    return applyTabIndicator({
      handoff,
      target,
      firstMeasure,
      setIndicator: setIndicatorStyle,
      setArmed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tabsKey, handoff, handoffKey]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

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
            handoff ? 'tabbar-label-enter' : ''
          } ${
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
        className={`absolute bottom-0 h-0.5 bg-brand-green ${armed ? `transition-all ${TAB_MOTION}` : ''}`}
        style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
      />
    </div>
  );
}
