/**
 * Pure merge rules for a Space's JSON configuration columns — the "decide" half
 * of every read → decide → write that lib/spaces/spaceConfig.ts serializes.
 *
 * One principle runs through all of them: **a save is an edit, not a
 * replacement.** Every console panel and API client saves from a snapshot it
 * read earlier, sometimes minutes earlier, and none of them can see what
 * another writer did in between. So an entry present in storage and absent from
 * the payload is KEPT, not deleted — removing something is a deliberate act
 * that needs its own call. lib/types/nodeTypeRegistry.ts#mergeNodeTypeList
 * established this for node types after a stale Types-page save was found
 * deleting types members had created; these are the same rule for the columns
 * that never got one.
 *
 * The second principle: **flags that confer authority never come from the
 * payload.** An alias's `owner`, an alias's or link type's `system` — these are
 * read back out of storage on every merge, so no client snapshot can grant
 * ownership or un-protect a built-in by echoing a stale (or edited) value.
 *
 * No DB access here, so all of it is unit-tested in tests/space-config.test.ts.
 */

import { randomUUID } from 'crypto';
import type { SpaceAlias, LinkTypeConfig } from '@/lib/types/context';
import { DEFAULT_LINK_TYPES } from '@/lib/types/context';
import type { SpaceDesignConfig } from '@/lib/types/space';

/* ── link types ─────────────────────────────────────────────────────────── */

const linkTypeKey = (t: LinkTypeConfig): string => t.name?.trim().toLowerCase() ?? '';

/** Whether a link type name is one of the built-in `system` types. Consulted for
 *  entries the payload introduces, so a client can't smuggle `system: true` in
 *  on a new type — nor strip it from a built-in it happens to re-add. */
function defaultSystemFlag(name: string): boolean {
  const key = name.trim().toLowerCase();
  return DEFAULT_LINK_TYPES.some((t) => t.name.trim().toLowerCase() === key && t.system === true);
}

/**
 * Fold an edited link-type list back onto what is stored, additively.
 *
 * Until now `/api/data/communities` wrote this column verbatim from the client
 * snapshot, with no merge and no read-back at all — the only reason it never
 * caused an incident is that the Types page is its sole writer. That is a
 * property of today's UI, not of the data, so it gets the same treatment as
 * node types: incoming entries win on colour and direction, anything stored but
 * absent is kept, and `system` is never taken from the payload.
 */
export function mergeLinkTypeList(
  stored: LinkTypeConfig[] | null | undefined,
  incoming: LinkTypeConfig[] | null | undefined,
): LinkTypeConfig[] {
  const storedList = stored ?? [];
  const edits = new Map((incoming ?? []).map((t) => [linkTypeKey(t), t]));

  // Stored order is kept — recolouring one type must not shuffle the vocabulary.
  const next: LinkTypeConfig[] = storedList.map((current) => {
    const edit = edits.get(linkTypeKey(current));
    if (!edit) return current;
    return {
      ...current,
      name: edit.name ?? current.name,
      color: edit.color ?? current.color,
      directed: edit.directed ?? current.directed,
      // Authority flag: storage wins, always.
      ...(current.system === true ? { system: true as const } : {}),
    };
  });

  const kept = new Set(storedList.map(linkTypeKey));
  for (const type of incoming ?? []) {
    const key = linkTypeKey(type);
    if (!key || kept.has(key)) continue;
    kept.add(key);
    const system = defaultSystemFlag(type.name);
    next.push({
      name: type.name,
      color: type.color,
      directed: type.directed,
      ...(system ? { system: true as const } : {}),
    });
  }
  return next;
}

/* ── aliases ────────────────────────────────────────────────────────────── */

/**
 * The identity of an alias within its space.
 *
 * Aliases carry a stable `id`; a space seeded before ids existed may still hold
 * entries without one, and those fall back to the name — the same key the whole
 * model used before. Anything comparing two aliases goes through here, so the
 * fallback lives in exactly one place.
 */
export function aliasKey(alias: SpaceAlias): string {
  return alias.id ?? `name:${alias.name?.trim().toLowerCase() ?? ''}`;
}

/** The id a newly created alias gets. Opaque and stable for the alias's life —
 *  a rename must never change it, which is the whole point. */
export function newAliasId(): string {
  return `al_${randomUUID()}`;
}

/**
 * Fold an edited alias list back onto what is stored, additively.
 *
 * This replaces `reconcilePersonAliases`, which treated the payload as
 * authoritative: any Person alias missing from a Types-page snapshot was
 * deleted, and its holders and grants were cascaded away with it — from a
 * snapshot that could not possibly know about an alias created since it loaded.
 * Deleting an alias is now only ever the explicit delete action.
 *
 * `owner` and `system` are read back out of storage on every entry. The Types
 * page cannot edit them, and neither can a hand-rolled request.
 */
export function mergeAliasList(
  stored: SpaceAlias[] | null | undefined,
  incoming: SpaceAlias[] | null | undefined,
): SpaceAlias[] {
  const storedList = stored ?? [];
  const edits = new Map((incoming ?? []).map((a) => [aliasKey(a), a]));

  const next: SpaceAlias[] = storedList.map((current) => {
    const edit = edits.get(aliasKey(current));
    if (!edit) return current;
    return {
      ...current,
      name: edit.name ?? current.name,
      color: edit.color ?? current.color,
      nodeType: edit.nodeType ?? current.nodeType,
      // Authority flags: storage wins, always.
      ...(current.owner === true ? { owner: true as const } : {}),
      ...(current.system === true ? { system: true as const } : {}),
    };
  });

  const kept = new Set(storedList.map(aliasKey));
  for (const alias of incoming ?? []) {
    const key = aliasKey(alias);
    if (kept.has(key)) continue;
    kept.add(key);
    // A brand-new alias starts with no authority whatever the payload claims.
    const { owner: _owner, system: _system, ...rest } = alias;
    next.push(rest);
  }
  return next;
}

/* ── design config ──────────────────────────────────────────────────────── */

/**
 * Fold a design-settings save onto what is stored.
 *
 * `tagColors` is the reason this exists: it lives in `designConfig` but is
 * written by any member through the tag-colours route, while the design panel
 * saves the object as a whole. The settings route used to rescue that one key
 * by hand; merging it key-by-key covers it, and covers the next sub-key
 * somebody adds without a third rescue.
 */
export function mergeDesignConfig(
  stored: SpaceDesignConfig | null | undefined,
  patch: Partial<SpaceDesignConfig> | null | undefined,
): SpaceDesignConfig {
  const base = stored ?? {};
  if (!patch) return base;
  const merged: SpaceDesignConfig = { ...base, ...patch };
  if (base.tagColors || patch.tagColors) {
    merged.tagColors = { ...(base.tagColors ?? {}), ...(patch.tagColors ?? {}) };
  }
  return merged;
}
