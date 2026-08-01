'use client';

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useTabBarSlot } from '@/lib/contexts/TabBarSlotContext';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff } from '@/components/ui/tabIndicatorHandoff';
import { TAB_MOTION } from '@/components/ui/tabMotion';

export type PageTab = 'about' | 'context' | 'raw' | 'preview';

/** Height the attached region reserves: the floating toolbar card (44px), the
 *  gap that detaches it from the nav line, and room below for its shadow — the
 *  region clips (overflow-hidden), so anything unaccounted for is cut off. */
const TAB_ROW_H = 64;

export interface TabConfig {
  id: PageTab;
  label: string;
  count?: number;
}

interface PageTabBarProps {
  /** The bar's tab set. Callers name their own first tab ("Event", "Overview"). */
  tabs: TabConfig[];
  activeTab: PageTab;
  onTabChange: (tab: PageTab) => void;
  /** Accessible name for the tablist — what these tabs are sections OF. */
  ariaLabel?: string;
  /** Override sticky offset — defaults to top-20 (80px navbar). Inside the
   *  (auth) <main> scroll container pass '-top-4 -mt-4' to cancel its pt-4 so
   *  the bar sits flush under the navbar (at rest and pinned) with no
   *  see-through gap and no shift when it pins. */
  stickyTop?: string;
  /** Open the region below the tab row that the active tab's content portals its
   *  own bar into (the note toolbar on Context — see TabBarSlotContext). Drive it
   *  straight off tab state: it opens in step with the indicator, and whatever
   *  fills it can arrive later without moving the line. */
  attachedOpen?: boolean;
  /** Horizontal bleed + stacking classes, default `-ml-6 z-20`. The standalone
   *  note view passes a rail-wide bleed + raised z (`-ml-[23px] z-[45]`) so its
   *  Context/Raw bar spans OVER the docked notes tree (z-40) — the same trick the
   *  Directory's Grid/Context bar uses — instead of starting at the tree's
   *  right edge and leaving the tree's top-left corner bare. */
  edgeClass?: string;
  /** Participate in the cross-page underline handoff under this key (see
   *  tabIndicatorHandoff). On mount, if the bar this one replaces published its
   *  underline within the freshness window, the indicator slides from that
   *  position to the active tab and the labels fade in — the navigation reads
   *  as one bar relabelling instead of a snap swap. */
  handoffKey?: string;
}

export default function PageTabBar({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel = 'Page sections',
  stickyTop = 'top-20',
  attachedOpen = false,
  edgeClass = '-ml-6 z-20',
  handoffKey,
}: PageTabBarProps) {
  const { setHost } = useTabBarSlot();
  // The toolbar tray centres over the note COLUMN, not the pane: while the
  // notes tree is docked into the Sidebar the content insets by its width
  // (useDockInsetStyle on the pages), so the attached region insets the same
  // amount — otherwise the tray hangs left of the column it belongs to. Same
  // transition as the content inset so they move together.
  const { dockRequested, contextOpen } = useContextPanel();
  const trayInset = dockRequested && contextOpen ? CONTEXT_PANEL_W : 0;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  // Transitions are ARMED only after the bar's first frame is on screen. This bar
  // mounts mid-navigation (the Directory's Grid/Context bar unmounts and this one
  // takes its place at the identical position), and an unarmed first frame is what
  // makes that read as one continuous bar: without it the indicator slides out
  // from width 0 and the attached toolbar row unfolds from 0fr, so the bar plays
  // an entrance animation the user sees as a flash. Once armed, a real tab change
  // animates as designed.
  const [armed, setArmed] = useState(false);
  const motion = armed ? `transition-all ${TAB_MOTION}` : '';

  // The underline rect of the pane-top bar this one just replaced, claimed once
  // at mount. Null outside a fresh navigation, and for un-keyed bars.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(handoffKey);

  // Measure BEFORE paint, so the underline is already sitting under the active tab
  // on that first frame rather than being placed a frame later.
  useLayoutEffect(() => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
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
  }, [activeTab, tabs, handoff, handoffKey, firstMeasure]);

  // One frame later the measured position is painted, so turning transitions on
  // now can't retroactively animate it.
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % tabs.length;
      onTabChange(tabs[next].id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[prev].id);
      tabRefs.current[prev]?.focus();
    }
  }

  return (
    <div className={`sticky ${stickyTop} ${edgeClass}`}>
      {/* -ml-6 bleeds the bar left into <main>'s 24px gutter so its bottom
          border starts at the sidebar's right edge (continuing the navbar seam).
          No pl-6 to push the content back: the tab row hugs the sidebar too
          (its own small paddings are the only offset). The gutter is padding on
          the scrollport, not overflow, so nothing is clipped.
          Border + background live on the TAB ROW alone — the attached region
          below is transparent, so the toolbar tray it hosts reads as a pill
          hanging off the nav line with the page visible beside it, not as a
          second full-width bar. */}
      {/* Tabs pinned to the pane's far left, next to the sidebar and out of the
          way of the centred content column below (the attached region centres
          its toolbar tray over that column, NoteEditor). The tablist keeps
          flex-1 so it spans the row —
          a shrink-to-fit box with overflow-x-auto grows a stray scrollbar. */}
      <div className="flex w-full items-center border-b border-border-subtle bg-surface-1 px-1">
        <div
          role="tablist"
          aria-label={ariaLabel}
          className="relative flex flex-1 overflow-x-auto"
        >
          {tabs.map((tab, idx) => (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[idx] = el; }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`px-4 h-12 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none ${
                handoff ? 'tabbar-label-enter' : ''
              } ${
                activeTab === tab.id
                  ? 'text-brand-black'
                  : 'text-brand-grey hover:text-brand-black'
              }`}
            >
              {tab.label}
            </button>
          ))}

          {/* Animated green underline indicator */}
          <div
            className={`absolute bottom-0 h-0.5 bg-brand-green ${motion}`}
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </div>
      </div>

      {/* The attached region. Always mounted — a conditional mount would snap
          open with no transition — and animated 0fr↔1fr on the same const as the
          indicator, off the same tab state, so the pair moves as one gesture.
          The host reserves its full h-12 from the first frame, so a toolbar
          tray that only arrives once its data lands drops in without shifting
          the content below.
          Transparent and centred: whatever portals in (NoteEditor's tray)
          brings its own pill chrome and shrinks to its content, with the page
          showing through on either side.
          Unarmed on the first frame (see `armed`): a bar that mounts already-open
          must START open, not unfold into place. */}
      <div
        className={`grid ${
          armed ? `transition-[grid-template-rows] ${TAB_MOTION}` : ''
        } motion-reduce:transition-none ${
          attachedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* The host translates -100% in step with the row collapsing above it,
              on the same duration/curve, so its bottom edge tracks the closing
              edge exactly: the tray visibly SLIDES up behind the tab row and
              drops back down from under it, rather than standing still while
              the shrinking row wipes it from the bottom. Unarmed first frame:
              no transform transition, so a bar that mounts open/closed starts
              there without playing the slide. */}
          <div
            ref={setHost}
            className={`flex items-start justify-center motion-reduce:[transition:none!important] ${
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
