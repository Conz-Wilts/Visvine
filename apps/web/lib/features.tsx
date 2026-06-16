import type { ReactNode } from 'react';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * Community feature registry — the single source of truth for the optional
 * surfaces a community builder can switch on or off (directory, channels,
 * events, resources, …). The Sidebar renders nav items from this list and the
 * FeatureLauncher ("apps" grid) renders its toggle cards from it, so the two
 * never drift.
 *
 * A feature marked `core` is always present and cannot be disabled (e.g.
 * Messages — the personal inbox where intros land — is cross-cutting and not
 * tied to a single community's surface choices).
 */
export interface FeatureDef {
  key: string;        // stable id stored in Community.featureConfig.enabled
  label: string;
  href: string;
  description: string; // shown on the launcher card
  icon: ReactNode;
  core?: boolean;      // always on, not toggleable
}

const iconClass = 'h-5 w-5 shrink-0';

export const FEATURES: FeatureDef[] = [
  {
    key: 'directory',
    label: 'Directory',
    href: '/directory',
    description: 'A searchable graph & table of everyone and everything in the community.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    key: 'channels',
    label: 'Channels',
    href: '/channels',
    description: 'A shared feed and topic channels for posts and conversation.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 3L8 21M16 3l-2 18M4 8h16M3 16h16" />
      </svg>
    ),
  },
  {
    key: 'events',
    label: 'Events',
    href: '/events',
    description: 'Create and RSVP to events, manage guests and invitations.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'resources',
    label: 'Resources',
    href: '/resources',
    description: 'A library of shared documents, links and materials.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    key: 'messages',
    label: 'Messages',
    href: '/messages',
    core: true,
    description: 'Direct messages and warm intro requests (always available).',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
];

/** The 9-squares-in-a-square "apps" grid icon used by the More button. */
export function AppsGridIcon({ className = 'h-5 w-5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1.4" />
      <rect x="9.5" y="3" width="5" height="5" rx="1.4" />
      <rect x="16" y="3" width="5" height="5" rx="1.4" />
      <rect x="3" y="9.5" width="5" height="5" rx="1.4" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.4" />
      <rect x="16" y="9.5" width="5" height="5" rx="1.4" />
      <rect x="3" y="16" width="5" height="5" rx="1.4" />
      <rect x="9.5" y="16" width="5" height="5" rx="1.4" />
      <rect x="16" y="16" width="5" height="5" rx="1.4" />
    </svg>
  );
}

/**
 * Is `key` enabled for a community? Core features are always on. Otherwise a
 * feature is enabled unless `featureConfig.enabled[key]` is explicitly `false`
 * — so existing communities (empty config) keep every surface by default.
 */
export function isFeatureEnabled(config: CommunityFeatureConfig | null | undefined, key: string): boolean {
  const feature = FEATURES.find((f) => f.key === key);
  if (feature?.core) return true;
  const enabled = config?.enabled;
  if (!enabled || enabled[key] === undefined) return true;
  return enabled[key] !== false;
}

/** The features (in registry order) that should appear in the nav for a community. */
export function enabledFeatures(config: CommunityFeatureConfig | null | undefined): FeatureDef[] {
  return FEATURES.filter((f) => isFeatureEnabled(config, f.key));
}
