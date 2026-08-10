'use client';

import React from 'react';

interface ProfileSkeletonLoaderProps {
  /** Retained for API compatibility; the profile only renders one full layout. */
  mode?: 'sidebar' | 'fullpage';
}

const block = 'rounded bg-surface-3';

/**
 * Loading placeholder mirroring ProfilePageContent's layout: an identity hero
 * (avatar card + identity card) above a two-column body (main section cards +
 * sticky rail). Kept structurally in sync so the page doesn't jump on load.
 */
export default function ProfileSkeletonLoader(_props: ProfileSkeletonLoaderProps) {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      {/* ══ IDENTITY HERO — avatar card + identity card ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* avatar card */}
        <div className="w-48 h-48 sm:w-60 flex-none rounded-2xl bg-surface-3 border border-border-subtle" />

        {/* identity card */}
        <section className="flex-1 min-w-0 bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 sm:px-8 py-5 sm:py-6 flex flex-col">
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

/** A floating section card matching SectionCard/RailCard chrome, with a title bar. */
function SkeletonCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft p-5 sm:p-6">
      <div className={`h-5 w-32 mb-4 ${block}`} />
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
