import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * Pure feature-access logic, kept out of features/shared/lib/features.tsx (which carries JSX
 * icons) so server routes and node:test suites can import it directly.
 * features/shared/lib/features.tsx re-exports everything here alongside the FEATURES registry.
 */

/**
 * Feature keys that are always on and can never be persisted off. Must stay in
 * sync with the `core: true` entries in features/shared/lib/features.tsx#FEATURES.
 */
export const CORE_FEATURE_KEYS: string[] = ['directory', 'notes', 'events'];

/**
 * Every key in the registry, in its default (registry) order. Must stay in sync
 * with features/shared/lib/features.tsx#FEATURES — same convention as CORE_FEATURE_KEYS. Used to
 * reject unknown keys from a client-submitted `order`.
 */
export const ALL_FEATURE_KEYS: string[] = ['directory', 'notes', 'channels', 'events', 'resources', 'connectors'];

/**
 * Feature keys that are admins-only by nature rather than by choice — their
 * pages and APIs refuse a member outright, so the per-community "Restrict to
 * admins" switch has nothing left to decide. `adminOnlyFeatureKeys` folds these
 * in unconditionally and the console renders their switch locked on.
 *
 * Connectors is the only one today: the list route 403s every non-admin, and
 * writing to `connectors/` is admin-gated in brainService.writeDenial.
 */
export const ADMIN_ONLY_FEATURE_KEYS: string[] = ['connectors'];

/**
 * Feature keys that carry NO sidebar nav item (and no console toggle):
 * - `notes` ("Context") is always on (core) and surfaced as the Context tab under
 *   the Directory page, so it has no rail item and is not a toggleable tool.
 * - `events` is always on (core) and reached from the calendar button in the top
 *   navbar, so it has no rail item either.
 */
export const NAV_HIDDEN_FEATURE_KEYS: string[] = ['notes', 'events'];

/**
 * Is `key` enabled for a community? Core features are always enabled; any other
 * feature is enabled unless `featureConfig.enabled[key]` is explicitly `false` —
 * so existing communities (empty config) keep every surface by default.
 */
export function isFeatureEnabled(config: CommunityFeatureConfig | null | undefined, key: string): boolean {
  if (CORE_FEATURE_KEYS.includes(key)) return true;
  const enabled = config?.enabled;
  if (!enabled || enabled[key] === undefined) return true;
  return enabled[key] !== false;
}

/**
 * Node types that only exist because a toggleable feature is on. Keyed by the
 * `nodeTypes` name (matched case-insensitively, since stored `node.type` casing
 * drifts — 'section' vs 'Section'), valued by the feature slug that owns them.
 *
 * Person and Space (the org type, formerly Community) belong to the always-on
 * directory and Event to the always-on navbar Events surface — none of them
 * appears here, so they're never hidden. In particular 'space' must NOT be
 * added: it would hide every org record whenever the Channels tool is off.
 */
const NODE_TYPE_FEATURE_KEYS: Record<string, string> = {
  resource: 'resources',
  section: 'channels',
  channel: 'channels',
  connector: 'connectors',
};

/** The feature slug a node type belongs to, or null if it isn't feature-gated. */
export function nodeTypeFeatureKey(typeName: string): string | null {
  return NODE_TYPE_FEATURE_KEYS[typeName.toLowerCase()] ?? null;
}

/**
 * The node types a feature brings with it, as display names ('Section', 'Channel').
 * Adding or removing a tool in the console adds or removes these types too, so
 * the panel names them on the row rather than letting them vanish silently.
 */
export function featureNodeTypeNames(featureKey: string): string[] {
  return Object.entries(NODE_TYPE_FEATURE_KEYS)
    .filter(([, key]) => key === featureKey)
    .map(([type]) => type.charAt(0).toUpperCase() + type.slice(1));
}

/**
 * Should a node type be offered at all in this community? False only when the
 * type belongs to a feature the community has switched off — turning off
 * Channels should take the Channel and Section types with it, not leave them
 * listed in the console and the directory filters.
 */
export function isNodeTypeEnabled(
  config: CommunityFeatureConfig | null | undefined,
  typeName: string,
): boolean {
  const key = nodeTypeFeatureKey(typeName);
  return key === null || isFeatureEnabled(config, key);
}

/**
 * The features restricted to admins — members get neither the sidebar row nor
 * the page. Reduced to known, nav-bearing keys, folded together with the legacy
 * directory-only `directoryPrivate` flag so old configs keep working, and with
 * the features that are admins-only whatever the config says.
 */
export function adminOnlyFeatureKeys(config: CommunityFeatureConfig | null | undefined): string[] {
  const keys = (config?.adminOnly ?? []).filter(
    (key) => typeof key === 'string' && ALL_FEATURE_KEYS.includes(key) && !NAV_HIDDEN_FEATURE_KEYS.includes(key),
  );
  if (config?.directoryPrivate === true && !keys.includes('directory')) keys.push('directory');
  return [...new Set([...keys, ...ADMIN_ONLY_FEATURE_KEYS])];
}

/** Is feature `key` restricted to admins? */
export function isFeatureAdminOnly(
  config: CommunityFeatureConfig | null | undefined,
  key: string,
): boolean {
  return adminOnlyFeatureKeys(config).includes(key);
}

