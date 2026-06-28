import type { ReactNode } from 'react';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * Community feature registry — the single source of truth for the optional
 * surfaces a community builder can switch on or off (directory, context,
 * events, resources). The Sidebar renders its nav items from this list, so
 * the nav and the per-community feature toggles never drift.
 */
export interface FeatureDef {
  key: string;        // stable id stored in Community.featureConfig.enabled
  label: string;
  href: string;
  description: string; // shown on the launcher card
  icon: ReactNode;
}

const iconClass = 'h-5 w-5 shrink-0';

export const FEATURES: FeatureDef[] = [
  {
    key: 'directory',
    label: 'Directory',
    href: '/directory',
    description: 'A searchable graph & table of everyone and everything in the community.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
  },
  {
    key: 'notes',
    label: 'Context',
    href: '/context',
    description: 'Jot down and keep track of your context.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
];

/**
 * Is `key` enabled for a community? A feature is enabled unless
 * `featureConfig.enabled[key]` is explicitly `false` — so existing communities
 * (empty config) keep every surface by default.
 */
export function isFeatureEnabled(config: CommunityFeatureConfig | null | undefined, key: string): boolean {
  const enabled = config?.enabled;
  if (!enabled || enabled[key] === undefined) return true;
  return enabled[key] !== false;
}

/** The features (in registry order) that should appear in the nav for a community. */
export function enabledFeatures(config: CommunityFeatureConfig | null | undefined): FeatureDef[] {
  return FEATURES.filter((f) => isFeatureEnabled(config, f.key));
}
