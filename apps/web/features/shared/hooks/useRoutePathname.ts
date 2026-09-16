'use client';

import { usePathname } from 'next/navigation';
import { stripSpacePrefix } from '@/lib/spaces/shared/spaceUrl';

/**
 * The route being rendered, without the space it is rendered in:
 * `/s/acme/growth/channels/c1` reads `/channels/c1`. What a check of "which
 * page is this" wants; a URL built to stay on this page wants `usePathname`.
 */
export function useRoutePathname(): string {
  return stripSpacePrefix(usePathname() ?? '');
}
