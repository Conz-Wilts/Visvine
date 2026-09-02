'use client';

import React from 'react';
import { SHELL_PANE_TOP, SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';

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
const PANE_CHROME_PX = SHELL_TOP_BAR_H + SHELL_PANE_TOP + 24; // band, top inset, main's pb-6
const PANEL_PADDING_PX = 24 + 40; // the tab panel's pt-6 + pb-10
const ENTRANCE_SHIFT_PX = 24; // profile-enter's translateY(18px), plus slack
const SKELETON_MAX_H = `calc(100dvh - ${PANE_CHROME_PX + PANEL_PADDING_PX + ENTRANCE_SHIFT_PX}px)`;

/**
 * Loading placeholder mirroring ProfilePageContent's layout: an identity hero
 * (avatar card + identity card) above a two-column body (main section cards +
 * sticky rail). Kept structurally in sync so the page doesn't jump on load.
 */
export default function ProfileSkeletonLoader(_props: ProfileSkeletonLoaderProps) {
  return (
    <div
      className="flex flex-col gap-5 overflow-hidden animate-pulse"
      style={{ maxHeight: SKELETON_MAX_H }}
    >
      {/* ══ IDENTITY HERO — avatar + identity block ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* avatar card */}
        <div className="w-48 h-48 sm:w-60 flex-none rounded-lg bg-surface-3" />

        {/* identity card */}
        <section className="flex-1 min-w-0 py-1 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto pb-5">
            {/* identity */}
            <div className="min-w-0 flex-1 space-y-3">
              <div className={`h-8 w-56 ${block}`} />          {/* name */}
              <div className={`h-4 w-72 max-w-full ${block}`} /> {/* headline */}
              <div className="flex flex-wrap gap-4 pt-1">
                <div className={`h-4 w-28 ${block}`} />          {/* location */}
                <div className={`h-4 w-24 ${block}`} />          {/* website */}
                <div className={`h-4 w-28 ${block}`} />          {/* joined */}
              </div>
            </div>
            {/* actions */}
            <div className="flex items-center gap-2 flex-none">
              <div className="h-10 w-24 rounded-xl bg-surface-3" />
              <div className="h-10 w-28 rounded-xl bg-surface-3" />
            </div>
          </div>

          {/* stat strip */}
          <div className="flex flex-wrap gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <div className={`h-9 w-16 ${block}`} />
            <div className={`h-9 w-14 ${block}`} />
            <div className={`h-9 w-14 ${block}`} />
          </div>
        </section>
      </div>

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

          {/* Skills */}
          <SkeletonCard>
            <div className="flex flex-wrap gap-2">
              {[16, 24, 20, 14, 28, 18].map((w, i) => (
                <div key={i} className="h-8 rounded-full bg-surface-3" style={{ width: `${w * 4}px` }} />
              ))}
            </div>
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
    <section className="border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className={`h-5 w-32 mb-4 ${block}`} />
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
