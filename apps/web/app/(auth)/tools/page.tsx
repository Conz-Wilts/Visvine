'use client';

/**
 * `/tools` — the marketplace, reached from the navbar icon next to the calendar.
 *
 * A thin route: the surface itself is `<Marketplace/>`, which owns the tabs, the
 * fetches and every dialog. The `<Suspense>` boundary is not optional — the tab
 * lives in the URL and `useSearchParams` suspends without one.
 *
 * There is no admin gate here. Every member of a space where Tools are switched
 * on may browse the catalogue and read what their space runs; installing,
 * upgrading and publishing are admin acts, refused by the routes and hidden by
 * the screens. The `tools` feature key itself is enforced two ways — the shell's
 * route guard bounces a member of a space that switched Tools off, and every
 * space-scoped route re-checks it server-side.
 */

import { Suspense } from 'react';
import { LoadingText } from '@/components/ui';
import Marketplace from '@/features/tools/components/marketplace/Marketplace';

export default function ToolsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full px-6 py-8">
          <LoadingText text="Loading tools…" />
        </div>
      }
    >
      <Marketplace />
    </Suspense>
  );
}
