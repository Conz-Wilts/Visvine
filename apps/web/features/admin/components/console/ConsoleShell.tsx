'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import SaveStatus from '@/components/ui/SaveStatus';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff } from '@/components/ui/tabIndicatorHandoff';
import { TAB_MOTION } from '@/components/ui/tabMotion';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';
import { ConsoleSaveProvider, useConsoleSave } from './ConsoleSaveContext';

/**
 * Settings shell for the Space Console: a pane-top tab bar with the active
 * section's content below it. Section state lives in the URL
 * (`?section=members`) so it deep-links and survives refresh.
 *
 * Sections ride the same pane-top tab bar the Directory, notes and profiles use
 * (same bleed, row height, underline and handoff key), so moving between those
 * surfaces and the console reads as one bar relabelling itself.
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
  /** Legacy nav-list fields, no longer rendered by the tab bar. Kept optional so
   *  callers that still pass them keep type-checking. */
  group?: string;
  icon?: React.ReactNode;
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
  const router = useRouter();
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

  return (
    <ConsoleSaveProvider>
      <div className="w-full">
        {/* Same chrome as the pane-top bars: -ml-6 bleeds into <main>'s gutter so
            the bottom border continues the navbar seam, and "-top-4 -mt-4"
            cancels <main>'s pt-4 so the bar pins flush under the navbar. */}
        <div className="sticky -top-4 -mt-4 -ml-6 z-20">
          {/* Keeps the page scrollbar from running up beside the pinned bar. */}
          <PaneTopScrollbarMask />
          <div className="flex w-full items-center border-b border-border-subtle bg-surface-1 px-1">
            <div
              role="tablist"
              aria-label={ariaLabel}
              className="relative flex flex-1 overflow-x-auto"
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
                  } ${
                    active === s.id ? 'text-brand-black' : 'text-brand-grey hover:text-brand-black'
                  }`}
                >
                  {tabLabel(s)}
                </button>
              ))}

              {/* Animated green underline indicator */}
              <div
                className={`absolute bottom-0 h-0.5 bg-brand-green ${motion}`}
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
            </div>

            {/* Autosave state rides the bar so it stays visible while pinned. */}
            <div className="shrink-0 px-4">
              <HeaderSaveStatus />
            </div>
          </div>
        </div>

        {/* <main> supplies no horizontal gutter (see AuthLayoutClient) — the bar
            bleeds into the sidebar seam, the content keeps the page's own px. */}
        <div className="w-full max-w-[1600px] mx-auto pt-6 pb-10 px-6 sm:px-8">
          {/* The tab bar above already names the active section, so the page
              heading is the label alone — no restatement underneath it. */}
          <header className="mb-6">
            <h1 className="text-lg font-bold text-text-primary">{activeSection.label}</h1>
          </header>

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
