'use client';

// The one pane-top tab bar for everything under /directory. It lives in the
// persistent shell (directory/layout.tsx → PaneShell), so navigating between
// notes, profiles and the Directory index re-labels this bar instead of
// mounting a new one. What it shows comes from the pages via PaneShellContext.

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTabBarSlot } from '@/lib/contexts/TabBarSlotContext';
import { useContextPanel, useDockVisuallyOpen } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff } from '@/components/ui/tabIndicatorHandoff';
import { TAB_MOTION, TAB_MOTION_EASE, TAB_MOTION_MS } from '@/components/ui/tabMotion';
import { usePaneChromeState, type PaneChromeState, type PaneTabItem } from '@/lib/contexts/PaneShellContext';

/** Height of one row of the bar — the tab row, and the attached toolbar row. */
const TAB_ROW_H = 48;

/** Top inset for anything docking beside the bar (the notes tree). Only the tab
 *  row spans the docked column — the attached toolbar is a centred pill over
 *  the content — so the inset is always one row. */
export const dockTopInsetFor = () => TAB_ROW_H;

/** Handoff key for the underline (see tabIndicatorHandoff). This bar never
 *  remounts within /directory, so it only fires crossing into or out of the
 *  shell, or when a bar reappears after tabs were null. */
export const HANDOFF_KEY = 'pane-top';

/** Bleed + stacking for the bar. The raised state stops one pixel short of the
 *  rail's seam border so the seam stays visible; the default full bleed sits
 *  under the aside. Raised while the docked tree is visible (including the
 *  slide-shut window) so a closing column can't cross the bar. Computed from
 *  actual dock visibility, not registered by pages — a page's tab state flips
 *  before the dock finishes closing. */
export function useDockEdgeClass(): string {
  return useDockVisuallyOpen() ? '-ml-[23px] z-[45]' : '-ml-6 z-20';
}

/** Cross-page label identity for the FLIP: the eye tracks the word, so match on
 *  label text with any trailing count stripped — "Connections (5)" →
 *  "Connections (12)" is a move, not a swap. Ids would need coordination across
 *  pages; words don't. */
const labelMatchKey = (label: string) => label.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

interface LabelRect {
  left: number;
  width: number;
  label: string;
}

export default function PaneTabBar() {
  const { chrome, select } = usePaneChromeState();
  const pathname = usePathname();
  // Unmounting rather than hiding is deliberate: it drops the armed/indicator
  // state, so a bar coming back mounts through the same first-frame path as a
  // shell entry.
  if (!chrome || !chrome.tabs) return null;
  return <PaneTabBarInner chrome={chrome} tabs={chrome.tabs} select={select} live={pathname === chrome.pathname} />;
}

