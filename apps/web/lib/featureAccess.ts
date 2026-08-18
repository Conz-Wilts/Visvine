import type { SpaceFeatureConfig } from '@/lib/types';

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
 * reject unknown keys from a client-submitted `order`, alongside the dynamic
 * `tool:<slug>` rail keys below (see isPersistableFeatureKey).
 */
export const ALL_FEATURE_KEYS: string[] = ['directory', 'notes', 'channels', 'events', 'resources', 'connectors', 'agents', 'tools'];

/**
 * The prefix of an INSTALLED Tool's dynamic rail key: `tool:<slug>`.
 *
 * The `tools` key above is the tool-vocabulary switch (it gates the Tool node
 * type and the /tools marketplace). A rail row, by contrast, belongs to one
 * installed Tool, and a space can install any number of them — so those keys
 * can't be enumerated in a registry. They are persisted in
 * `featureConfig.order` / `more` / `adminOnly` exactly like the registry keys,
 * which is why every validator below accepts them alongside ALL_FEATURE_KEYS.
 */
export const TOOL_RAIL_KEY_PREFIX = 'tool:';

/** The feature key an installed Tool's sidebar rail row is stored under. */
export function toolRailKey(slug: string): string {
  return `${TOOL_RAIL_KEY_PREFIX}${slug}`;
}

/**
 * `tool:<slug>`, where the slug is the Tool's note-folder name under `tools/`
 * — so it carries no slash, whitespace or second colon. Deliberately permissive
 * about the rest: the key's job is to survive a round trip through
 * `featureConfig`, not to re-validate a name the note store already accepted.
 */
const TOOL_RAIL_KEY_RE = /^tool:[^\s/:]+$/;

/** Is `key` an installed Tool's dynamic rail key? Takes `unknown` so a
 *  client-submitted array can be filtered with it directly. */
export function isToolRailKey(key: unknown): key is string {
  return typeof key === 'string' && TOOL_RAIL_KEY_RE.test(key);
}

/**
 * Is `key` something a space may persist in `featureConfig`? Either a registry
 * key or an installed Tool's rail key. Everything else is dropped — a stale or
 * forged key would silently reshuffle the nav.
 */
function isPersistableFeatureKey(key: unknown): key is string {
  return (typeof key === 'string' && ALL_FEATURE_KEYS.includes(key)) || isToolRailKey(key);
}

/**
 * Feature keys that are admins-only by nature rather than by choice — their
 * pages and APIs refuse a member outright, so the per-space "Restrict to
 * admins" switch has nothing left to decide. `adminOnlyFeatureKeys` folds these
 * in unconditionally and the console renders their switch locked on.
 *
 * Connectors is the only one today: the list route 403s every non-admin, and
 * writing to `connectors/` is admin-gated in contextService.writeDenial.
 * Agents deliberately is NOT here: any member may author an agent brief; only
 * activation (`agents/live/`) is admin-gated. A space may still restrict the
 * tool to admins with the ordinary per-space switch. Tools is the same story —
 * members author under `tools/`; only installing and publishing are admin acts.
 */
export const ADMIN_ONLY_FEATURE_KEYS: string[] = ['connectors'];

/**
 * Feature keys that carry NO sidebar nav item (and no console toggle):
 * - `notes` ("Context") is always on (core) and surfaced as the Context tab under
 *   the Directory page, so it has no rail item and is not a toggleable tool.
 * - `events` is always on (core) and reached from the calendar button in the top
 *   navbar, so it has no rail item either.
 * - `tools` is reached from the marketplace icon in the top navbar, and each
 *   INSTALLED Tool gets its own rail row keyed `tool:<slug>` — so the tool
 *   vocabulary itself never wants a "Tools" row. Those per-install keys are not
 *   nav-hidden: they are the rail rows.
 */
export const NAV_HIDDEN_FEATURE_KEYS: string[] = ['notes', 'events', 'tools'];

/**
 * Is `key` enabled for a space? Core features are always enabled; any other
 * feature is enabled unless `featureConfig.enabled[key]` is explicitly `false` —
 * so existing spaces (empty config) keep every surface by default.
 */
