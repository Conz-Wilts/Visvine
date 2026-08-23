import type { ReactNode } from 'react';
import type { SpaceFeatureConfig } from '@/lib/types';
import type { InstalledToolDto } from '@/lib/tools/installs';
import { navFeatureKeys } from '@/lib/featureAccess';
import { toolRailRows, type ToolRailRow } from '@/features/tools/lib/railRows';
import ToolIcon from '@/features/tools/components/toolIcons';
import {
  NavDirectoryIcon,
  NavContextIcon,
  NavChannelsIcon,
  NavEventsIcon,
  NavResourcesIcon,
  NavConnectorsIcon,
  NavAgentsIcon,
  NavToolsIcon,
} from '@/features/shared/icons';

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
    icon: <NavDirectoryIcon className={iconClass} />,
  },
  {
    key: 'notes',
    label: 'Context',
    href: '/directory/note/index.md',
    description: 'A browsable knowledge base of the space — folders, notes and their connections, plus a Context tab on every person and space profile.',
    // Always on and nav-less: reached from the Directory and from profiles, not
    // its own sidebar rail item or a toggleable tool. See NAV_HIDDEN_FEATURE_KEYS.
    core: true,
    icon: <NavContextIcon className={iconClass} />,
  },
  {
    key: 'channels',
    label: 'Channels',
    href: '/channels',
    description: 'A shared feed and topic channels for posts and conversation.',
    icon: <NavChannelsIcon className={iconClass} />,
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
    icon: <NavEventsIcon className={iconClass} />,
  },
  {
    key: 'resources',
    label: 'Resources',
    href: '/resources',
    description: 'A library of shared documents, links and materials.',
    icon: <NavResourcesIcon className={iconClass} />,
  },
  {
    key: 'connectors',
    label: 'Connectors',
    href: '/connectors',
    description: 'Gateways to external APIs and databases that agents can call.',
    icon: <NavConnectorsIcon className={iconClass} />,
  },
  {
    key: 'agents',
    label: 'Agents',
    href: '/agents',
    description: 'Scheduled agents that run from your context, call connectors, and write notes back.',
    icon: <NavAgentsIcon className={iconClass} />,
  },
  {
    key: 'tools',
    label: 'Tools',
    href: '/tools',
    description: 'Tools built by members and installed from the marketplace.',
    // Nav-less AND core: the marketplace is reached from the navbar icon, each
    // INSTALLED Tool gets its own rail row keyed `tool:<slug>`, and there is no
    // on/off switch — what a space runs is decided by review + install (admins
    // install; members request). See CORE_FEATURE_KEYS in lib/featureAccess.ts.
    core: true,
    icon: <NavToolsIcon className={iconClass} />,
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
    icon: <ToolIcon name={row.icon} svg={row.iconSvg} />,
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
