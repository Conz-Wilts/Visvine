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
// A namespace folder is PLACED, never moved (lib/notes/shared/placedFolders.ts):
// its path is the address the runtime resolves against, so the tree may draw
// it under a folder of the space's own for organisation, but `agents/` is
// `agents/` wherever it is drawn. The row's `icon` is what tells it apart from
// an ordinary folder in the tree.
//
// This module is a LEAF on purpose: lib/notes/entities.ts imports
// ./shared/indexNote, and indexNote imports this, so importing either from
// here would close a cycle. It imports the feature helpers, the React-free
// icon names and nothing else, which also keeps it runnable under node:test
// and the tsx scripts.

import { isFeatureEnabled } from '../../featureAccess'
import type { IconName } from '../../icons/names'
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
   * The glyph the tree draws the folder with — the tool's own, so a built-in
   * folder reads as the shape of a tool rather than as a folder somebody made
   * (features/notes/components/NoteSidebar.tsx). A name, not a component: this
   * module is React-free.
   */
  icon: IconName
  /**
   * Stands only for an admin — set on every namespace a member cannot write
   * (`connectors/`, `models/`). An empty folder they have no way to fill is
   * noise to them, but the moment it EXISTS the folder is in the tree for
   * everyone, because it holds a note. This governs the empty case and nothing
   * else.
   */
  standingForAdminOnly?: boolean
  /**
   * A LANDING folder: where a new thing of its kind is written, and nothing
   * more. Its kind is found by what a note declares, wherever it is filed
   * (lib/agents/location.ts, lib/tools/location.ts, lib/connectors/locate.ts,
   * lib/models/locate.ts), so the folder itself may be moved into a folder of
   * the space's own — the index of wherever it lands says `home: <dir>`, and
   * new things land there — or deleted while it holds nothing. The rest are
   * fixed: their paths are identity (an entity's note, a resource's bytes) or
   * another space's context.
   */
  landing?: true
}

export const RESERVED_NAMESPACES: readonly Namespace[] = [
  {
    dir: 'people',
    kind: 'person',
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The people this space keeps context about.',
    icon: 'nav-directory',
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
    icon: 'space',
  },
  {
    dir: 'events',
    kind: 'event',
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: "This space's events.",
    icon: 'nav-events',
  },
  {
    dir: 'resources',
    kind: 'resource',
    // Resources are Directory records, each a file or a link — not a tool of
    // their own, so there is no `resources` key.
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The files and links this space keeps.',
    icon: 'nav-resources',
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
    icon: 'nav-channels',
  },
  {
    dir: 'sections',
    kind: 'section',
    feature: 'channels',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: 'The sections the channels are grouped into.',
    icon: 'hash',
  },
  {
    dir: 'agents',
    landing: true,
    kind: 'agent',
    // The folder is there before the first brief, and anyone who may write
    // context may write one.
    // An agent is a brief in the Context, watched on its node page in the
    // directory — the same place a person, an org and a connector are opened.
    feature: 'directory',
    appearance: 'standing',
    writes: 'anyone',
    description: 'The agents this space runs.',
    icon: 'nav-agents',
  },
  {
    dir: 'connectors',
    landing: true,
    kind: 'connector',
    // A connector is a record in the directory whose note the console edits.
    // This folder is where a new one is written; an admin may file it in a
    // folder of the space's own afterwards, and it stays the connector, because
    // a connector is what a note declares (./configKinds.ts).
    feature: 'directory',
    appearance: 'standing',
    writes: 'admin',
    standingForAdminOnly: true,
    description: 'The services this space is connected to.',
    icon: 'nav-connectors',
  },
  {
    dir: 'models',
    landing: true,
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
    icon: 'brain',
  },
  {
    dir: 'tools',
    landing: true,
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
    icon: 'nav-tools',
  },
  {
    dir: 'subspaces',
    kind: null,
    feature: null,
    // Never a stored folder: it is the reserved address a sub-space is read
    // under, and federation draws it — one `Sub-spaces` folder holding a
    // folder per room (lib/spaces/subspaces.ts#ensureSubspacesFolder) — only
    // when there is a room to draw. Derived, because no write of this
    // space's ever makes it.
    appearance: 'derived',
    writes: 'nobody',
    description: "This space's sub-spaces, each read as of now — written in the sub-space itself.",
    icon: 'space',
  },
  {
    dir: 'parent',
    kind: null,
    feature: null,
    // The mirror: what the space this one sits inside shares with it — its
    // connector and agent notes flagged `share: subspaces` — grafted as one
    // folder named after the parent, only when there is something in it
    // (lib/notes/federation.ts#federateParent). Never a stored folder.
    appearance: 'derived',
    writes: 'nobody',
    description: 'What the space this one sits inside shares with it — read-only.',
    icon: 'space',
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
  { isAdmin, homes, hidden }: { isAdmin: boolean; homes?: ReadonlyMap<string, string>; hidden?: readonly string[] },
): string[] {
  return RESERVED_NAMESPACES.filter(
    (ns) =>
      ns.appearance === 'standing' &&
      (!ns.standingForAdminOnly || isAdmin) &&
      (ns.feature === null || isFeatureEnabled(config, ns.feature)) &&
      // A landing folder the space moved stands where it went (it is a real
      // folder there, with an index); one it deleted stands only while
      // something is in it.
      !(ns.landing && ((homes?.get(ns.dir) ?? ns.dir) !== ns.dir || hidden?.includes(ns.dir))),
  ).map((ns) => ns.dir)
}

/** True for a landing folder's own path — `agents`, `tools`, `connectors`, `models`. */
export function isLandingDir(path: string): boolean {
  return BY_DIR.get(path)?.landing === true
}

/** The key on a folder's index naming the landing folder it has become: `home: agents`. */
export const HOME_KEY = 'home'

/** The key on the root index listing the landing folders the space deleted: `hidden: [models]`. */
export const HIDDEN_KEY = 'hidden'

/**
 * Where each landing folder is, from the index notes' `home:` keys — only the
 * ones that moved. The first folder (by path) to claim a dir wins it.
 */
export function landingHomesFrom(indexes: ReadonlyArray<{ path: string; frontmatter: Record<string, unknown> | null | undefined }>): Map<string, string> {
  const out = new Map<string, string>()
  for (const note of [...indexes].sort((a, b) => a.path.localeCompare(b.path))) {
    const home = note.frontmatter?.[HOME_KEY]
    if (typeof home !== 'string' || !isLandingDir(home.trim()) || out.has(home.trim())) continue
    if (!note.path.endsWith('/index.md')) continue
    const folder = note.path.slice(0, -'/index.md'.length)
    // A landing folder sits in a folder of the space's own, never in another
    // built-in one.
    if (namespaceOf(folder)) continue
    out.set(home.trim(), folder)
  }
  return out
}

/** The landing folders the root index lists as deleted. */
export function hiddenLandingsOf(rootFrontmatter: Record<string, unknown> | null | undefined): string[] {
  const raw = rootFrontmatter?.[HIDDEN_KEY]
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.map((x) => String(x).trim()).filter(isLandingDir)
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
