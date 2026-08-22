/**
 * A space's configuration, as context notes.
 *
 * `nodeTypes`, `linkTypes`, `aliases`, `featureConfig` and `designConfig` are
 * DECLARATIONS in the sense of docs/data-architecture.md — a human decides
 * them, edits them, and later wants to know who changed one and when. They have
 * always been stored as opaque JSON columns on `spaces`, which is why every one
 * of them needed its own rescue when two console panels raced (see the header of
 * ./spaceConfig.ts) and why "who turned the directory off in March" has never
 * been answerable.
 *
 * So the columns get a note beside them. Three notes under `settings/`, each
 * carrying its slice as frontmatter, kept in step with the columns by
 * `updateSpaceConfig` in one direction and by the store hook in the other:
 *
 *   settings/types.md      nodeTypes + linkTypes + aliases   (the vocabulary)
 *   settings/features.md   featureConfig                     (what the space runs)
 *   settings/design.md     designConfig                      (how it looks)
 *
 * That buys revision history, diffs, per-folder grants, and legibility to
 * anything that can read a note — including agents, which previously could not
 * see the vocabulary of the space they were working in.
 *
 * This module is PURE: serialize one way, parse the other, and nothing else.
 * Parsing is TOTAL and defensive — an edited note that does not describe a valid
 * config returns errors and the caller refuses the write, so a malformed note
 * can never reach the columns. That property is what makes it safe for the note
 * to be writable at all.
 */

import { joinFrontmatter, parseFrontmatter } from '@/lib/notes/shared/markdown'
import type { NodeTypeConfig, SpaceAlias, LinkTypeConfig } from '@/lib/types/context'
import type { SpaceDesignConfig, SpaceFeatureConfig } from '@/lib/types/space'
import type { SpaceConfig, SpaceConfigPatch } from './spaceConfig'

const SETTINGS_FOLDER = 'settings'

export const CONFIG_NOTE_PATHS = {
  types: 'settings/types.md',
  features: 'settings/features.md',
  design: 'settings/design.md',
} as const

export type ConfigNoteKind = keyof typeof CONFIG_NOTE_PATHS

const KIND_BY_PATH = new Map<string, ConfigNoteKind>(
  (Object.entries(CONFIG_NOTE_PATHS) as [ConfigNoteKind, string][]).map(([k, p]) => [p, k]),
)

/** Which config note a path is, or null when the path is an ordinary note. */
export function configNoteKindOf(path: string): ConfigNoteKind | null {
  return KIND_BY_PATH.get(path.replace(/^\/+/, '')) ?? null
}

/** True for any path inside `settings/` — the folder the write gate protects. */
export function isSettingsPath(path: string): boolean {
  const p = path.replace(/^\/+/, '')
  return p === SETTINGS_FOLDER || p.startsWith(`${SETTINGS_FOLDER}/`)
}

// ── serialize: config → note ────────────────────────────────────────────────

const HEADER =
  'This note IS the setting — it is not a description of one. Editing it changes ' +
  'the space, and changing the space through the console rewrites it. Every save ' +
  'is kept in the note history, so this is also the record of who changed what.'

function noteOf(
  title: string,
  description: string,
  fields: Record<string, unknown>,
  body: string,
): string {
  return joinFrontmatter(
    {
      // `type` and `description` are what the review pass wants on every note;
      // supplying them keeps a space's own settings out of its clean worklist.
      type: 'Settings',
      title,
      description,
      ...fields,
    },
    `# ${title}\n\n${HEADER}\n\n${body}\n`,
  )
}

/** The markdown for one config note, from the config as stored. */
export function serializeConfigNote(kind: ConfigNoteKind, config: SpaceConfig): string {
  switch (kind) {
    case 'types':
      return noteOf(
        'Types',
        'The vocabulary of this space: node types, link types and the aliases people wear.',
        {
          nodeTypes: config.nodeTypes ?? [],
          linkTypes: config.linkTypes ?? [],
          aliases: config.aliases ?? [],
        },
        'An alias flagged `admin: true` makes its holders admins of this space, so ' +
          'that flag is the space\'s permission model and not a label. `system: true` ' +
          'marks a built-in that cannot be removed.',
      )
    case 'features':
      return noteOf(
        'Features',
        'Which surfaces this space runs, in which order, and who can reach them.',
        { featureConfig: config.featureConfig ?? {} },
        'Turning a feature off hides its surface and refuses its API — it does not ' +
          'delete anything the feature created.',
      )
    case 'design':
      return noteOf(
        'Design',
        'How this space looks: accent colour and the rest of the theme.',
        { designConfig: config.designConfig ?? {} },
        'Colours are hex strings. An empty setting falls back to the product default.',
      )
  }
}

// ── parse: note → config ────────────────────────────────────────────────────

