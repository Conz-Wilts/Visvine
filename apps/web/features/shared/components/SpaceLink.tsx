'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { useSpaceHref } from '@/features/shared/contexts/SpaceContext';

/**
 * `next/link` for the app: an in-app page href is written under the space
 * being stood in (`/directory` → `/s/acme/directory`), so what the link shows,
 * copies and opens in a new tab is the whole address. Every other href — a
 * page outside spaces, one that already names a space, an external URL — is
 * passed through untouched. See lib/spaces/shared/spaceUrl.ts.
 */
export default function SpaceLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const spaceHref = useSpaceHref();
  return <NextLink href={typeof href === 'string' ? spaceHref(href) : href} {...props} />;
}
