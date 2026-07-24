'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useTabBarSlot } from '@/lib/contexts/TabBarSlotContext';

export type ProfileTab = 'about' | 'connections' | 'communities' | 'context' | 'raw' | 'preview';

// One motion for everything the bar does on a tab change: the indicator slides
// and the attached region opens on the same render, so they must share a curve
// and duration to read as a single gesture. Keep them on this const.
const TAB_MOTION = 'duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]';

export interface TabConfig {
  id: ProfileTab;
  label: string;
  count?: number;
}

function getTabsForType(
  nodeType: string,
  connectionCount: number,
  communityCount: number,
  showContextTab: boolean
): TabConfig[] {
  const aboutTab: TabConfig = { id: 'about', label: 'About' };

  const typeTabLabels: Record<string, string> = {
    People: 'Connections',
    Startup: 'Team',
    Organization: 'Members',
    Event: 'Attendees',
    Group: 'Members',
    Investor: 'Portfolio',
  };

  const connectionsLabel = typeTabLabels[nodeType] ?? 'Connections';
  const connectionsTab: TabConfig = {
    id: 'connections',
    label: `${connectionsLabel} (${connectionCount})`,
  };

  const communitiesTab: TabConfig = {
    id: 'communities',
    label: `Communities (${communityCount})`,
  };

  const noCommunitiesTypes = new Set(['Event']);
  const tabs: TabConfig[] = [aboutTab];

  // Context sits right after About: an entity's notes are a first-class facet
  // of its profile, not an afterthought behind the connection lists.
  if (showContextTab) {
    tabs.push({ id: 'context', label: 'Context' });
  }

  tabs.push(connectionsTab);

  if (!noCommunitiesTypes.has(nodeType) && communityCount > 0) {
    tabs.push(communitiesTab);
  }

  return tabs;
}

interface ProfileTabBarProps {
  nodeType: string;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  connectionCount?: number;
  communityCount?: number;
  /** Append a Context tab to the type-derived tab set (entity nodes only). */
  showContextTab?: boolean;
  /** Explicit tab set, overriding getTabsForType — used by the person profile
   *  for its two-tab Profile | Context header. */
  tabs?: TabConfig[];
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
   *  Directory's Grid/Graph/Tables bar uses — instead of starting at the tree's
   *  right edge and leaving the tree's top-left corner bare. */
  edgeClass?: string;
}

export default function ProfileTabBar({
  nodeType,
  activeTab,
  onTabChange,
  connectionCount = 0,
  communityCount = 0,
  showContextTab = false,
  tabs: tabsOverride,
  stickyTop = 'top-20',
  attachedOpen = false,
  edgeClass = '-ml-6 z-20',
}: ProfileTabBarProps) {
  const { setHost } = useTabBarSlot();
  const tabs = useMemo(
    () =>
      tabsOverride ??
      getTabsForType(nodeType, connectionCount, communityCount, showContextTab),
    [tabsOverride, nodeType, connectionCount, communityCount, showContextTab]
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Compute indicator position
  useEffect(() => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    const btn = tabRefs.current[idx];
    if (btn) {
      setIndicatorStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  }, [activeTab, tabs]);

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
    <div className={`sticky ${stickyTop} ${edgeClass} border-b border-border-subtle bg-surface-1`}>
      {/* -ml-6 bleeds the bar left into <main>'s 24px gutter so its bottom
          border starts at the sidebar's right edge (continuing the navbar seam).
          No pl-6 to push the content back: the tab row and the attached toolbar
          hug the sidebar too (their own small paddings are the only offset).
          The gutter is padding on the scrollport, not overflow, so nothing is
          clipped.
          That border is the ONLY line under the bar, attached region included —
          it travels down because this box grows, not because a second bar with
          its own line appears. */}
      {/* Tabs pinned to the pane's far left, next to the sidebar and out of the
          way of the centred content column below (the attached toolbar row
          left-aligns to match). The tablist keeps flex-1 so it spans the row —
          a shrink-to-fit box with overflow-x-auto grows a stray scrollbar. */}
      <div className="flex w-full items-center px-1">
        <div
          role="tablist"
          aria-label="Profile sections"
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
            className={`absolute bottom-0 h-0.5 bg-brand-green transition-all ${TAB_MOTION}`}
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        </div>
      </div>

      {/* The attached region. Always mounted — a conditional mount would snap
          open with no transition — and animated 0fr↔1fr on the same const as the
          indicator, off the same tab state, so the pair moves as one gesture.
          The host reserves its full h-12 from the first frame, so a portalled
          bar that only arrives once its data lands drops in without shifting the
          line that just travelled down to meet it. */}
      <div
        className={`grid transition-[grid-template-rows] ${TAB_MOTION} motion-reduce:transition-none ${
          attachedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div ref={setHost} className="h-12" />
        </div>
      </div>
    </div>
  );
}
