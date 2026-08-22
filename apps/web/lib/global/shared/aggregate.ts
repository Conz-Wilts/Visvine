// The pure half of the global record: how one person's public facts, gathered
// from several sources, become ONE set of node fields and ONE machine-written
// block in their `people/<slug>.md` note in the Visvine space.
//
// No DB access. lib/global/record.ts loads the sources and writes the result;
// this file decides what the result is, so the survivorship rule is testable
// on its own (tests/global-record.test.ts).

export interface GlobalSource {
  /** Where the facts came from, for the "Appears in" list and for ranking. */
  kind: 'profile' | 'node'
  /** The public space the node lives in; null for a member's own profile. */
  spaceId: string | null
  spaceName: string | null
  name: string | null
  subtitle: string | null
  location: string | null
  url: string | null
  imageUrl: string | null
  tags: string[]
  /** Profile only: free prose the member wrote about themselves. */
  bio?: string | null
  /** Node only: the node's id in its space, for a deep link. */
  nodeId?: string | null
}

interface GlobalFields {
  name: string
  subtitle: string | null
  location: string | null
  url: string | null
  imageUrl: string | null
  tags: string[]
}

export interface GlobalRecord {
  fields: GlobalFields
  bio: string | null
  /** Every public space the person has a node in, in stable name order. */
  appearsIn: Array<{ spaceId: string; spaceName: string; nodeId: string | null }>
}

export const GLOBAL_OPEN = '<!-- global:record -->'
export const GLOBAL_CLOSE = '<!-- /global:record -->'

function filled(s: GlobalSource): number {
  let n = 0
  if (s.subtitle) n++
  if (s.location) n++
  if (s.url) n++
  if (s.imageUrl) n++
  if (s.tags.length) n++
  return n
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  return v ? v : null
}

/**
 * Survivorship: the member's own profile is the authority on who they are —
 * it is the one source THEY wrote — so it wins every field it fills. Behind
 * it, public-space nodes fill the gaps, the most complete node first, so a
 * single rich card in one space is not diluted by three thin ones elsewhere.
 * Tags are the union, de-duplicated case-insensitively, profile tags first.
 *
 * `fallbackName` is the Identity's canonical name, used only when no source
 * carries one (a freshly minted identity with nothing public yet).
 */
export function aggregateGlobalRecord(sources: GlobalSource[], fallbackName: string): GlobalRecord {
  const profile = sources.find((s) => s.kind === 'profile') ?? null
  const nodes = sources
    .filter((s) => s.kind === 'node')
    .slice()
    .sort((a, b) => filled(b) - filled(a) || (a.spaceName ?? '').localeCompare(b.spaceName ?? ''))
  const ordered = profile ? [profile, ...nodes] : nodes

  const pick = (key: 'name' | 'subtitle' | 'location' | 'url' | 'imageUrl'): string | null => {
    for (const s of ordered) {
      const v = clean(s[key])
      if (v) return v
    }
    return null
  }

  const seen = new Set<string>()
  const tags: string[] = []
  for (const s of ordered) {
    for (const raw of s.tags) {
      const tag = raw.trim()
      if (!tag || seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      tags.push(tag)
    }
  }

  const appearsIn = nodes
    .filter((s): s is GlobalSource & { spaceId: string } => !!s.spaceId)
    .map((s) => ({ spaceId: s.spaceId, spaceName: s.spaceName ?? s.spaceId, nodeId: s.nodeId ?? null }))
    .sort((a, b) => a.spaceName.localeCompare(b.spaceName))

  return {
    fields: {
      name: pick('name') ?? fallbackName,
      subtitle: pick('subtitle'),
      location: pick('location'),
      url: pick('url'),
      imageUrl: pick('imageUrl'),
      tags,
    },
    bio: clean(profile?.bio),
    appearsIn,
  }
}

/** The machine-maintained block: facts the platform gathered, never prose a person typed. */
export function renderGlobalBlock(record: GlobalRecord): string {
  const lines: string[] = [GLOBAL_OPEN]
  if (record.fields.subtitle) lines.push(`> ${record.fields.subtitle}`, '')
  if (record.bio) lines.push(record.bio.trim(), '')
  const facts: string[] = []
  if (record.fields.location) facts.push(`- Location: ${record.fields.location}`)
  if (record.fields.url) facts.push(`- Website: ${record.fields.url}`)
  if (facts.length) lines.push(...facts, '')
  if (record.appearsIn.length) {
    lines.push('## Appears in', '')
    for (const a of record.appearsIn) lines.push(`- ${a.spaceName}`)
    lines.push('')
  }
  lines.push(GLOBAL_CLOSE)
  return lines.join('\n')
}

/**
 * Put the machine block into a note body, keeping everything a person wrote
 * around it. A body with no block gets one at the top; a body with one has it
 * replaced in place. Same contract as the index children block.
 */
export function applyGlobalBlock(body: string, block: string): string {
  const open = body.indexOf(GLOBAL_OPEN)
  const close = body.indexOf(GLOBAL_CLOSE)
  if (open !== -1 && close !== -1 && close > open) {
    return body.slice(0, open) + block + body.slice(close + GLOBAL_CLOSE.length)
  }
  const rest = body.trim()
  return rest ? `${block}\n\n${rest}\n` : `${block}\n`
}

/** The prose outside the machine block — what a person wrote about themselves. */
export function proseOutsideGlobalBlock(body: string): string {
  const open = body.indexOf(GLOBAL_OPEN)
  const close = body.indexOf(GLOBAL_CLOSE)
  if (open === -1 || close === -1 || close < open) return body.trim()
  return (body.slice(0, open) + body.slice(close + GLOBAL_CLOSE.length)).trim()
}
