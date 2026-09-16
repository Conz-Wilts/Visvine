'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSpaceHref } from '@/features/shared/contexts/SpaceContext';

/**
 * `useRouter` for the app: `push`, `replace` and `prefetch` put an in-app page
 * href under the current space, the same rule `SpaceLink` follows. Anything
 * else is navigated to as it is.
 */
export function useSpaceRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  const spaceHref = useSpaceHref();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => router.push(spaceHref(href), options),
      replace: (href, options) => router.replace(spaceHref(href), options),
      prefetch: (href, options) => router.prefetch(spaceHref(href), options),
    }),
    [router, spaceHref],
  );
}
