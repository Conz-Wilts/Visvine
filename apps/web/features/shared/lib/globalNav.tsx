import type { ReactNode } from 'react';
import { CompassIcon, NewspaperIcon } from '@/features/shared/icons';

/**
 * The rail's top group — the surfaces that are yours rather than the space's:
 * the feed of every space you are in, and the list of the spaces themselves.
 *
 * They are NOT feature keys: no space switches them off, they carry no
 * per-space config and they do not appear in the console's order editor. That
 * is why they live here and not in `features.tsx` — the registry there is the
 * set of things a space builder decides about, and mixing these into it would
 * hand a space the power to hide the way out of itself.
 *
 * The Directory is NOT one of them: it is the space's own front page, so it
 * stays a feature key and leads the nav band below.
 */
export interface GlobalNavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
}

// The registry's own size: the rail scales every glyph to 28px itself, so the
// top group is drawn exactly like the tool rows below it.
const iconClass = 'h-5 w-5 shrink-0';

export const GLOBAL_NAV: GlobalNavItem[] = [
  {
    key: 'feed',
    label: 'Feed',
    href: '/feed',
    icon: <NewspaperIcon className={iconClass} />,
  },
  {
    key: 'discover',
    label: 'Discover',
    href: '/discover',
    icon: <CompassIcon className={iconClass} />,
  },
];

/** The keys the top group owns, so the space's nav below never repeats one. */
export const GLOBAL_NAV_KEYS: ReadonlySet<string> = new Set(GLOBAL_NAV.map((item) => item.key));
