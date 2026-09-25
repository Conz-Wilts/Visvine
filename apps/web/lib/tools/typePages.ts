/**
 * Which installed Tool owns a context type's surface — the data-driven half of
 * "people have profiles, spaces have space pages, events have event pages".
 *
 * The dispatch used to be a hardcoded switch in `directory/[nodeId]`; this
 * module is the part of it a Tool can join. Two rules, both from the brief and
 * both already enforced on the write side by `installs.ts#resolveTypeClaims`:
 *
 *   • **Built-ins win.** A member's profile, a space's page and an event's page
 *     are Visvine's, so a claim on one of those types can only ever be an extra
 *     TAB. A Tool may own the whole page for a member-invented type and nothing
 *     else. This module re-checks that rather than trusting the stored claim: a
 *     row written before the rule existed, or by a future bug, must not be able
 *     to replace a profile.
 *   • **One page per type.** The install path refuses a second page claim, so a
 *     tie is impossible by construction. If the data says otherwise anyway, the
 *     first install in the list wins and the disagreement is logged — a page
 *     that flickers between two Tools depending on render order would be far
 *     worse than one that is merely arbitrary.
 *
 * Pure and unit-tested (tests/tools-type-pages.test.ts); the React side is
 * features/tools/hooks/useTypePages.ts.
 */
import { entityKindOf } from '@/lib/notes/entities'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { isReservedTypeName } from '@/lib/types/nodeTypeRegistry'
import type { InstalledToolDto, TypeClaimMode } from './installs'
import { logger } from '@/lib/logger'
import { canAccessFeature, toolRailKey } from '@/lib/featureAccess'
import type { SpaceFeatureConfig } from '@/lib/types/space'

/**
 * The installs this viewer may run anywhere — their rail row, their page, their
 * tabs on type pages. An admin who locked a Tool's row locked the Tool, and a
 * space that holds its directory to admins holds its Tools there too; a Tool
 * pulled back (`stopped`) draws no tab. The bridge refuses the same viewers
 * (lib/tools/target.ts), so hiding here is the courtesy, not the gate.
 */
export function runnableInstalls(
  installs: readonly InstalledToolDto[] | null | undefined,
  config: SpaceFeatureConfig | null | undefined,
  isAdmin: boolean,
): InstalledToolDto[] {
  if (!installs?.length || !canAccessFeature(config, 'directory', isAdmin)) return []
  return installs.filter((tool) => !tool.stopped && canAccessFeature(config, toolRailKey(tool.slug), isAdmin))
}

/**
 * The types no Tool may own the page for, lower-cased.
 *
 * The first ten are `DEFAULT_NODE_TYPES` — every type that has a built-in page
 * or a built-in meaning. `note` and `file` are content rather than node types
 * and `index` relocates a note into a folder, which is why all three are also
 * `isReservedTypeName`; they are listed here so the answer doesn't depend on
 * which of the two rules a reader happens to know about.
 *
 * Synonyms are NOT listed: `entityKindOf` already folds every spelling an
 * entity type has worn (`people`, `organization`, `companies`, `agents`…) onto
 * its kind, and duplicating that table here is how the two would drift.
 */
export const BUILT_IN_TYPES: readonly string[] = [
  'person',
  'space',
  'event',
  'resource',
  'section',
  'channel',
  'connector',
  'agent',
  'tool',
  'index',
  'note',
  'file',
]

/** Who is showing a type's surface. */
export interface TypePageOwner {
  /**
   * The install row's id — what `BridgeTarget { kind: 'install' }` names, so a
   * surface can mount a `ToolFrame` straight from this without a lookup of its
   * own. Not a secret: the frame-token and bridge routes re-derive the space
   * and the viewer's standing from it server-side.
   */
  id: string
  slug: string
  title: string
  key: string
}

/** A resolved surface: who draws it, and whether it IS the page or sits beside it. */
export interface TypePageClaim {
  owner: TypePageOwner
  mode: TypeClaimMode
}

/** The one spelling everything here compares on: trimmed, lower-cased, non-empty. */
function normalizeType(raw: string | null | undefined): string | null {
  const type = (raw ?? '').trim().toLowerCase()
  return type || null
}

/** Does Visvine own this type's page? Synonyms and reserved names included. */
export function isBuiltInType(type: string | null | undefined): boolean {
  const name = normalizeType(type)
  if (!name) return false
  return BUILT_IN_TYPES.includes(name) || entityKindOf(name) !== null || isReservedTypeName(name)
}

