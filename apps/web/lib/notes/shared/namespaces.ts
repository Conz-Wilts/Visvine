// The reserved namespaces of a space's context, in ONE table.
//
// A namespace is the top-level folder a kind is filed under — `people/`,
// `agents/`, `connectors/` — and four separate questions used to be answered
// about it in four separate places: which kind lives there (ENTITY_DIRS), which
// folders the tree shows while empty, what a folder's index says it holds, and
// who may write in it. They are one question about one thing, so they are one
// row here.
//
// Two rules fall out of the table, and they are the whole model:
//
//   • A folder appears because there is something IN it. The exception is a
//     namespace a person writes into from the tree itself — `agents/`, and
//     `connectors/` for the admin who may write it — which stands there empty
//     so it can be written into. `models/` and `tools/` are NOT exceptions:
//     they are authored from Settings → Models and the console's Build
//     section, so an empty one in the tree is a folder nobody goes to.
//   • A namespace whose TOOL is off is not created at all. Today that is
//     `channels/` and `sections/`, both owned by the `channels` feature, which
//     is off in every new space (defaultFeatureConfig). Adding a toggleable
//     tool later is a row here, not a new special case.
//
// This module is a LEAF on purpose: lib/notes/entities.ts imports
// ./shared/indexNote, and indexNote imports this, so importing either from
// here would close a cycle. It imports the feature helpers and nothing else,
// which also keeps it runnable under node:test and the tsx scripts.

import { isFeatureEnabled } from '../../featureAccess'
import type { SpaceFeatureConfig } from '../../types'

/** The kinds that have a namespace of their own. Re-exported by entities.ts as `EntityKind`. */
export type NamespaceKind =
  | 'person'
  | 'resource'
  | 'event'
  | 'space'
  | 'section'
  | 'channel'
  | 'connector'
  | 'agent'
  | 'tool'
  | 'model'

export interface Namespace {
  /** The folder, with no slash. A note path is link identity, so this is renamed
   *  only by moving every note under it and rewriting every link. */
  dir: string
  /** The kind filed here, or null for a folder that is not a kind. */
  kind: NamespaceKind | null
  /** The feature key that owns it; null when it is the platform's own. */
  feature: string | null
  /**
   * `standing` = grafted into the tree while empty, because this is where a
   * person goes to write one. `derived` = it appears with its first note.
   */
  appearance: 'standing' | 'derived'
  /** Who may write in it. `nobody` = the system or federation only. */
  writes: 'anyone' | 'admin' | 'nobody'
  /** The one line a folder's index carries when it has none of its own. */
  description: string
  /**
   * Stands only for an admin. A member cannot write `connectors/`, so an empty
   * one is noise to them — but the moment a connector EXISTS the folder is in
   * the tree for everyone, because it holds a note. This governs the empty case
   * and nothing else.
   */
  standingForAdminOnly?: boolean
}

export const RESERVED_NAMESPACES: readonly Namespace[] = [
  {
    dir: 'people',
    kind: 'person',
    feature: 'directory',
    appearance: 'derived',
    writes: 'anyone',
    description: 'The people this space keeps context about.',
  },
  {
    dir: 'spaces',
    kind: 'space',
    feature: 'directory',
    appearance: 'derived',
    writes: 'anyone',
    // The directory's organisation records — a company or group this space
    // tracks. Not this space's sub-spaces: those are grafted into subspaces/.
    description: 'The organisations this space keeps context about.',
  },
  {
    dir: 'events',
    kind: 'event',
    feature: 'directory',
    appearance: 'derived',
    writes: 'anyone',
    description: "This space's events.",
  },
  {
    dir: 'resources',
    kind: 'resource',
    feature: 'resources',
    appearance: 'derived',
    writes: 'anyone',
    description: 'The files and links this space keeps.',
  },
  {
    dir: 'channels',
    kind: 'channel',
    feature: 'channels',
    appearance: 'derived',
    writes: 'admin',
    description: "This space's channels.",
  },
  {
    dir: 'sections',
    kind: 'section',
    feature: 'channels',
    appearance: 'derived',
    writes: 'admin',
    description: 'The sections the channels are grouped into.',
  },
  {
    dir: 'agents',
    kind: 'agent',
    // An agent IS a brief in the Context, watched on its own node page rather
    // than on a surface of its own — so the folder is there before the first
    // brief, and anyone who may write context may write one.
    feature: 'notes',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The agents this space runs.',
  },
  {
    dir: 'connectors',
    kind: 'connector',
    feature: 'connectors',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: 'The services this space is connected to.',
  },
  {
    dir: 'models',
    kind: 'model',
    feature: 'connectors',
    // Written from Settings → Models, never from the tree.
    appearance: 'derived',
    writes: 'admin',
    description: "The models this space's agents run on.",
  },
  {
    dir: 'tools',
    kind: 'tool',
    feature: 'tools',
    // Written from the console's Build section, never from the tree.
    appearance: 'derived',
    writes: 'anyone',
    description: 'The tools built in this space.',
  },
  {
    dir: 'settings',
    kind: null,
    feature: null,
    appearance: 'derived',
    writes: 'admin',
    description: "This space's own configuration.",
  },
  {
    dir: 'subspaces',
    kind: null,
    feature: null,
    // Never a stored folder: lib/notes/federation.ts grafts it at read time.
    appearance: 'derived',
    writes: 'nobody',
    description: "Context flowing up from this space's public sub-spaces — read-only.",
  },
]

