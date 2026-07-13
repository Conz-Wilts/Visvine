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
export const CORE_FEATURE_KEYS: string[] = ['directory'];

/**
 * Feature keys that stay toggleable but carry NO sidebar nav item:
 * - `messages` lives in the top navbar beside the profile icon.
 * - `notes` (label "Context") merged into the Directory — it surfaces as the
 *   directory's Context view and the Context tab on entity profiles, not as a
 *   destination of its own.
 */
export const NAV_HIDDEN_FEATURE_KEYS: string[] = ['messages', 'notes'];

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
 * Normalize a client-submitted featureConfig into the persisted shape: only the
 * known keys, core features stripped from `enabled` (they can never be off),
 * and `directoryPrivate` kept only when it's a boolean.
 */
export function sanitizeFeatureConfig(input: {
  enabled?: Record<string, boolean>;
  directoryPrivate?: unknown;
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
  return out;
}