export interface ParsedConfigNote {
  patch: SpaceConfigPatch
  /** Non-empty = the note is not a valid config and MUST NOT be applied. */
  errors: string[]
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/
// Mirrors the NodeShape union in lib/types/context.ts, which is not exported.
const SHAPES: ReadonlySet<string> = new Set(['rectangle', 'hexagon', 'circle', 'square'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Read a frontmatter key that must be a list of objects. A key that is absent
 * entirely yields `undefined` — meaning "not mentioned", which the patch then
 * leaves alone — while a key present but malformed is an error. The difference
 * matters: deleting a key from the note must not silently wipe a column.
 */
function listOf(
  fm: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown>[] | undefined {
  if (!(key in fm)) return undefined
  const raw = fm[key]
  if (!Array.isArray(raw)) {
    errors.push(`${key}: expected a list`)
    return undefined
  }
  const out: Record<string, unknown>[] = []
  raw.forEach((item, i) => {
    if (!isRecord(item)) {
      errors.push(`${key}[${i}]: expected an object`)
      return
    }
    out.push(item)
  })
  return out
}

function parseNodeTypes(items: Record<string, unknown>[], errors: string[]): NodeTypeConfig[] {
  const out: NodeTypeConfig[] = []
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const name = str(item.name)
    const color = str(item.color)
    const shape = str(item.shape)
    if (!name) return errors.push(`nodeTypes[${i}]: name is required`)
    if (seen.has(name.toLowerCase())) return errors.push(`nodeTypes[${i}]: duplicate name "${name}"`)
    // Claimed before the remaining checks so one bad entry cannot hide a
    // duplicate of itself — the point of collecting errors is to report every
    // problem in the note at once.
    seen.add(name.toLowerCase())
    if (!color || !HEX_RE.test(color)) return errors.push(`nodeTypes[${i}] (${name}): color must be a hex string`)
    if (!shape || !SHAPES.has(shape)) {
      return errors.push(`nodeTypes[${i}] (${name}): shape must be one of ${[...SHAPES].join(', ')}`)
    }
    out.push({
      name,
      color,
      shape: shape as NodeTypeConfig['shape'],
      ...(item.scope === 'note' ? { scope: 'note' as const } : {}),
    })
  })
  return out
}

function parseLinkTypes(items: Record<string, unknown>[], errors: string[]): LinkTypeConfig[] {
  const out: LinkTypeConfig[] = []
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const name = str(item.name)
    const color = str(item.color)
    if (!name) return errors.push(`linkTypes[${i}]: name is required`)
    if (seen.has(name.toLowerCase())) return errors.push(`linkTypes[${i}]: duplicate name "${name}"`)
    seen.add(name.toLowerCase())
    if (!color || !HEX_RE.test(color)) return errors.push(`linkTypes[${i}] (${name}): color must be a hex string`)
    if (typeof item.directed !== 'boolean') return errors.push(`linkTypes[${i}] (${name}): directed must be true or false`)
    out.push({
      name,
      color,
      directed: item.directed,
      ...(item.system === true ? { system: true } : {}),
    })
  })
  return out
}

function parseAliases(items: Record<string, unknown>[], errors: string[]): SpaceAlias[] {
  const out: SpaceAlias[] = []
  items.forEach((item, i) => {
    const name = str(item.name)
    const color = str(item.color)
    const nodeType = str(item.nodeType)
    if (!name) return errors.push(`aliases[${i}]: name is required`)
    if (!color || !HEX_RE.test(color)) return errors.push(`aliases[${i}] (${name}): color must be a hex string`)
    if (!nodeType) return errors.push(`aliases[${i}] (${name}): nodeType is required`)
    const id = str(item.id)
    out.push({
      ...(id ? { id } : {}),
      name,
      color,
      nodeType,
      ...(item.admin === true ? { admin: true } : {}),
      ...(item.system === true ? { system: true } : {}),
    })
  })
  return out
}

/**
 * Parse an edited config note back into a patch. Returns errors instead of
 * throwing so the caller can report every problem in the note at once.
 */
export function parseConfigNote(kind: ConfigNoteKind, content: string): ParsedConfigNote {
  const fm = parseFrontmatter(content) as Record<string, unknown>
  const errors: string[] = []
  const patch: SpaceConfigPatch = {}

  if (kind === 'types') {
    const nodeTypes = listOf(fm, 'nodeTypes', errors)
    const linkTypes = listOf(fm, 'linkTypes', errors)
    const aliases = listOf(fm, 'aliases', errors)
    if (nodeTypes) patch.nodeTypes = parseNodeTypes(nodeTypes, errors)
    if (linkTypes) patch.linkTypes = parseLinkTypes(linkTypes, errors)
    if (aliases) patch.aliases = parseAliases(aliases, errors)
  } else if (kind === 'features') {
    if ('featureConfig' in fm) {
      if (isRecord(fm.featureConfig)) patch.featureConfig = fm.featureConfig as SpaceFeatureConfig
      else errors.push('featureConfig: expected an object')
    }
  } else {
    if ('designConfig' in fm) {
      if (isRecord(fm.designConfig)) patch.designConfig = fm.designConfig as SpaceDesignConfig
      else errors.push('designConfig: expected an object')
    }
  }

  return { patch: errors.length ? {} : patch, errors }
}

/**
 * The one rule that cannot be judged from the note alone: an edit must not
 * remove the LAST admin alias. Holding an admin alias is what makes somebody an
 * admin of a space (lib/auth.ts#isAdmin), so an edit that drops the last one
 * locks everybody out of their own console — and nobody left would be allowed
 * to put it back.
 *
 * A transition check, not a validity check. Plenty of real spaces have no admin
 * alias at all (they are administered by super admins, or predate the seeded
 * Admin alias); those are fine and stay fine. What is refused is going from
 * some to none.
 */
export function adminAliasDenial(
  patch: SpaceConfigPatch,
  stored: Pick<SpaceConfig, 'aliases'>,
): string | null {
  if (!patch.aliases) return null
  const had = (stored.aliases ?? []).some((a) => a.admin)
  if (!had) return null
  if (patch.aliases.some((a) => a.admin)) return null
  return (
    'This edit removes the last alias with `admin: true`, which would leave ' +
    'nobody able to administer this space. Keep one admin alias.'
  )
}
