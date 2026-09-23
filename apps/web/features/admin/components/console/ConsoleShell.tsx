'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { clsx } from 'clsx';
import SaveStatus from './SaveStatus';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff, TAB_MOTION } from '@visvine/ui';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import { ConsoleSaveProvider, useConsoleSave } from './ConsoleSaveContext';

/**
 * Settings shell for the Space Console: the section tabs with the active
 * section's content below them. Section state lives in the URL
 * (`?section=members`) so it deep-links and survives refresh.
 *
 * The tabs ride the shell's top band, portalled into it the way the Directory,
 * notes and profiles portal theirs (same host, row height, underline and
 * handoff key), so moving between those surfaces and the console reads as one
 * bar relabelling itself rather than a second bar appearing under the band.
 * The autosave state goes to the band's trailing host beside the account
 * button. Outside the shell (no host) the bar draws itself where it stands.
 *
 * Must be rendered inside a `<Suspense>` boundary (uses `useSearchParams`).
 */

/** Handoff key shared with the pane-top bars — see tabIndicatorHandoff. */
const HANDOFF_KEY = 'pane-top';

export interface ConsoleSection {
  id: string;
  label: string;
  /** Count badge appended to the tab label (hidden when 0/undefined). */
  badge?: number;
  /** 'form' constrains the pane to a comfortable form width; 'wide' uses the full pane. */
  width: 'form' | 'wide';
}

interface ConsoleShellProps {
  sections: ConsoleSection[];
  renderSection: (id: string) => React.ReactNode;
  /** Tablist label, for the surfaces that aren't the Space Console. */
  ariaLabel?: string;
}

function HeaderSaveStatus() {
  const { status, retry } = useConsoleSave();
  return <SaveStatus status={status} onRetry={retry} />;
}

/** Tabs carry their count inline, the way the profile bar labels
 *  "Connections (12)" — a separate pill would break the underline measuring. */
const tabLabel = (s: ConsoleSection) =>
  s.badge ? `${s.label} (${s.badge > 99 ? '99+' : s.badge})` : s.label;

export default function ConsoleShell({
  sections,
  renderSection,
  ariaLabel = 'Console sections',
}: ConsoleShellProps) {
  const { shellTabsHost, shellTrailHost } = useContextPanel();
  useShellBand(!!shellTabsHost);
  const router = useSpaceRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get('section');
  const active = sections.some((s) => s.id === requested) ? (requested as string) : sections[0].id;
  const activeSection = sections.find((s) => s.id === active)!;

  const select = (id: string) => {
    router.replace(`${pathname}?section=${id}`, { scroll: false });
  };

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  // Transitions arm only once the first frame is painted, so a bar mounting
  // mid-navigation appears finished instead of sliding its underline out from
  // width 0. Same arming as PageTabBar/PaneTabBar.
  const [armed, setArmed] = useState(false);
  const motion = armed ? `transition-all ${TAB_MOTION}` : '';

  // The underline rect of the pane-top bar this one replaced, claimed at mount.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(HANDOFF_KEY);

  const tabsKey = sections.map((s) => `${s.id} ${tabLabel(s)}`).join('|');

  // Measure BEFORE paint so the underline is already under the active tab on
  // the first frame rather than being placed one frame later.
  useLayoutEffect(() => {
    const idx = sections.findIndex((s) => s.id === active);
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
  }, [active, tabsKey, handoff]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % sections.length;
      select(sections[next].id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + sections.length) % sections.length;
      select(sections[prev].id);
      tabRefs.current[prev]?.focus();
    }
  }

  const tablist = (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        shellTabsHost
          ? // Scrolls when the section names outgrow the band, without ever
            // drawing a bar for it (the underline sits on rounded offsets and
            // can overhang by a subpixel).
            'relative flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'relative flex flex-1 overflow-x-auto'
      }
    >
      {sections.map((s, idx) => (
        <button
          key={s.id}
          ref={(el) => { tabRefs.current[idx] = el; }}
          role="tab"
          id={`tab-${s.id}`}
          aria-selected={active === s.id}
          aria-controls={`panel-${s.id}`}
          onClick={() => select(s.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className={`px-4 h-12 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none ${
            handoff ? 'tabbar-label-enter' : ''
          } ${active === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
        >
          {tabLabel(s)}
        </button>
      ))}

      {/* Animated green underline indicator */}
      <div
        className={`absolute bottom-0 ${shellTabsHost ? 'h-[3px]' : 'h-0.5'} bg-accent ${motion}`}
        style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
      />
    </div>
  );

  // Autosave state: in the band it rides the trailing host beside the account
  // button, so it stays visible whatever the page is scrolled to.
  const saveStatus = (
    <div className="shrink-0 px-4">
      <HeaderSaveStatus />
    </div>
  );

  const chrome = shellTabsHost ? (
    <>
      {createPortal(tablist, shellTabsHost)}
      {shellTrailHost && createPortal(saveStatus, shellTrailHost)}
      {/* All that stays in the pane is the painted clearance under the band, so
          the content scrolls behind an opaque strip rather than through the gap
          above it. */}
      <div className="sticky -top-6 -mt-6 -ml-6 z-20">
        <PaneTopScrollbarMask height={0} />
        <div aria-hidden className="h-6 bg-glass" />
      </div>
    </>
  ) : (
    /* Standing on its own: same chrome as the pane-top bars — -ml-6 bleeds into
       <main>'s gutter so the bottom border runs from the rail's seam, and
       "-top-6 -mt-6" cancels <main>'s top pad in flow and in the sticky offset
       so the box sits at the surface's top edge either way. */
    <div className="sticky -top-6 -mt-6 -ml-6 z-20">
      <PaneTopScrollbarMask />
      <div aria-hidden className="h-6 bg-glass" />
      <div className="flex w-full items-center border-b border-line-subtle bg-glass pl-8 pr-1">
        {tablist}
        {saveStatus}
      </div>
    </div>
  );

  return (
    <ConsoleSaveProvider>
      <div className="w-full">
        {chrome}

        {/* <main> supplies no horizontal gutter (see AuthLayoutClient) — the
            content keeps the page's own px. Left-aligned, not centred: on a
            wide pane the content stays anchored to the same left edge as the
            tabs above it. */}
        <div className="w-full max-w-[1600px] pt-10 pb-10 px-6 sm:px-8">
          {/* No page heading — the tab set above already names the active
              section. The heading's absence is why the top padding is larger
              than the bottom gutter's rhythm would suggest: content still needs
              air under the band, just not a restated title. */}
          <main id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`} className="min-w-0">
            {/* 'form' sections get a comfortable single-column width like profile settings. */}
            <div className={clsx(activeSection.width === 'form' && 'max-w-4xl')}>
              {renderSection(active)}
            </div>
          </main>
        </div>
      </div>
    </ConsoleSaveProvider>
  );
}
