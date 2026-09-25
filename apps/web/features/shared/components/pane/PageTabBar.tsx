'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTabBarSlot } from '@/features/shared/contexts/TabBarSlotContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import { TAB_MOTION } from '@visvine/ui';
import BandTabList from './BandTabList';
import { motion as motionTokens } from '@visvine/tokens';

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
  /** Override the sticky box's placement. The default cancels <main>'s top pad
   *  twice — once in flow ("-mt-6"), once in the sticky offset ("-top-6", which
   *  resolves against <main>'s content box) — so the box sits at the surface's
   *  top edge at rest and pinned, with the clearance above the row painted
   *  inside it rather than left as a gap the page scrolls through. */
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
  stickyTop = '-top-6 -mt-6',
  attachedOpen = false,
  edgeClass = '-ml-6 z-20',
  handoffKey,
}: PageTabBarProps) {
  const { setHost } = useTabBarSlot();
  // The tab row belongs to the shell's top band, beside the account button, so
  // a page's sections and the shell's chrome are one line rather than two
  // stacked bars. What stays in the pane is the painted clearance and the
  // attached toolbar tray, which belong over the content. Outside the shell
  // (no host) the bar draws its own row where it stands.
  const { shellTabsHost } = useContextPanel();
  useShellBand(!!shellTabsHost);
  // The attached tray's own transitions arm once the first frame is painted,
  // so a bar that mounts open STARTS open rather than unfolding into place.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The tab set itself. In the shell it is portalled into the top band, so it
  // carries no border or background of its own — the band is the chrome.
  const tablist = (
    <BandTabList
      tabs={tabs}
      activeId={activeTab}
      onSelect={(id) => onTabChange(id as PageTab)}
      ariaLabel={ariaLabel}
      handoffKey={handoffKey}
      inBand={!!shellTabsHost}
    />
  );

  /* The attached region. Always mounted — a conditional mount would snap
      open with no transition — and animated 0fr↔1fr on the same const as the
      indicator, off the same tab state, so the pair moves as one gesture.
      The host reserves its full height from the first frame, so a toolbar
      tray that only arrives once its data lands drops in without shifting
      the content below.
      Transparent and centred: whatever portals in (NoteEditor's tray)
      brings its own pill chrome and shrinks to its content, with the page
      showing through on either side.
      Unarmed on the first frame (see `armed`): a bar that mounts already-open
     must START open, not unfold into place. */
  const attached = (
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
            edge exactly: the tray visibly SLIDES up behind the nav line and
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
            // `translate`, not `transform`: Tailwind v4's translate-y-*
            // utilities set the standalone CSS translate property.
            transition: armed ? `translate ${motionTokens.duration.base}ms ${motionTokens.easeCss.standard}` : undefined,
          }}
        />
      </div>
    </div>
  );

  // In the shell: the tabs go to the band, and all that is left here is the
  // painted clearance (so the content doesn't scroll through the gap above the
  // tray) and the tray itself.
  if (shellTabsHost) {
    return (
      <>
        {createPortal(tablist, shellTabsHost)}
        <div className={`sticky ${stickyTop} ${edgeClass}`}>
          <div aria-hidden className="h-6 bg-glass" />
          {attached}
        </div>
      </>
    );
  }

  return (
    <div className={`sticky ${stickyTop} ${edgeClass}`}>
      {/* The clearance above the row, painted and part of the sticky box, so
          the band between the surface's top edge and the tabs is opaque when
          the bar is pinned. */}
      <div aria-hidden className="h-6 bg-glass" />

      {/* -ml-6 bleeds the bar left into <main>'s 24px gutter so its bottom
          border starts at the sidebar's right edge; pl-8 puts the first tab's
          label back on that gutter, so the words line up with the content.
          Border + background live on the TAB ROW alone — the attached region
          below is transparent, so the toolbar tray it hosts reads as a pill
          hanging off the nav line with the page visible beside it, not as a
          second full-width bar. */}
      <div className="flex w-full items-center border-b border-line-subtle bg-glass pl-8 pr-1">
        {tablist}
      </div>

      {attached}
    </div>
  );
}
