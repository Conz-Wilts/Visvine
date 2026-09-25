// The config kinds a note DECLARES — and the gate that follows the declaration.
//
// A connector is a note carrying `type: connector`; a model, `type: model`.
// Both are machine configuration that reaches outside the space (a
// connector's hosts and secrets, a model's provider key), which is why only a
// space admin writes one. For a long time that gate lived on the PATH —
// `connectors/` and `models/` were admin-only — and a connector could live
// nowhere else, because the runtime read `connectors/<name>.md` and nothing
// more.
//
// The path is organisation; the declaration is the thing. A space that files
// its connectors by team (`teams/growth/hubspot.md`) has the same connector,
// with the same perimeter, secrets and audit trail, as one that keeps them in
// `connectors/` — the built-in folder is where a new one LANDS, not the only
// place one may be. So the gate keys on what the note says it is, wherever it
// sits: a note that declares `type: connector` is written, edited, moved and
// deleted by an admin, and a member who could otherwise edit `teams/growth/`
// still cannot touch the connector in it. The path gate on `connectors/` and
// `models/` stays as well — the folder itself is the admin's — so nothing an
// earlier rule allowed or refused changes.
//
// Where one may sit (`configHomeDenial`) is the one shape rule:
// `connectors/<name>.md` / `models/<name>.md`, or any folder of the space's own. Never inside
// another built-in folder, whose paths mean something else (a note under
// `people/x/` is a sub-note about x), never a folder's index (a connector is a
// note; its file name is its name), and never under a federated address
// (`subspaces/`, `parent/`), which is another space's context.
//
// Pure and a leaf: namespaces, indexNote and markdown only, so the write gate,
// the connector runtime, the tree and node:test all read the same rule.

import { isIndexPath } from './indexNote'
import { parseFrontmatter } from './markdown'
import { namespaceOf } from './namespaces'
import type { NoteFrontmatter } from './types'

export type ConfigKind = 'connector' | 'model'

/**
 * A connector's name is its file name — what a brief's `connectors:` line,
 * a secret suffix and the `connector:` node id are cut from.
 */
export const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** The built-in folder a new connector is written to. */
export const CONNECTORS_HOME = 'connectors'

/** The built-in folder a new model is written to. */
export const MODELS_HOME = 'models'

/** A model's name: its file name, which a node id and a secret suffix are cut from. */
const MODEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Where each kind lands, and the name its file may carry. */
const HOMES: Record<ConfigKind, { dir: string; noun: string; name: RegExp; nameRule: string }> = {
  connector: {
    dir: CONNECTORS_HOME,
    noun: 'connector',
    name: CONNECTOR_NAME_RE,
    nameRule: 'letters, digits, "-" and "_", up to 64 characters',
  },
  model: {
    dir: MODELS_HOME,
    noun: 'model',
    name: MODEL_NAME_RE,
    nameRule: 'lowercase letters, digits and "-", up to 64 characters',
  },
}

/**
 * The config kind a note's frontmatter declares, or null. The pre-`models/`
 * shape of a model — `type: connector` with `kind: model` — is a model, as
 * every reader of it agrees (lib/models/config.ts#isLegacyModelConnector).
 */
export function declaredConfigKind(fm: NoteFrontmatter | null | undefined): ConfigKind | null {
  const type = typeof fm?.type === 'string' ? fm.type.trim().toLowerCase() : ''
  if (type === 'model') return 'model'
  if (type !== 'connector') return null
  const kind = typeof fm?.kind === 'string' ? fm.kind.trim().toLowerCase() : ''
  return kind === 'model' ? 'model' : 'connector'
}

/** {@link declaredConfigKind} over a note's text; null for no note. */
export function configKindOfContent(content: string | null | undefined): ConfigKind | null {
  if (!content) return null
  // A cheap look before the parse: most notes are not configuration.
  if (!/^\s*type\s*:/im.test(content)) return null
  return declaredConfigKind(parseFrontmatter(content))
}

/** The sentence a non-admin is refused with, per kind — the same one the path gate says. */
export function configKindWriteDenial(kind: ConfigKind): string {
  return kind === 'connector'
    ? 'Only space admins can create or edit connectors.'
    : 'Only space admins can create or edit models.'
}

/**
 * The name a note path carries for `kind` — its file name without `.md` —
 * or null when the path cannot name one: a folder index, a non-markdown
 * path, or a name the runtime would refuse.
 */
export function configNameOfPath(kind: ConfigKind, path: string): string | null {
  const raw = path.replace(/^\/+/, '')
  if (!/\.md$/i.test(raw) || isIndexPath(raw)) return null
  const name = raw.slice(raw.lastIndexOf('/') + 1, -3)
  return HOMES[kind].name.test(name) ? name : null
}

/** {@link configNameOfPath} for a connector. */
export function connectorNameOfPath(path: string): string | null {
  return configNameOfPath('connector', path)
}

/** {@link configNameOfPath} for a model. */
export function modelNameOfNotePath(path: string): string | null {
  return configNameOfPath('model', path)
}

/**
 * Why a note declaring `kind` may not sit at `path`, or null when it may:
 * `<home>/<name>.md` or any folder of the space's own. Shape only — who may
 * write it is the gate's question. A model's legacy home, `connectors/`, is
 * read by lib/agents/spaceModels.ts and never written to.
 */
export function configHomeDenial(kind: ConfigKind, path: string): string | null {
  const { dir, noun, nameRule } = HOMES[kind]
  const raw = path.replace(/^\/+/, '')
  if (isIndexPath(raw)) return `A ${noun} is a note, not a folder — its file name is its name.`
  const name = configNameOfPath(kind, raw)
  if (!name) return `A ${noun}’s file name is its name: ${nameRule}.`
  const ns = namespaceOf(raw)
  if (!ns) return null
  if (ns.writes === 'nobody') return `A ${noun} is written in the space that owns it.`
  if (ns.dir !== dir) {
    return `"${ns.dir}" is one of the space's built-in folders — a ${noun} sits in "${dir}/" or in a folder of your own.`
  }
  if (raw !== `${dir}/${name}.md`) {
    return `Inside "${dir}/" a ${noun} is ${dir}/<name>.md — to group them, use a folder of your own.`
  }
  return null
}

/** {@link configHomeDenial} for a connector. */
export function connectorHomeDenial(path: string): string | null {
  return configHomeDenial('connector', path)
}

/** True when a note at `path` with this content IS a connector the runtime will read. */
export function isConnectorNoteAt(path: string, content: string): boolean {
  return configKindOfContent(content) === 'connector' && connectorHomeDenial(path) === null
}

/**
 * True when a note at `path` with this content IS a model the runtime will
 * read: `type: model`, sitting where a model may. The legacy shape
 * (`connectors/<name>.md`, `kind: model`) is read separately.
 */
export function isModelNoteAt(path: string, content: string): boolean {
  if (!/^\s*type\s*:\s*model\s*$/im.test(content)) return false
  return configKindOfContent(content) === 'model' && configHomeDenial('model', path) === null
}