export function isFeatureEnabled(config: SpaceFeatureConfig | null | undefined, key: string): boolean {
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
 * Person and Space (the org type) belong to the always-on
 * directory and Event to the always-on navbar Events surface — none of them
 * appears here, so they're never hidden. In particular 'space' must NOT be
 * added: it would hide every org record whenever the Channels tool is off.
 */
const NODE_TYPE_FEATURE_KEYS: Record<string, string> = {
  resource: 'resources',
  section: 'channels',
  channel: 'channels',
  connector: 'connectors',
  agent: 'agents',
  tool: 'tools',
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
 * The tool each BUILT-IN node type belongs to, for display.
 *
 * Deliberately separate from NODE_TYPE_FEATURE_KEYS above: that map decides what
 * gets HIDDEN when a tool is off, so it may only ever hold types a space can
 * afford to lose. This one names the owning tool for every built-in, including
 * the always-on ones (Person and Space are the directory's, Index the context
 * surface's, Event the navbar calendar's) — naming a type's tool is safe where
 * gating on it would not be.
 *
 * A type absent from here is one a member invented: it has no tool, and the
 * console lists it under Custom types.
 */
const NODE_TYPE_TOOL_KEYS: Record<string, string> = {
  ...NODE_TYPE_FEATURE_KEYS,
  person: 'directory',
  space: 'directory',
  index: 'notes',
  event: 'events',
};

/** The tool a built-in node type comes from, or null if no tool owns it. */
export function nodeTypeToolKey(typeName: string): string | null {
  return NODE_TYPE_TOOL_KEYS[typeName.trim().toLowerCase()] ?? null;
}

/**
 * Should a node type be offered at all in this space? False only when the
 * type belongs to a feature the space has switched off — turning off
 * Channels should take the Channel and Section types with it, not leave them
 * listed in the console and the directory filters.
 */
export function isNodeTypeEnabled(
  config: SpaceFeatureConfig | null | undefined,
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
export function adminOnlyFeatureKeys(config: SpaceFeatureConfig | null | undefined): string[] {
  const keys = (config?.adminOnly ?? []).filter(
    (key) => isPersistableFeatureKey(key) && !NAV_HIDDEN_FEATURE_KEYS.includes(key),
  );
  if (config?.directoryPrivate === true && !keys.includes('directory')) keys.push('directory');
  return [...new Set([...keys, ...ADMIN_ONLY_FEATURE_KEYS])];
}

/** Is feature `key` restricted to admins? */
export function isFeatureAdminOnly(
  config: SpaceFeatureConfig | null | undefined,
  key: string,
): boolean {
  return adminOnlyFeatureKeys(config).includes(key);
}

/** Is the space's directory restricted to admins only? */
export function isDirectoryPrivate(config: SpaceFeatureConfig | null | undefined): boolean {
  return isFeatureAdminOnly(config, 'directory');
}

/**
 * Can a user open feature `key`? Enabled features are open to everyone, except
 * the ones marked admins-only, which members can neither see nor visit.
 */
export function canAccessFeature(
  config: SpaceFeatureConfig | null | undefined,
  key: string,
  isAdmin: boolean,
): boolean {
  if (!isFeatureEnabled(config, key)) return false;
  if (!isAdmin && isFeatureAdminOnly(config, key)) return false;
  return true;
}

/**
 * Sort `keys` into the space's configured display order: keys listed in
 * `config.order` come first, in that order; anything unlisted keeps its original
 * (registry) order behind them. Keys the caller didn't ask for are never added,
 * so this is safe to run over an already-filtered list. An absent or empty
 * `order` leaves `keys` exactly as given.
 *
 * Membership in `keys` is the only thing that qualifies an ordered key, so an
 * installed Tool's `tool:<slug>` row sorts alongside the registry keys with no
 * special case here.
 */
export function sortFeatureKeys(
  config: SpaceFeatureConfig | null | undefined,
  keys: string[],
): string[] {
  const order = config?.order;
  if (!order || order.length === 0) return [...keys];
  const ranked = order.filter((key) => keys.includes(key));
  const rest = keys.filter((key) => !ranked.includes(key));
  return [...ranked, ...rest];
}

/**
 * The feature keys a space has tucked into the sidebar's "More" popup —
 * deduped and reduced to known, nav-bearing keys (registry keys plus installed
 * Tools' `tool:<slug>` rows). Membership only: the caller still filters by
 * `canAccessFeature` and orders via `sortFeatureKeys`.
 */
export function moreFeatureKeys(config: SpaceFeatureConfig | null | undefined): string[] {
  const more = config?.more;
  if (!more || more.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of more) {
    if (!isPersistableFeatureKey(key) || NAV_HIDDEN_FEATURE_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * The nav keys a viewer sees, split between the sidebar rail and the "More"
 * popup, in the space's configured order.
 *
 * This is the pure half of features/shared/lib/features.tsx's `railFeatures` /
 * `moreFeatures`: that module maps these keys back to rows with labels and
 * icons, and every decision about WHICH rows and in WHAT order is made here,
 * where a server route or a node:test can reach it without the JSX.
 *
 * `toolKeys` are the `tool:<slug>` rows a space's installed Tools contribute, in
 * install order. They come last in the candidate list on purpose: `sortFeatureKeys`
 * leaves unlisted keys where they were, so a Tool an admin has never placed
 * falls in AFTER the built-in rows. The first visible row is the tab members
 * land on when they enter the space, and installing a Tool must not move a
 * space's front door (lib/tools/installs.ts#orderWithRail keeps the stored
 * `order` honest about the same rule).
 *
 * Nav-hidden keys are dropped up front — they have no row to place — and every
 * candidate goes through `canAccessFeature`. A Tool is not an exception to that:
 * members see installed Tools, but a row an admin locked on Members → Tools is
 * locked whether a Tool or a built-in is behind it.
 *
 * `toolKeys` are dropped wholesale when `tools` itself is off — switched off or
 * locked to admins for a non-admin viewer — the same rule the bridge enforces
 * for a running Tool (lib/tools/target.ts#forbiddenForTools): a disabled space
 * never sees the shape of a Tool it may not run, install-scoped `enabled`
 * included. Without this, an installed Tool's row (and its per-install
 * `adminOnly`/`enabled` state) would keep it visible after the vocabulary was
 * switched off, and clicking through would land on a page whose frame refuses
 * to run.
 */
export function navFeatureKeys(
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
  toolKeys: readonly string[] = [],
): { rail: string[]; more: string[] } {
  const toolsOn = canAccessFeature(config, 'tools', isAdmin);
  const ordered = sortFeatureKeys(
    config,
    [...ALL_FEATURE_KEYS.filter((key) => !NAV_HIDDEN_FEATURE_KEYS.includes(key)), ...(toolsOn ? toolKeys : [])].filter(
      (key) => canAccessFeature(config, key, isAdmin),
    ),
  );
  const more = moreFeatureKeys(config);
  return {
    rail: ordered.filter((key) => !more.includes(key)),
    more: ordered.filter((key) => more.includes(key)),
  };
}

/**
 * Fold a client-submitted patch over the stored config and normalize the result.
 *
 * featureConfig is written by more than one console panel — Tools owns which
 * tools the space has (`enabled`) and how the sidebar reads (`order`, `more`),
 * Members owns which of them members may open (`adminOnly`) — so a save
 * carries only the keys its panel owns and inherits the rest.
 *
 * `enabled` merges one tool at a time, because it is a map rather than a list:
 * two panels (or two tabs) each toggling a different tool would otherwise
 * clobber each other, the whole tool vocabulary riding on whichever save landed
 * second. Turning a tool off still works — that writes `false` for its key,
 * which the merge keeps.
 *
 * The arrays (`adminOnly`, `order`, `more`) stay whole-value: each is owned by
 * exactly one panel, which always sends it complete, and there is no meaningful
 * element-wise merge of an ordering.
 */
export function mergeFeatureConfig(
  stored: SpaceFeatureConfig | null | undefined,
  patch: Parameters<typeof sanitizeFeatureConfig>[0],
): SpaceFeatureConfig {
  const base = stored ?? {};
  const enabled =
    patch.enabled || base.enabled
      ? { ...(base.enabled ?? {}), ...(patch.enabled ?? {}) }
      : undefined;
  return sanitizeFeatureConfig({
    ...base,
    ...patch,
    ...(enabled ? { enabled } : {}),
  });
}

/**
 * Normalize a client-submitted featureConfig into the persisted shape: only the
 * known keys, core features stripped from `enabled` (they can never be off),
 * `directoryPrivate` kept only when it's a boolean (and re-derived from
 * `adminOnly` when that's given), and `adminOnly`/`order`/`more` reduced
 * to known keys with duplicates dropped (`more` also drops nav-hidden keys —
 * they have no sidebar row to tuck away).
 *
 * "Known" means a registry key OR an installed Tool's `tool:<slug>` rail key
 * (isPersistableFeatureKey) — those are real rows a space places, locks and
 * tucks away, so they persist like any other. Unknown non-tool keys are still
 * dropped.
 */
export function sanitizeFeatureConfig(input: {
  enabled?: Record<string, boolean>;
  directoryPrivate?: unknown;
  adminOnly?: unknown;
  order?: unknown;
  more?: unknown;
}): SpaceFeatureConfig {
  const out: SpaceFeatureConfig = {};
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
      if (!isPersistableFeatureKey(key) || seen.has(key)) continue;
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
        !isPersistableFeatureKey(key) ||
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
