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
//   • A namespace stands the moment the tool that owns it does. A folder is
//     not a consequence of its first note — it is the SHAPE of the tool, and
//     the tool is there from the first second of the space, so the folder is
//     too. `people/` is empty in a space with no people the same way a filing
//     cabinet is empty before anything is filed: still the place things go.
//     The one thing that governs an empty folder is who may write it — a
//     member cannot write `connectors/`, `models/`, `channels/` or `sections/`,
//     so an empty one is noise to them (`standingForAdminOnly`) and it joins
//     their tree for everyone the moment it holds a note.
//   • Every namespace belongs to the TOOL that brings it, and a namespace
//     whose tool is off is not created at all. That is why a new space starts
//     with the folders it does: `people/`, `spaces/`, `events/`, `resources/`,
//     `agents/`, `connectors/`, `models/` and `tools/` are all the DIRECTORY's,
//     and the directory is in every space. `channels/` and `sections/` are the
//     Channels tool's — off in every new space (defaultFeatureConfig) — so
//     switching Channels on is what brings those two folders with it. Adding a
//     tool later is a row here, not a new special case: name its feature key
//     and its folders arrive and leave with it.
//
// NOTHING IS WRITTEN AT CREATION. provisionSpace does not create folder rows
// and never did — a standing folder is grafted into the tree by
// `standingFolders()` at read time (app/api/notes/tree/route.ts). That is what
// makes this table retroactive: every space that already exists gains the
// folders too, with no migration and no rows to keep in step.
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
  /**
   * The TOOL that brings this folder — its feature key. Null only for
   * `subspaces/`, which is no space's own folder at all: federation grafts it
   * at read time. Everything a space actually starts with reads `directory`,
   * because that is why it is there.
   */
  feature: string | null
  /**
   * `standing` = grafted into the tree by the tool that owns it, empty or not,
   * because the folder is the tool's shape rather than a residue of its first
   * note. `derived` = it appears with its first note; only `subspaces/` is
   * derived, and only because no write of this space's ever makes it.
   */
  appearance: 'standing' | 'derived'
  /** Who may write in it. `nobody` = the system or federation only. */
  writes: 'anyone' | 'admin' | 'nobody'
  /** The one line a folder's index carries when it has none of its own. */
  description: string
  /**
   * Stands only for an admin — set on every namespace a member cannot write
   * (`connectors/`, `models/`). An empty folder they have no way to fill is
   * noise to them, but the moment it EXISTS the folder is in the tree for
   * everyone, because it holds a note. This governs the empty case and nothing
   * else.
   */
  standingForAdminOnly?: boolean
}

export const RESERVED_NAMESPACES: readonly Namespace[] = [
  {
    dir: 'people',
    kind: 'person',
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The people this space keeps context about.',
  },
  {
    dir: 'spaces',
    kind: 'space',
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    // The directory's organisation records — a company or group this space
    // tracks. Not this space's sub-spaces: those are grafted into subspaces/.
    description: 'The organisations this space keeps context about.',
  },
  {
    dir: 'events',
    kind: 'event',
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: "This space's events.",
  },
  {
    dir: 'resources',
    kind: 'resource',
    // The Drive is a TAB of the directory (Grid, Context, Resources), not a
    // tool of its own — there is no `resources` key any more.
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The files and links this space keeps.',
  },
  {
    dir: 'channels',
    kind: 'channel',
    // Off in a new space, so unlike the directory's folders these two arrive
    // the moment Channels is switched on rather than at creation — the same
    // rule, applied to a tool that is not there yet.
    feature: 'channels',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: "This space's channels.",
  },
  {
    dir: 'sections',
    kind: 'section',
    feature: 'channels',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: 'The sections the channels are grouped into.',
  },
  {
    dir: 'agents',
    kind: 'agent',
    // The folder is there before the first brief, and anyone who may write
    // context may write one.
    // An agent is a brief in the Context, watched on its node page in the
    // directory — the same place a person, an org and a connector are opened.
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The agents this space runs.',
  },
  {
    dir: 'connectors',
    kind: 'connector',
    // A connector is a record in the directory whose note the console edits.
    feature: 'directory',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: 'The services this space is connected to.',
  },
  {
    dir: 'models',
    kind: 'model',
    // A model note is directory furniture too — what an agent record runs on.
    feature: 'directory',
    // Written from Settings → Models, not from the tree — but the folder is
    // where a member READS what the agents run on, so it stands for the admin
    // who can fill it and joins the tree for everyone once it holds one.
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: "The models this space's agents run on.",
  },
  {
    dir: 'tools',
    kind: 'tool',
    // A Tool is a node you open in the directory like any other, and the
    // marketplace has no switch — what a space runs is decided by publish +
    // approve + install. There is no `tools` key.
    feature: 'directory',
    // Written from the console's Build section rather than the tree, and still
    // standing: `writes: 'anyone'` means every member is someone who could put
    // a Tool there.
    appearance: 'standing',
    writes: 'anyone',
    description: 'The tools built in this space.',
  },
  {
    dir: 'subspaces',
    kind: null,
    feature: null,
    // Never a stored folder and never grafted here either: it appears only
    // when lib/notes/federation.ts has a public sub-space to graft in, so it
    // is the one namespace an empty tree does not show.
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

/**
 * Why nothing of this space's may be written at this path, or null.
 *
 * One namespace answers: `subspaces/`, where a public sub-space's context is
 * READ into this one. Refused for everyone, ahead of the grant check — a folder
 * grant must not be a way in. (It keeps its own longer sentence at
 * lib/spaces/subspaces.ts, which runs first.)
 */
export function reservedWriteDenial(path: string): string | null {
  const ns = namespaceOf(path)
  if (!ns || ns.writes !== 'nobody') return null
  return `"${ns.dir}" is reserved — ${ns.description[0].toLowerCase()}${ns.description.slice(1)}`
}