const BY_DIR = new Map(RESERVED_NAMESPACES.map((ns) => [ns.dir, ns]))

/** The first segment of a path — 'channels/foo/index.md' → 'channels'. */
function firstSegment(path: string): string {
  const clean = path.replace(/^\/+/, '')
  const cut = clean.indexOf('/')
  return cut === -1 ? clean : clean.slice(0, cut)
}

/**
 * The namespace a path sits in, or null for an ordinary folder. The folder
 * itself counts ('channels' and 'channels/foo.md' both answer channels), and a
 * folder that merely starts with the name does not ('channels-archive').
 */
export function namespaceOf(path: string): Namespace | null {
  if (!path) return null
  return BY_DIR.get(firstSegment(path)) ?? null
}

/** Every namespace dir, in table order. */
export function namespaceDirs(): string[] {
  return RESERVED_NAMESPACES.map((ns) => ns.dir)
}

/** The dir a kind is filed under. */
export function dirOfKind(kind: NamespaceKind): string {
  const found = RESERVED_NAMESPACES.find((ns) => ns.kind === kind)
  // Every kind in the union has a row; the throw is for a row deleted by hand.
  if (!found) throw new Error(`no namespace is declared for the kind "${kind}"`)
  return found.dir
}

/**
 * The folders in the tree whether or not anything is in them yet.
 *
 * `isAdmin` is the CALLER's standing in the context being read — a sub-space's
 * federated tree is read under its everyone-principal, which holds none, so a
 * parent is never handed its child's `connectors/`.
 */
export function standingFolders(
  config: SpaceFeatureConfig | null | undefined,
  { isAdmin }: { isAdmin: boolean },
): string[] {
  return RESERVED_NAMESPACES.filter(
    (ns) =>
      ns.appearance === 'standing' &&
      (!ns.standingForAdminOnly || isAdmin) &&
      (ns.feature === null || isFeatureEnabled(config, ns.feature)),
  ).map((ns) => ns.dir)
}

/** The one line each reserved folder's index carries when it declares none. */
export function reservedDescriptions(): Record<string, string> {
  return Object.fromEntries(RESERVED_NAMESPACES.map((ns) => [ns.dir, ns.description]))
}

/**
 * The feature key a path's namespace is owned by, but only when that key is
 * something a space can actually switch off — a core key is never off, so
 * answering with one would mean a gate that can never fire.
 */
export function togglableNamespaceFeature(path: string, config: SpaceFeatureConfig | null | undefined): string | null {
  const ns = namespaceOf(path)
  if (!ns?.feature) return null
  return isFeatureEnabled(config, ns.feature) ? null : ns.feature
}

/**
 * Why a write into this path is refused because the space does not run the tool
 * that owns the namespace — or null when it is allowed. The whole decision,
 * pure: the caller supplies `namespaceHasNotes`, which is the one fact it takes
 * a database to know.
 *
 * FREEZE, DON'T STRAND. The refusal is for a namespace holding NOTHING: a space
 * that already has channels keeps every note openable, editable and renamable
 * when the tool goes off — it just gains no new ones. "Does this namespace hold
 * anything" is also the only predicate that survives the three ways "is this
 * path new" is wrong here: an entity write is canonicalised to the folder form,
 * a sub-note under an existing entity is a new path, and a rename produces a
 * new destination with nothing at it.
 */
export function namespaceFeatureRefusal(
  path: string,
  config: SpaceFeatureConfig | null | undefined,
  namespaceHasNotes: boolean,
): string | null {
  const feature = togglableNamespaceFeature(path, config)
  if (!feature || namespaceHasNotes) return null
  const ns = namespaceOf(path)
  return `"${ns?.dir}" belongs to a tool this space has switched off — turn it on in the console first.`
}