/** Is the community's directory restricted to admins only? */
export function isDirectoryPrivate(config: CommunityFeatureConfig | null | undefined): boolean {
  return isFeatureAdminOnly(config, 'directory');
}

/**
 * Can a user open feature `key`? Enabled features are open to everyone, except
 * the ones marked admins-only, which members can neither see nor visit.
 */
export function canAccessFeature(
  config: CommunityFeatureConfig | null | undefined,
  key: string,
  isAdmin: boolean,
): boolean {
  if (!isFeatureEnabled(config, key)) return false;
  if (!isAdmin && isFeatureAdminOnly(config, key)) return false;
  return true;
}

/**
 * Sort `keys` into the community's configured display order: keys listed in
 * `config.order` come first, in that order; anything unlisted keeps its original
 * (registry) order behind them. Keys the caller didn't ask for are never added,
 * so this is safe to run over an already-filtered list. An absent or empty
 * `order` leaves `keys` exactly as given.
 */
export function sortFeatureKeys(
  config: CommunityFeatureConfig | null | undefined,
  keys: string[],
): string[] {
  const order = config?.order;
  if (!order || order.length === 0) return [...keys];
  const ranked = order.filter((key) => keys.includes(key));
  const rest = keys.filter((key) => !ranked.includes(key));
  return [...ranked, ...rest];
}

/**
 * The feature keys a community has tucked into the sidebar's "More" popup —
 * deduped and reduced to known, nav-bearing keys. Membership only: the caller
 * still filters by `canAccessFeature` and orders via `sortFeatureKeys`.
 */
export function moreFeatureKeys(config: CommunityFeatureConfig | null | undefined): string[] {
  const more = config?.more;
  if (!more || more.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of more) {
    if (!ALL_FEATURE_KEYS.includes(key) || NAV_HIDDEN_FEATURE_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Fold a client-submitted patch over the stored config and normalize the result.
 *
 * featureConfig is written by more than one console panel — Tools owns which
 * tools the space has (`enabled`) and how the sidebar reads (`order`, `more`),
 * Members owns which of them members may open (`adminOnly`) — so a save
 * carries only the keys its panel owns and inherits the rest. Merging at
 * top-level key granularity is enough because each panel always sends a COMPLETE
 * array for the keys it does own; a partial array would still overwrite.
 */
export function mergeFeatureConfig(
  stored: CommunityFeatureConfig | null | undefined,
  patch: Parameters<typeof sanitizeFeatureConfig>[0],
): CommunityFeatureConfig {
  return sanitizeFeatureConfig({ ...(stored ?? {}), ...patch });
}

/**
 * Normalize a client-submitted featureConfig into the persisted shape: only the
 * known keys, core features stripped from `enabled` (they can never be off),
 * `directoryPrivate` kept only when it's a boolean (and re-derived from
 * `adminOnly` when that's given), and `adminOnly`/`order`/`more` reduced
 * to known keys with duplicates dropped (`more` also drops nav-hidden keys —
 * they have no sidebar row to tuck away).
 */
export function sanitizeFeatureConfig(input: {
  enabled?: Record<string, boolean>;
  directoryPrivate?: unknown;
  adminOnly?: unknown;
  order?: unknown;
  more?: unknown;
}): CommunityFeatureConfig {
  const out: CommunityFeatureConfig = {};
  if (input.enabled) {
    const enabled: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(input.enabled)) {
      if (!CORE_FEATURE_KEYS.includes(key)) enabled[key] = value;
    }
    out.enabled = enabled;
  }
  if (typeof input.directoryPrivate === 'boolean') {
    out.directoryPrivate = input.directoryPrivate;
  }
  if (Array.isArray(input.adminOnly)) {
    // The always-admins-only keys are implicit — adminOnlyFeatureKeys folds them
    // back in on read, so persisting them would just be a derived value on disk.
    out.adminOnly = adminOnlyFeatureKeys({ adminOnly: input.adminOnly as string[] }).filter(
      (key) => !ADMIN_ONLY_FEATURE_KEYS.includes(key),
    );
    // A raw SQL guard in the node-search route still reads directoryPrivate, so
    // the legacy flag tracks whichever way the directory's switch was left.
    out.directoryPrivate = out.adminOnly.includes('directory');
  }
  if (Array.isArray(input.order)) {
    // Unknown or repeated keys would silently reshuffle the nav, so drop them
    // rather than persist them.
    const seen = new Set<string>();
    const order: string[] = [];
    for (const key of input.order) {
      if (typeof key !== 'string' || !ALL_FEATURE_KEYS.includes(key) || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
    if (order.length > 0) out.order = order;
  }
  if (Array.isArray(input.more)) {
    const seen = new Set<string>();
    const more: string[] = [];
    for (const key of input.more) {
      if (
        typeof key !== 'string' ||
        !ALL_FEATURE_KEYS.includes(key) ||
        NAV_HIDDEN_FEATURE_KEYS.includes(key) ||
        seen.has(key)
      ) continue;
      seen.add(key);
      more.push(key);
    }
    if (more.length > 0) out.more = more;
  }
  return out;
}
