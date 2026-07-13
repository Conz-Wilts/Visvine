'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';

export type ProfileTab = 'about' | 'connections' | 'communities' | 'activity' | 'context';

export interface TabConfig {
  id: ProfileTab;
  label: string;
  count?: number;
}

function getTabsForType(
  nodeType: string,
  connectionCount: number,
  communityCount: number,
  activityCount: number,
  showContextTab: boolean
): TabConfig[] {
  const aboutTab: TabConfig = { id: 'about', label: 'About' };
  const activityTab: TabConfig = { id: 'activity', label: 'Activity' };

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

  const noCommunitiesTypes = new Set(['Event', 'Group']);
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

  if (activityCount >= 3) {
    tabs.push(activityTab);
  }

  return tabs;
}

interface ProfileTabBarProps {
  nodeType: string;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  connectionCount?: number;
  communityCount?: number;
  activityCount?: number;
  /** Append a Context tab to the type-derived tab set (entity nodes only). */
  showContextTab?: boolean;
  /** Explicit tab set, overriding getTabsForType — used by the person profile
   *  for its two-tab Profile | Context header. */
  tabs?: TabConfig[];
  /** Override sticky offset — defaults to top-20 (80px navbar). Pass 'top-0' for full-screen mode. */
  stickyTop?: string;
}

export default function ProfileTabBar({
  nodeType,
  activeTab,
  onTabChange,
  connectionCount = 0,
  communityCount = 0,
  activityCount = 0,
  showContextTab = false,
  tabs: tabsOverride,
  stickyTop = 'top-20',
}: ProfileTabBarProps) {
  const tabs = useMemo(
    () =>
      tabsOverride ??
      getTabsForType(nodeType, connectionCount, communityCount, activityCount, showContextTab),
    [tabsOverride, nodeType, connectionCount, communityCount, activityCount, showContextTab]
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
    <div
      className={`sticky ${stickyTop} z-20 bg-surface-1 border-b border-border-subtle`}
      style={{ scrollPaddingTop: '128px' }}
    >
      <div
        role="tablist"
        aria-label="Profile sections"
        className="relative flex overflow-x-auto"
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
          className="absolute bottom-0 h-0.5 bg-brand-green transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
        />
      </div>
    </div>
  );
}
