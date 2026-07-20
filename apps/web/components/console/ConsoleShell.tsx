'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import SaveStatus from '@/components/ui/SaveStatus';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { ConsoleSaveProvider, useConsoleSave } from './ConsoleSaveContext';

/**
 * Settings shell for the Community Console: header with the shared save
 * indicator and the active section's content pane. Section state lives in the
 * URL (`?section=members`) so it deep-links and survives refresh.
 *
 * On wide viewports the grouped section list docks INTO the global Sidebar —
 * the same portal host the /context notes tree and /channels list use — so the
 * icon rail + section list read as one connected card. Below the dock width it
 * falls back to a horizontal pill row above the content.
 *
 * Must be rendered inside a `<Suspense>` boundary (uses `useSearchParams`).
 */

// ≥1024px: dock the section list into the Sidebar (must match DOCK_MIN_WIDTH
// in Sidebar.tsx). The Sidebar's panel column is ADMIN_PANEL_W = 260 there.
const DOCK_MIN_WIDTH = 1024;

export interface ConsoleSection {
  id: string;
  label: string;
  /** Nav group heading, e.g. "Settings", "People". Groups render in first-seen order. */
  group: string;
  /** Icon shown in the row's leading badge (size 18 works best). */
  icon: React.ReactNode;
  /** One-line summary shown under the label in the docked nav. */
  description: string;
  /** Count badge shown next to the label (hidden when 0/undefined). */
  badge?: number;
  /** 'form' constrains the pane to a comfortable form width; 'wide' uses the full pane. */
  width: 'form' | 'wide';
}

interface ConsoleShellProps {
  sections: ConsoleSection[];
  renderSection: (id: string) => React.ReactNode;
}

function CountBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function HeaderSaveStatus() {
  const { status, retry } = useConsoleSave();
  return <SaveStatus status={status} onRetry={retry} />;
}

export default function ConsoleShell({ sections, renderSection }: ConsoleShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { host } = useContextPanel();
  const { theme, isDark } = useTheme();

  // Track the Sidebar's dock breakpoint so both sides flip together.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const dockNav = wide && Boolean(host);

  const requested = searchParams.get('section');
  const active = sections.some((s) => s.id === requested) ? (requested as string) : sections[0].id;
  const activeSection = sections.find((s) => s.id === active)!;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, ConsoleSection[]>();
    for (const s of sections) {
      if (!byGroup.has(s.group)) {
        byGroup.set(s.group, []);
        order.push(s.group);
      }
      byGroup.get(s.group)!.push(s);
    }
    return order.map((g) => ({ name: g, items: byGroup.get(g)! }));
  }, [sections]);

  const select = (id: string) => {
    router.replace(`${pathname}?section=${id}`, { scroll: false });
  };

  // The grouped section list, rendered into the Sidebar's docked panel — styled
  // like the /context notes tree and /channels list that share this host.
  const dockedNav = dockNav && host
    ? createPortal(
        <div
          data-tour="console-tabs"
          className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface-1 px-3 py-4"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          <div className="mb-4 px-4 text-sm font-bold text-text-primary">Community Console</div>
          <nav aria-label="Console sections">
            {groups.map((group) => (
              <div key={group.name} className="mb-5 last:mb-0">
                <div className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {group.name}
                </div>
                <ul className="space-y-1">
                  {group.items.map((s) => {
                    const isActive = s.id === active;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => select(s.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150"
                          style={{
                            background: isActive ? (isDark ? theme.accentLightDark : theme.accentLight) : 'transparent',
                            color: isActive ? theme.accentDark : undefined,
                          }}
                        >
                          <span
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
                            style={{
                              background: isActive ? theme.accent : undefined,
                              color: isActive ? 'white' : undefined,
                            }}
                          >
                            <span className={isActive ? '' : 'text-text-muted'}>{s.icon}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={clsx('truncate text-sm font-medium', !isActive && 'text-text-secondary')}>
                              {s.label}
                            </p>
                            <p className={clsx('truncate text-[10px] opacity-70', !isActive && 'text-text-muted')}>
                              {s.description}
                            </p>
                          </div>
                          <CountBadge count={s.badge} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>,
        host,
      )
    : null;

  return (
    <ConsoleSaveProvider>
      {dockedNav}
      {/* When the section list is docked into the Sidebar, pad left so the content
          clears the docked card (260px panel + 12px gutter — keep in sync with
          ADMIN_PANEL_W in Sidebar.tsx). */}
      <div
        className={clsx('w-full', dockNav && 'pl-[272px]')}
        style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
      >
      <div className="w-full max-w-[1600px] mx-auto pt-4 pb-10 px-6 sm:px-8">

        {/* Narrow fallback: horizontally scrollable pill row above the content */}
        {!dockNav && (
          <nav
            data-tour="console-tabs"
            className="-mx-6 mb-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Console sections"
          >
            {sections.map((s) => {
              const isActive = s.id === active;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => select(s.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                  style={{
                    background: isActive ? (isDark ? theme.accentLightDark : theme.accentLight) : undefined,
                    color: isActive ? theme.accentDark : undefined,
                  }}
                >
                  <span className={isActive ? '' : 'text-text-muted'}>{s.icon}</span>
                  <span className={isActive ? '' : 'text-text-secondary'}>{s.label}</span>
                  <CountBadge count={s.badge} />
                </button>
              );
            })}
          </nav>
        )}

        {/* Compact profile-style heading: active section + autosave status */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Community Console</p>
            <h1 className="text-lg font-bold text-text-primary">{activeSection.label}</h1>
            <p className="text-xs text-text-muted mt-0.5">{activeSection.description}</p>
          </div>
          <div className="pt-1 shrink-0">
            <HeaderSaveStatus />
          </div>
        </header>

        <main className="min-w-0">
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