function PaneTabBarInner({
  chrome,
  tabs,
  select,
  live,
}: {
  chrome: PaneChromeState;
  tabs: PaneTabItem[];
  select: (id: string) => void;
  /** False in the one-commit gap where the chrome still belongs to the page
   *  being navigated away from — clicks must not fire its dead onSelect. */
  live: boolean;
}) {
  const { activeId, attachedOpen } = chrome;
  const edgeClass = useDockEdgeClass();
  const { setHost } = useTabBarSlot();
  // The tray centres over the note column, not the pane: while the tree is
  // docked the content insets by its width, so the attached region matches it,
  // on the same transition.
  const { dockRequested, contextOpen } = useContextPanel();
  const trayInset = dockRequested && contextOpen ? CONTEXT_PANEL_W : 0;

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  // Transitions arm only after the bar's first frame is on screen, so a mount
  // mid-navigation reads as one continuous bar instead of an entrance
  // animation. Once armed, real tab changes animate as designed.
  const [armed, setArmed] = useState(false);
  const motion = armed ? `transition-all ${TAB_MOTION}` : '';

  // The underline rect of the pane-top bar this one replaced when crossing in
  // from another shell, claimed once at mount. Null otherwise.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(HANDOFF_KEY);

  const tabsKey = tabs.map((t) => `${t.id} ${t.label}`).join('|');

  // ── Label FLIP on in-place tab-set changes ─────────────────────────────────
  // A note→profile move arrives as a `tabs` prop change: surviving words slide
  // from their old x, new words fade in, removed words fade out as absolutely
  // positioned ghosts. The previous commit's settled rects live in a ref,
  // updated at the end of every measure pass — the "First" of FLIP.
  const prevRectsRef = useRef<Map<string, LabelRect>>(new Map());
  // Starts as the mount key, not '': the first measure pass must cache rects
  // without flagging a change.
  const prevTabsKeyRef = useRef(tabsKey);
  const [ghosts, setGhosts] = useState<LabelRect[]>([]);

  useLayoutEffect(() => {
    if (!ghosts.length) return;
    // Purge after the exit animation (tabbar-label-exit holds opacity 0 via
    // `forwards`, so a late purge can't blink the word back).
    const id = setTimeout(() => setGhosts([]), TAB_MOTION_MS + 50);
    return () => clearTimeout(id);
  }, [ghosts]);

  // Measure BEFORE paint, so the underline is already sitting under the active
  // tab on that first frame rather than being placed a frame later.
  useLayoutEffect(() => {
    // FLIP pass first, on every real tab-set change while armed (an unarmed bar
    // is mid-mount; the mount path owns that frame). WAAPI rather than React
    // state: fire-and-forget, self-cancelling when a faster navigation lands,
    // and StrictMode-safe.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tabsChanged = prevTabsKeyRef.current !== tabsKey;
    if (tabsChanged && armed && !reduced) {
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
          // Surviving word: slide from where it stood. Translate only — scaled
          // text reads as smear, and cross-set width deltas are small.
          b.animate(
            [{ transform: `translateX(${first.left - b.offsetLeft}px)` }, { transform: 'none' }],
            { duration: TAB_MOTION_MS, easing: TAB_MOTION_EASE },
          );
        } else if (!first) {
          // New word: fade in where it lands while its neighbours make room.
          b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TAB_MOTION_MS, easing: 'ease-out' });
        }
      });
      const exiting = [...prevRects.values()].filter((r) => !seen.has(labelMatchKey(r.label)));
      if (exiting.length) setGhosts(exiting);
    }
    // Cache settled rects for the next change, on every pass, so reduced-motion
    // and unarmed changes keep the "First" positions honest.
    if (tabsChanged || prevRectsRef.current.size === 0) {
      const rects = new Map<string, LabelRect>();
      tabs.forEach((tab, i) => {
        const b = tabRefs.current[i];
        if (b) rects.set(labelMatchKey(tab.label), { left: b.offsetLeft, width: b.offsetWidth, label: tab.label });
      });
      prevRectsRef.current = rects;
      prevTabsKeyRef.current = tabsKey;
    }

    const idx = tabs.findIndex((t) => t.id === activeId);
    const btn = tabRefs.current[idx];
    if (!btn) return;
    const target = { left: btn.offsetLeft, width: btn.offsetWidth };
    publishTabIndicator(HANDOFF_KEY, target);
    return applyTabIndicator({
      handoff,
      target,
      firstMeasure,
      setIndicator: setIndicatorStyle,
      setArmed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabsKey, handoff]);

  // One frame later the measured position is painted, so turning transitions on
  // now can't retroactively animate it.
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const onSelect = (id: string) => {
    if (live) select(id);
  };

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % tabs.length;
      onSelect(tabs[next].id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + tabs.length) % tabs.length;
      onSelect(tabs[prev].id);
      tabRefs.current[prev]?.focus();
    }
  }

  return (
    <div className={`sticky -top-4 -mt-4 ${edgeClass}`}>
      {/* The negative left margin bleeds the bar into <main>'s gutter so its
          bottom border continues the navbar seam. Border + background live on
          the tab row alone, so the transparent region below reads as a pill
          hanging off the nav line rather than a second bar. "-top-4 -mt-4"
          rather than top-0: <main> has pt-4 and sticky offsets resolve below
          it, so top-0 would pin the bar 16px short of the navbar. */}
      <div className="flex w-full items-center border-b border-border-subtle bg-surface-1 px-1">
        <div
          role="tablist"
          aria-label={chrome.ariaLabel ?? 'Sections'}
          className="relative flex flex-1 overflow-x-auto"
        >
          {tabs.map((tab, idx) => (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[idx] = el; }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeId === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`px-4 h-12 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none ${
                handoff ? 'tabbar-label-enter' : ''
              } ${
                activeId === tab.id
                  ? 'text-brand-black'
                  : 'text-brand-grey hover:text-brand-black'
              }`}
            >
              {tab.label}
            </button>
          ))}

          {/* Words that left the tab set, fading out where they stood while the
              survivors slide. */}
          {ghosts.map((g) => (
            <span
              key={g.label}
              aria-hidden
              className="tabbar-label-exit pointer-events-none absolute top-0 flex h-12 items-center px-4 text-sm font-medium whitespace-nowrap text-brand-grey"
              style={{ left: g.left }}
            >
              {g.label}
            </span>
          ))}

          {/* Animated green underline indicator */}
          <div
            className={`absolute bottom-0 h-0.5 bg-brand-green ${motion}`}
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </div>
      </div>

      {/* The attached region. Always mounted (a conditional mount would snap
          open with no transition) and animated 0fr↔1fr off the same tab state
          and timing as the indicator, so the pair moves as one gesture. The
          host reserves its full height from the first frame, so a tray that
          arrives late doesn't shift the content below. */}
      <div
        className={`grid ${
          armed ? `transition-[grid-template-rows] ${TAB_MOTION}` : ''
        } motion-reduce:transition-none ${
          attachedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* The host translates -100% in step with the row collapsing above
              it, on the same duration and curve, so the tray slides up behind
              the tab row and drops back down from under it. */}
          <div
            ref={setHost}
            className={`flex justify-center motion-reduce:[transition:none!important] ${
              attachedOpen ? 'translate-y-0' : '-translate-y-full'
            }`}
            style={{
              height: TAB_ROW_H,
              paddingLeft: trayInset || undefined,
              // `translate`, not `transform`: Tailwind v4's translate-y-*
              // utilities set the standalone CSS translate property.
              transition: armed
                ? 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), translate 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                : 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