function ownerOf(tool: InstalledToolDto): TypePageOwner {
  return { id: tool.id, slug: tool.slug, title: tool.title, key: tool.key }
}

/** Enabled installs holding any claim on `type`, in the DTO's own order. */
function claimantsOf(
  installedTools: readonly InstalledToolDto[] | null | undefined,
  type: string,
): InstalledToolDto[] {
  return (installedTools ?? []).filter((tool) => tool.enabled && !!tool.types?.[type])
}

/**
 * Every enabled install holding the PAGE for a type — one, normally, and never
 * more than one unless the data is inconsistent. Empty for a built-in, which no
 * Tool may page.
 *
 * The console shows this list so an admin can see a disagreement and settle it,
 * rather than living with whichever install `resolveTypePage` happens to pick.
 */
export function pageClaimantsFor(
  installedTools: readonly InstalledToolDto[] | null | undefined,
  typeName: string | null | undefined,
): InstalledToolDto[] {
  const type = normalizeType(typeName)
  if (!type || isBuiltInType(type)) return []
  return claimantsOf(installedTools, type).filter((tool) => tool.types[type] === 'page')
}

/**
 * The surface an installed Tool provides for `typeName`, or null when no Tool
 * claims it — which is every type in almost every space, so this answers null
 * fast and the callers change nothing about how they render.
 *
 * A built-in type always resolves to `tab`, whatever the stored claim says (see
 * the file header). A custom type resolves to `page` for the one install that
 * owns it, and otherwise to the first `tab` claim.
 */
export function resolveTypePage(
  installedTools: readonly InstalledToolDto[] | null | undefined,
  typeName: string | null | undefined,
): TypePageClaim | null {
  const type = normalizeType(typeName)
  if (!type) return null
  const claimants = claimantsOf(installedTools, type)
  if (claimants.length === 0) return null
  if (isBuiltInType(type)) return { owner: ownerOf(claimants[0]), mode: 'tab' }

  const pages = pageClaimantsFor(installedTools, type)
  if (pages.length === 0) return { owner: ownerOf(claimants[0]), mode: 'tab' }
  if (pages.length > 1) {
    // Impossible by construction (installs.ts refuses a second page claim), so
    // this is a data fault worth naming rather than silently absorbing.
    logger.warn('tools.type_page.multiple_claims', {
      type,
      claimants: pages.map((tool) => tool.slug),
      showing: pages[0].slug,
    })
  }
  return { owner: ownerOf(pages[0]), mode: 'page' }
}

/**
 * Every Tool that adds a TAB for `typeName` — plural, because nothing forbids
 * two Tools each adding a tab to the person profile, and the tab ids are
 * `tool:<slug>` precisely so several can coexist.
 *
 * The page owner is deliberately absent: on a custom type the page IS that
 * Tool's surface, so listing it again as a tab beside itself would show the
 * same Tool twice. On a built-in every claim is a tab.
 */
export function typeTabsFor(
  installedTools: readonly InstalledToolDto[] | null | undefined,
  typeName: string | null | undefined,
): TypePageOwner[] {
  const type = normalizeType(typeName)
  if (!type) return []
  const builtIn = isBuiltInType(type)
  return claimantsOf(installedTools, type)
    .filter((tool) => builtIn || tool.types[type] === 'tab')
    .map(ownerOf)
}

/**
 * Every type any installed Tool claims, resolved. What the memoised hook hands
 * the note route: one pass over the installs per space instead of one per note.
 */
export function typePagesFor(
  installedTools: readonly InstalledToolDto[] | null | undefined,
): Record<string, TypePageClaim> {
  const out: Record<string, TypePageClaim> = {}
  for (const tool of installedTools ?? []) {
    if (!tool.enabled) continue
    for (const claimed of Object.keys(tool.types ?? {})) {
      const type = normalizeType(claimed)
      if (!type || out[type]) continue
      const resolved = resolveTypePage(installedTools, type)
      if (resolved) out[type] = resolved
    }
  }
  return out
}

/**
 * The type a context note wears, lower-cased — the key everything above is
 * looked up by. Null for a note with no `type:` (or a non-string one), which is
 * every note that predates the type picker.
 */
export function noteTypeOf(frontmatter: NoteFrontmatter | null | undefined): string | null {
  const raw = frontmatter?.type
  return typeof raw === 'string' ? normalizeType(raw) : null
}
