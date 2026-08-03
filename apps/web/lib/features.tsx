import type { ReactNode } from 'react';
import type { CommunityFeatureConfig } from '@/lib/types';
import { NAV_HIDDEN_FEATURE_KEYS, canAccessFeature, moreFeatureKeys, sortFeatureKeys } from '@/lib/featureAccess';

// Pure access logic lives in lib/featureAccess.ts (no JSX) so server routes and
// tests can import it without this module's icons. Re-exported here so UI code
// keeps a single import point.
export {
  ADMIN_ONLY_FEATURE_KEYS,
  NAV_HIDDEN_FEATURE_KEYS,
  isFeatureEnabled,
  adminOnlyFeatureKeys,
  canAccessFeature,
  featureNodeTypeNames,
  moreFeatureKeys,
  sortFeatureKeys,
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
    description: 'A searchable grid of everyone and everything in the community.',
    core: true,
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    key: 'notes',
    label: 'Context',
    href: '/context',
    description: 'An interactive context map of the community, plus shared notes and a Context tab on every person and community profile.',
    // Always on and nav-less: surfaced as the Context tab under the Directory, not
    // its own sidebar rail item or a toggleable tool. See NAV_HIDDEN_FEATURE_KEYS.
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
    // Always on and nav-less: events are reached from the calendar button in the
    // global navbar, not a sidebar rail item, so there is nothing to toggle or
    // reorder per community. See NAV_HIDDEN_FEATURE_KEYS.
    core: true,
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'tasks',
    label: 'Tasks',
    href: '/tasks',
    description: 'A kanban board for planning and tracking the community’s work.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m8.5 12 2.5 2.5L16 9" />
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
    key: 'connectors',
    label: 'Connectors',
    href: '/connectors',
    description: 'Gateways to external APIs and databases that agents can call.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 01-10 0V8zM12 17v4" />
      </svg>
    ),
  },
  {
    key: 'messages',
    label: 'Messages',
    href: '/messages',
    description: 'Direct messages and group chats.',
    core: true,
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
];

/** Sort a filtered feature list into the community's configured display order. */
function inConfiguredOrder(
  config: CommunityFeatureConfig | null | undefined,
  features: FeatureDef[],
): FeatureDef[] {
  const keys = sortFeatureKeys(config, features.map((f) => f.key));
  return keys.map((key) => features.find((f) => f.key === key)!);
}

/** The features a given user should see in the nav, in the configured order. */
function visibleFeatures(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): FeatureDef[] {
  return inConfiguredOrder(config, FEATURES.filter((f) => canAccessFeature(config, f.key, isAdmin)));
}

/**
 * The nav features split between the sidebar rail and its "More" popup. Both
 * lists exclude nav-hidden features (messages, notes, events — all reached from
 * the top navbar or the Directory rather than the rail) and keep the configured display
 * order; `more` membership comes from `featureConfig.more`.
 */
function navFeatures(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): FeatureDef[] {
  return visibleFeatures(config, isAdmin).filter((f) => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key));
}

/** The features a given user sees as sidebar rail rows, in configured order. */
export function railFeatures(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): FeatureDef[] {
  const more = moreFeatureKeys(config);
  return navFeatures(config, isAdmin).filter((f) => !more.includes(f.key));
}

/** The features a given user sees inside the "More" popup, in configured order. */
export function moreFeatures(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): FeatureDef[] {
  const more = moreFeatureKeys(config);
  return navFeatures(config, isAdmin).filter((f) => more.includes(f.key));
}

/**
 * Where a user lands when they enter a community: the first rail tab they can
 * actually see, else the first "More" tool if everything's tucked away. Falls
 * back to the directory — it's core, so the only way to have no visible tab at
 * all is an admins-only directory seen by a member with every other feature
 * switched off.
 */
export function defaultLandingHref(
  config: CommunityFeatureConfig | null | undefined,
  isAdmin: boolean,
): string {
  return railFeatures(config, isAdmin)[0]?.href ?? moreFeatures(config, isAdmin)[0]?.href ?? '/directory';
}
