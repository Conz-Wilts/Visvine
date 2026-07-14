import type { ReactNode } from 'react';
import type { CommunityFeatureConfig } from '@/lib/types';
import { canAccessFeature, isFeatureEnabled } from '@/lib/featureAccess';

// Pure access logic lives in lib/featureAccess.ts (no JSX) so server routes and
// tests can import it without this module's icons. Re-exported here so UI code
// keeps a single import point.
export {
  CORE_FEATURE_KEYS,
  NAV_HIDDEN_FEATURE_KEYS,
  isFeatureEnabled,
  isDirectoryPrivate,
  canAccessFeature,
  sanitizeFeatureConfig,
} from '@/lib/featureAccess';

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
  core?: boolean;      // always on, not toggleable — keep in sync with featureAccess.ts#CORE_FEATURE_KEYS
}

const iconClass = 'h-5 w-5 shrink-0';

export const FEATURES: FeatureDef[] = [
  {
    key: 'directory',
    label: 'Directory',
    href: '/directory',
    description: 'A searchable graph & table of everyone and everything in the community.',
    core: true,
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
    // Context has no page of its own — the key stays toggleable but has no nav
    // item (NAV_HIDDEN_FEATURE_KEYS); it surfaces only as the Context tab on
    // entity profiles. href points at the Directory (where those profiles live)
    // so nothing ever links to a dead route.
    href: '/directory',
    description: 'Community notes and context — a Context tab on every person and organization profile.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
    description: 'Direct messages and warm intro requests.',
    core: true,
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
];

/** The features (in registry order) that should appear in the nav for a community. */
export function enabledFeatures(config: CommunityFeatureConfig | null | undefined): FeatureDef[] {
  return FEATURES.filter((f) => isFeatureEnabled(config, f.key));
}

/** The features (in registry order) a given user should see in the nav. */
export function visibleFeatures(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): FeatureDef[] {
  return FEATURES.filter((f) => canAccessFeature(config, f.key, isAdmin));
}
