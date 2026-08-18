'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { defaultLandingHref } from '@/features/shared/lib/features';
import type { SpaceFeatureConfig } from '@/lib/types';

/**
 * Landing resolver. Every "enter the app" redirect points here rather than at a
 * hard-coded surface, because the tab a member lands on is whichever one the
 * admin dragged to the top of the console's Features list.
 *
 * This has to be a client route: the current space lives in localStorage
 * (features/shared/contexts/SpaceContext.tsx), so the server-side redirects that send
 * users here (login, OAuth callbacks, invite accept) have no way to
 * know the space — let alone its feature config — at redirect time.
 */
export default function HomePage() {
  const { currentSpace, loading, isAdmin } = useSpace();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // No space resolved yet (a user who has joined nothing) — the directory
    // is core, so it's the one surface guaranteed to exist.
    if (!currentSpace) {
      router.replace('/directory');
      return;
    }
    const config = (currentSpace.featureConfig as SpaceFeatureConfig | undefined) ?? null;
    router.replace(defaultLandingHref(config, isAdmin, currentSpace.installedTools));
  }, [currentSpace, loading, isAdmin, router]);

  return (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center text-sm text-text-muted">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Opening your space…
    </div>
  );
}
