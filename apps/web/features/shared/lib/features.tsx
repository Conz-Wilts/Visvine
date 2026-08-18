import type { ReactNode } from 'react';
import type { SpaceFeatureConfig } from '@/lib/types';
import type { InstalledToolDto } from '@/lib/tools/installs';
import { navFeatureKeys } from '@/lib/featureAccess';
import { toolRailRows, type ToolRailRow } from '@/features/tools/lib/railRows';
import ToolIcon from '@/features/tools/components/toolIcons';

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
  isToolRailKey,
  moreFeatureKeys,
  sortFeatureKeys,
  toolRailKey,
} from '@/lib/featureAccess';

/**
 * Space feature registry — the single source of truth for the optional
 * surfaces a space builder can switch on or off (directory, context,
 * events, resources). The Sidebar renders its nav items from this list, so
 * the nav and the per-space feature toggles never drift.
 */
export interface FeatureDef {
  key: string;        // stable id stored in Space.featureConfig.enabled
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
    description: 'A searchable grid of everyone and everything in the space.',
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
    href: '/directory/note/index.md',
    description: 'A browsable knowledge base of the space — folders, notes and their connections, plus a Context tab on every person and space profile.',
    // Always on and nav-less: reached from the Directory and from profiles, not
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
    // reorder per space. See NAV_HIDDEN_FEATURE_KEYS.
    core: true,
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
    key: 'agents',
    label: 'Agents',
    href: '/agents',
    description: 'Scheduled agents that run from your context, call connectors, and write notes back.',
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="11" rx="2" />
        <path d="M12 3v5M9 13h.01M15 13h.01M9 17h6" />
      </svg>
    ),
  },
  {
    key: 'tools',
    label: 'Tools',
    href: '/tools',
    description: 'Tools built by members and installed from the marketplace.',
    // Nav-less: the marketplace is reached from the navbar icon, and each
    // INSTALLED Tool gets its own rail row keyed `tool:<slug>` — so this key is
    // the tool vocabulary itself, never a "Tools" rail item. It is here so the
    // console's Tools panel can switch the surface (and the Tool node type with
    // it) on and off like any other. See NAV_HIDDEN_FEATURE_KEYS.
    icon: (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 5.5a3.5 3.5 0 004.9 4.2l-9.7 9.7a2.1 2.1 0 01-3-3l9.7-9.7a3.5 3.5 0 01-1.9-1.2z" />
        <path d="M15.2 4.3l4.5 4.5" />
      </svg>
    ),
  },
];

/**
 * An installed Tool's rail row as a `FeatureDef` — the same shape a built-in
 * produces, which is the whole trick: the rail, the "More" popup and the
 * console's order editor need no special case for Tools at all, and a
 * `tool:<slug>` key sorts, tucks away and locks exactly like `resources`.
 *
 * Which installs get a row is `toolRailRows`' decision; this only adds the icon
 * and the sentence the console's picker shows.
 */
function toolFeature(row: ToolRailRow): FeatureDef {
  return {
    key: row.key,
    label: row.label,
    href: row.href,
    description: `${row.title} — a tool installed in this space.`,
    icon: <ToolIcon name={row.icon} />,
  };
}

/** The rail rows a space's installed Tools contribute, in install order. */
export function toolFeatures(
  installedTools: readonly InstalledToolDto[] | null | undefined,
): FeatureDef[] {
  return toolRailRows(installedTools).map(toolFeature);
}

/**
 * The nav rows, split between the sidebar rail and its "More" popup.
 *
 * Which keys and in what order is `navFeatureKeys`' decision (lib/featureAccess.ts —
 * pure, and where the tests reach it); this only maps them back to rows. Every
 * key it returns is either a registry key or one of the tool rows passed in, so
 * the lookup always resolves.
 */
function navFeatures(
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
  installedTools: readonly InstalledToolDto[] | null | undefined,
): { rail: FeatureDef[]; more: FeatureDef[] } {
  const tools = toolFeatures(installedTools);
  const rows = new Map([...FEATURES, ...tools].map((f) => [f.key, f]));
  const keys = navFeatureKeys(config, isAdmin, tools.map((f) => f.key));
  const resolve = (list: string[]) => list.map((key) => rows.get(key)!).filter(Boolean);
  return { rail: resolve(keys.rail), more: resolve(keys.more) };
}

/** The features a given user sees as sidebar rail rows, in configured order. */
export function railFeatures(
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
  installedTools?: readonly InstalledToolDto[] | null,
): FeatureDef[] {
  return navFeatures(config, isAdmin, installedTools).rail;
}

/** The features a given user sees inside the "More" popup, in configured order. */
export function moreFeatures(
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
  installedTools?: readonly InstalledToolDto[] | null,
): FeatureDef[] {
  return navFeatures(config, isAdmin, installedTools).more;
}

/**
 * Where a user lands when they enter a space: the first rail tab they can
 * actually see, else the first "More" tool if everything's tucked away. Falls
 * back to the directory — it's core, so the only way to have no visible tab at
 * all is an admins-only directory seen by a member with every other feature
 * switched off.
 */
export function defaultLandingHref(
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
  installedTools?: readonly InstalledToolDto[] | null,
): string {
  return (
    railFeatures(config, isAdmin, installedTools)[0]?.href ??
    moreFeatures(config, isAdmin, installedTools)[0]?.href ??
    '/directory'
  );
}
