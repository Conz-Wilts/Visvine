import type { ReactNode } from 'react';
import type { SpaceFeatureConfig } from '@/lib/types';
import type { InstalledToolDto } from '@/lib/tools/installs';
import { navFeatureKeys } from '@/lib/featureAccess';
import { toolRailRows, type ToolRailRow } from '@/features/tools/lib/railRows';
import ToolIcon from '@/features/tools/components/toolIcons';
import {
  NavDirectoryIcon,
  NavChannelsIcon,
  NavConnectorsIcon,
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
 * surfaces a space builder can switch on or off (directory, channels). The
 * Sidebar renders its nav items from this list, so the nav and the per-space
 * feature toggles never drift. Resources and Tools are NOT here: the Drive is
 * a tab of the Directory and a Tool is one of its nodes — neither is a tool
 * with a switch. Each INSTALLED Tool contributes its own `tool:<slug>` row
 * through toolFeatures() below.
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
    key: 'channels',
    label: 'Channels',
    href: '/channels',
    description: 'A shared feed and topic channels for posts and conversation.',
    icon: <NavChannelsIcon className={iconClass} />,
  },
  {
    key: 'connectors',
    label: 'Connectors',
    href: '/admin?section=connectors',
    description: 'Gateways to external APIs and databases that agents can call.',
    // Always on and nav-less: connectors are a section of the Space Console,
    // admins only by nature, so there is no rail row and nothing to toggle or
    // reorder per space. See NAV_HIDDEN_FEATURE_KEYS.
    core: true,
    icon: <NavConnectorsIcon className={iconClass} />,
  },
];

/**
 * An installed Tool's rail row as a `FeatureDef` — the same shape a built-in
 * produces, which is the whole trick: the rail, the "More" popup and the
 * console's order editor need no special case for Tools at all, and a
 * `tool:<slug>` key sorts, tucks away and locks exactly like `channels`.
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
