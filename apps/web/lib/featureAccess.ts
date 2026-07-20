import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * Pure feature-access logic, kept out of lib/features.tsx (which carries JSX
 * icons) so server routes and node:test suites can import it directly.
 * lib/features.tsx re-exports everything here alongside the FEATURES registry.
 */

/**
 * Feature keys that are always on and can never be persisted off. Must stay in
 * sync with the `core: true` entries in lib/features.tsx#FEATURES.
 */
export const CORE_FEATURE_KEYS: string[] = ['directory', 'messages'];

/**
 * Every key in the registry, in its default (registry) order. Must stay in sync
 * with lib/features.tsx#FEATURES — same convention as CORE_FEATURE_KEYS. Used to
 * reject unknown keys from a client-submitted `order`.
 */
export const ALL_FEATURE_KEYS: string[] = ['directory', 'notes', 'channels', 'events', 'tasks', 'resources', 'messages'];

/**
 * Feature keys that carry NO sidebar nav item:
 * - `messages` is always on (core) and lives in the top navbar beside the
 *   profile icon, so it never appears in the sidebar or the console toggles.
 */
export const NAV_HIDDEN_FEATURE_KEYS: string[] = ['messages'];

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

/** Is the community's directory restricted to admins only? */
export function isDirectoryPrivate(config: CommunityFeatureConfig | null | undefined): boolean {
  return config?.directoryPrivate === true;
}

/**
 * Can a user open feature `key`? Enabled features are open to everyone, except
 * an admins-only directory, which members can neither see nor visit.
 */
export function canAccessFeature(
  config: CommunityFeatureConfig | null | undefined,
  key: string,
  isAdmin: boolean,
): boolean {
  if (!isFeatureEnabled(config, key)) return false;
  if (key === 'directory' && isDirectoryPrivate(config) && !isAdmin) return false;
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
 * Normalize a client-submitted featureConfig into the persisted shape: only the
 * known keys, core features stripped from `enabled` (they can never be off),
 * `directoryPrivate` kept only when it's a boolean, and `order` reduced to known
 * keys with duplicates dropped.
 */
export function sanitizeFeatureConfig(input: {
  enabled?: Record<string, boolean>;
  directoryPrivate?: unknown;
  order?: unknown;
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
  return out;
}
