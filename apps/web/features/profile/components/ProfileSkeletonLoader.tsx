'use client';

import React from 'react';
import { useDesktopChrome } from '@/features/desktop/lib/chrome';
import { SHELL_PANE_TOP } from '@/features/shared/contexts/ThemeContext';

interface ProfileSkeletonLoaderProps {
  /** Retained for API compatibility; the profile only renders one full layout. */
  mode?: 'sidebar' | 'fullpage';
}

const block = 'rounded bg-surface-3';

// The placeholder is a fixed stack of blocks, so on a short window it stands
// taller than the surface — and taller than the profile that replaces it. That
// is a scrollbar that appears on arrival and vanishes a moment later, on every
// entity page. Clipping it to what the pane actually offers is what stops it:
// the shell's band and gutters, the tab panel's own padding, and the 18px the
// entrance animation shifts the panel down by (a transform counts towards the
// scroller's overflow), with a few px of slack. Cutting the bottom off a
// placeholder costs nothing — the part being cut is below the fold.
const PANE_CHROME_PX = SHELL_PANE_TOP + 24; // top inset, main's pb-6; the band is added per shell
const PANEL_PADDING_PX = 24 + 40; // the tab panel's pt-6 + pb-10
const ENTRANCE_SHIFT_PX = 24; // profile-enter's translateY(18px), plus slack
const SKELETON_CHROME_PX = PANE_CHROME_PX + PANEL_PADDING_PX + ENTRANCE_SHIFT_PX;

/**
 * Loading placeholder mirroring ProfilePageContent's layout: an avatar-and-identity hero
 * (identity beside the person's spaces) above a two-column body (main section cards +
 * sticky rail). Kept structurally in sync so the page doesn't jump on load.
 */
export default function ProfileSkeletonLoader(_props: ProfileSkeletonLoaderProps) {
  const { bandH } = useDesktopChrome();
  return (
    <div
      className="flex flex-col gap-5 overflow-hidden animate-pulse"
      style={{ maxHeight: `calc(100dvh - ${bandH + SKELETON_CHROME_PX}px)` }}
    >
      {/* ══ IDENTITY HERO — avatar beside identity + spaces ══ */}
      <section className="rounded-2xl border border-border-subtle bg-surface-1 px-5 py-5 shadow-strip sm:px-7 sm:py-7 flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-7">
        <div className="w-44 h-44 sm:w-56 sm:h-56 flex-none rounded-2xl bg-surface-3" />
        <div className="min-w-0 flex-1 flex flex-col lg:flex-row lg:items-start gap-6 sm:pt-2">
          <div className="min-w-0 flex-1 space-y-3">
            <div className={`h-8 w-56 ${block}`} />          {/* name */}
            <div className={`h-5 w-72 max-w-full ${block}`} /> {/* headline */}
            <div className={`h-4 w-80 max-w-full ${block}`} /> {/* location · website · contact */}
            <div className={`h-4 w-16 ${block}`} />          {/* spaces */}
            <div className="flex items-center gap-2 pt-1">   {/* actions */}
              <div className="h-10 w-32 rounded-lg bg-surface-3" />
              <div className="h-10 w-36 rounded-lg bg-surface-3" />
            </div>
          </div>
          <div className="lg:w-72 flex items-center gap-3">  {/* spaces */}
            <div className="w-10 h-10 rounded-lg bg-surface-3" />
            <div className="space-y-1.5">
              <div className={`h-4 w-28 ${block}`} />
              <div className={`h-3 w-24 ${block}`} />
            </div>
          </div>
        </div>
      </section>

      {/* ══ TWO-COLUMN BODY ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5 xl:gap-6">
        {/* MAIN — section cards */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* About */}
          <SkeletonCard>
            <div className={`h-4 w-[85%] ${block}`} />
            <div className={`h-4 w-[92%] ${block}`} />
            <div className={`h-4 w-[60%] ${block}`} />
          </SkeletonCard>

          {/* Experience */}
          <SkeletonCard>
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 flex-none rounded-xl bg-surface-3" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className={`h-4 w-40 ${block}`} />
                  <div className={`h-3.5 w-28 ${block}`} />
                  <div className={`h-3 w-48 ${block}`} />
                </div>
              </div>
            ))}
          </SkeletonCard>
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4">
          {/* Profile strength */}
          <SkeletonCard>
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 flex-none rounded-full bg-surface-3" />
              <div className="flex-1 space-y-2">
                <div className={`h-3.5 w-full ${block}`} />
                <div className={`h-3.5 w-2/3 ${block}`} />
              </div>
            </div>
          </SkeletonCard>

          {/* Contact */}
          <SkeletonCard>
            <div className={`h-4 w-40 ${block}`} />
            <div className={`h-4 w-32 ${block}`} />
            <div className="flex gap-2 pt-1">
              <div className="w-9 h-9 rounded-xl bg-surface-3" />
              <div className="w-9 h-9 rounded-xl bg-surface-3" />
            </div>
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}

/** A section matching SectionCard/RailCard — a title on a hairline, then lines. */
function SkeletonCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-1 px-5 py-5 shadow-strip sm:px-6 sm:py-6">
      <div className={`h-5 w-32 mb-4 ${block}`} />
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
