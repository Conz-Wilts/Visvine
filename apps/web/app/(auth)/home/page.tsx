'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { defaultLandingHref } from '@/lib/features';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * Landing resolver. Every "enter the app" redirect points here rather than at a
 * hard-coded surface, because the tab a member lands on is whichever one the
 * admin dragged to the top of the console's Features list.
 *
 * This has to be a client route: the current community lives in localStorage
 * (lib/contexts/CommunityContext.tsx), so the server-side redirects that send
 * users here (login, OAuth callbacks, invite accept) have no way to
 * know the community — let alone its feature config — at redirect time.
 */
export default function HomePage() {
  const { currentCommunity, loading, isAdmin } = useCommunity();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // No community resolved yet (a user who has joined nothing) — the directory
    // is core, so it's the one surface guaranteed to exist.
    if (!currentCommunity) {
      router.replace('/directory');
      return;
    }
    const config = (currentCommunity.featureConfig as CommunityFeatureConfig | undefined) ?? null;
    router.replace(defaultLandingHref(config, isAdmin));
  }, [currentCommunity, loading, isAdmin, router]);

  return (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center text-sm text-text-muted">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Opening your community…
    </div>
  );
}
