'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  applyTabIndicator,
  publishTabIndicator,
  useTabIndicatorHandoff,
  TAB_MOTION,
  TAB_MOTION_EASE,
  TAB_SET_MOTION_MS,
} from '@visvine/ui';

/**
 * The one tab set the shell's top band carries: the Directory's and a note's
 * (PaneTabBar), an event's and a profile's (PageTabBar), the Space Console's
 * sections (ConsoleShell) and an installed Tool's own sections (ToolPage).
 * A page portals it into the band's tabs host; standing on its own it draws in
 * place. One component, so moving between those surfaces reads as one bar
 * relabelling itself: same row height, same words, the same underline sliding
 * — handed from one bar to the next through `handoffKey`.
 *
 * `flip` animates an in-place change of the tab SET (a note → a profile under
 * one persistent bar): surviving words slide from where they stood, new ones
 * fade in, removed ones fade out where they were.
 */

export interface BandTab {
  id: string;
  label: string;
}

interface LabelRect {
  left: number;
  width: number;
  label: string;
}

/** Cross-set label identity for the FLIP: the eye tracks the word, so "Connections (5)" → "Connections (12)" is a move. */
const labelMatchKey = (label: string) => label.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

export default function BandTabList({
  tabs,
  activeId,
  onSelect,
  ariaLabel,
  handoffKey,
  inBand,
  flip = false,
}: {
  tabs: BandTab[];
  /** Null when no tab is selected: the underline stands still where it was. */
  activeId: string | null;
  onSelect: (id: string) => void;
  ariaLabel: string;
  /** Participate in the cross-page underline handoff under this key (tabIndicatorHandoff). */
  handoffKey?: string;
  /** Portalled into the shell band (no chrome of its own), or standing in a row of its own. */
  inBand: boolean;
  flip?: boolean;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  // Transitions arm only once the first frame is painted, so a bar mounting
  // mid-navigation appears finished instead of sliding its underline out from
  // width 0. Once armed, a real tab change animates as designed.
  const [armed, setArmed] = useState(false);
  const motion = armed ? `transition-all ${TAB_MOTION}` : '';

  // The underline rect of the bar this one replaced, claimed once at mount.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(handoffKey);

  const tabsKey = tabs.map((t) => `${t.id} ${t.label}`).join('|');

  // The FLIP's "First": the previous commit's settled rects.
  const prevRectsRef = useRef<Map<string, LabelRect>>(new Map());
  const prevTabsKeyRef = useRef(tabsKey);
  const [ghosts, setGhosts] = useState<LabelRect[]>([]);
  // True while a tab-set change's slower FLIP plays — the underline travels
  // with the sliding word instead of racing ahead of it.
  const [slowSet, setSlowSet] = useState(false);
  useEffect(() => {
    if (!slowSet) return;
    const id = setTimeout(() => setSlowSet(false), TAB_SET_MOTION_MS + 50);
    return () => clearTimeout(id);
  }, [slowSet]);
  useLayoutEffect(() => {
    if (!ghosts.length) return;
    const id = setTimeout(() => setGhosts([]), TAB_SET_MOTION_MS + 50);
    return () => clearTimeout(id);
  }, [ghosts]);

  // Measure BEFORE paint, so the underline is already under the active tab on
  // the first frame rather than placed a frame later.
  useLayoutEffect(() => {
    if (flip) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const tabsChanged = prevTabsKeyRef.current !== tabsKey;
      if (tabsChanged && armed && !reduced) {
        setSlowSet(true);
        const prevRects = prevRectsRef.current;
        const seen = new Set<string>();
        tabs.forEach((tab, i) => {
          const b = tabRefs.current[i];
          if (!b) return;
          const k = labelMatchKey(tab.label);
          seen.add(k);
          b.getAnimations().forEach((a) => a.cancel());
          const first = prevRects.get(k);
          if (first && Math.abs(first.left - b.offsetLeft) > 1) {
            b.animate(
              [{ transform: `translateX(${first.left - b.offsetLeft}px)` }, { transform: 'none' }],
              { duration: TAB_SET_MOTION_MS, easing: TAB_MOTION_EASE },
            );
          } else if (!first) {
            b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TAB_SET_MOTION_MS, easing: 'ease-out' });
          }
        });
        const exiting = [...prevRects.values()].filter((r) => !seen.has(labelMatchKey(r.label)));
        if (exiting.length) setGhosts(exiting);
      }
      if (tabsChanged || prevRectsRef.current.size === 0) {
        const rects = new Map<string, LabelRect>();
        tabs.forEach((tab, i) => {
          const b = tabRefs.current[i];
          if (b) rects.set(labelMatchKey(tab.label), { left: b.offsetLeft, width: b.offsetWidth, label: tab.label });
        });
        prevRectsRef.current = rects;
        prevTabsKeyRef.current = tabsKey;
      }
    }

    const idx = tabs.findIndex((t) => t.id === activeId);
    const btn = tabRefs.current[idx];
    if (!btn) return;
    const target = { left: btn.offsetLeft, width: btn.offsetWidth };
    if (handoffKey) publishTabIndicator(handoffKey, target);
    return applyTabIndicator({ handoff, target, firstMeasure, setIndicator: setIndicatorStyle, setArmed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabsKey, handoff]);

  // One frame later the measured position is painted, so turning transitions
  // on now can't retroactively animate it.
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + step + tabs.length) % tabs.length;
      onSelect(tabs[next].id);
      tabRefs.current[next]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        inBand
          ? // Scrolls when the words outgrow the band, never with a bar: the
            // underline sits on rounded offsets and the exiting ghosts where a
            // word used to be, so either can poke past the edge by a subpixel.
            'relative flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : // On its own row the tablist spans it — a shrink-to-fit box with
            // overflow-x-auto grows a stray scrollbar.
            'relative flex flex-1 overflow-x-auto'
      }
    >
      {tabs.map((tab, idx) => (
        <button
          key={tab.id}
          ref={(el) => {
            tabRefs.current[idx] = el;
          }}
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={activeId === tab.id}
          aria-controls={`panel-${tab.id}`}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className={`h-12 whitespace-nowrap px-4 text-sm font-medium text-fg outline-none transition-colors duration-150 ${
            handoff ? 'tabbar-label-enter' : ''
          }`}
        >
          {tab.label}
        </button>
      ))}

      {ghosts.map((g) => (
        <span
          key={g.label}
          aria-hidden
          className="tabbar-label-exit pointer-events-none absolute top-0 flex h-12 items-center whitespace-nowrap px-4 text-sm font-medium text-fg"
          style={{ left: g.left, animationDuration: `${TAB_SET_MOTION_MS}ms` }}
        >
          {g.label}
        </span>
      ))}

      <div
        className={`absolute bottom-0 ${inBand ? 'h-[3px] rounded-full' : 'h-0.5'} bg-accent ${motion}`}
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          transitionDuration: slowSet ? `${TAB_SET_MOTION_MS}ms` : undefined,
        }}
      />
    </div>
  );
}
