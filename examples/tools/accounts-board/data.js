// The server-side half of the Accounts Board. Runs in the QuickJS isolate
// (lib/tools/dataRun.ts) as a plain script — no imports, no exports, no network.
// `visvine` is the same bridge the interface uses, so every read below goes
// through the perimeter declared in index.md and lands under the viewer's own
// grants. The perimeter is read-only, so nothing here writes.
//
// Frontmatter is never parsed in the Tool: `visvine.context.read` hands it back
// already parsed by Visvine's own YAML parser. See index.md.

/**
 * Organisations one load will read. `context.list` hands back path/title/type
 * but NOT tags, and the segment lives in the tags — so each organisation costs
 * a read. The isolate has 20s, so this is the honest ceiling rather than a
 * guess; when it bites, the interface says so instead of quietly showing a
 * partial board.
 */
const MAX_ORGS = 200

const UNSORTED = 'Unsorted'

/** Tags that say what an organisation is TO US rather than what it does. */
const RELATIONSHIP_TAGS = ['customer', 'design-partner', 'prospect', 'investor', 'partner']

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function tagsOf(front) {
  const raw = front && front.tags
  if (!Array.isArray(raw)) return []
  const out = []
  for (const tag of raw) {
    const value = trimmed(tag).toLowerCase()
    if (value) out.push(value)
  }
  return out
}

/** "segments/venture-capital.md" → "venture-capital" */
function slugOfFlatPath(path, dir) {
  const match = new RegExp('^' + dir + '/([^/]+)\\.md$').exec(String(path || ''))
  return match ? match[1] : null
}

/**
 * "communities/kowhai-labs/index.md" → "kowhai-labs".
 * Null for the namespace's own index, which is not an organisation — the read
 * glob's middle `**` matches zero segments too, so it arrives here as well.
 */
function slugOfFolderPath(path, dir) {
  const match = new RegExp('^' + dir + '/([^/]+)/index\\.md$').exec(String(path || ''))
  return match ? match[1] : null
}

/** A slug read back as words, for a note that never set a title. */
function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The segment vocabulary, read from the `segments/` notes rather than
 * hardcoded: a space that renames a segment or adds one gets it here for free.
 * Returns a slug → display-title map, e.g. { 'venture-capital': 'Venture Capital' }.
 */
async function segmentTitles(visvine) {
  const titles = {}
  const entries = await visvine.context.list('segments/*.md')
  for (const entry of entries) {
    const slug = slugOfFlatPath(entry.path, 'segments')
    if (!slug || slug === 'index') continue
    titles[slug] = trimmed(entry.title) || titleFromSlug(slug)
  }
  return titles
}

/**
 * The board. One cheap list of the segment vocabulary, then one read per
 * organisation note for its tags — which is where both the segment and the
 * relationship live.
 */
handlers.loadBoard = async (args, visvine) => {
  const titles = await segmentTitles(visvine)

  const entries = await visvine.context.list('communities/**/index.md')
  const wanted = []
  for (const entry of entries) {
    const slug = slugOfFolderPath(entry.path, 'communities')
    // The namespace index is not an organisation.
    if (!slug || slug === 'index') continue
    wanted.push({ slug: slug, path: entry.path, title: entry.title, updatedAt: entry.updatedAt })
  }
  wanted.sort((a, b) => a.slug.localeCompare(b.slug))

  const truncated = wanted.length > MAX_ORGS
  const orgs = []
  for (const item of wanted.slice(0, MAX_ORGS)) {
    let front = {}
    try {
      const note = await visvine.context.read(item.path)
      front = (note && note.frontmatter) || {}
    } catch (e) {
      // A note the viewer cannot read is simply not on their board. Skipping it
      // is the correct outcome: the perimeter and their grants both still hold.
      continue
    }

    const tags = tagsOf(front)
    let segment = ''
    let relationship = ''
    for (const tag of tags) {
      // A segment is a tag that names a real segment note — which is why the
      // vocabulary is read rather than pattern-matched. Anything unrecognised
      // is left alone rather than guessed at.
      if (!segment && titles[tag]) segment = tag
      if (!relationship && RELATIONSHIP_TAGS.indexOf(tag) !== -1) relationship = tag
    }

    orgs.push({
      slug: item.slug,
      path: item.path,
      title: trimmed(front.title) || trimmed(item.title) || titleFromSlug(item.slug),
      segment: segment ? titles[segment] : UNSORTED,
      relationship: relationship,
      updatedAt: item.updatedAt,
    })
  }

  // Group into the columns the interface draws, biggest first so the board
  // reads top-down by where the space actually has weight.
  const bySegment = {}
  for (const org of orgs) {
    if (!bySegment[org.segment]) bySegment[org.segment] = []
    bySegment[org.segment].push(org)
  }
  const segments = Object.keys(bySegment)
    .sort((a, b) => {
      // Unsorted always last, however big it is.
      if (a === UNSORTED) return 1
      if (b === UNSORTED) return -1
      return bySegment[b].length - bySegment[a].length || a.localeCompare(b)
    })
    .map((name) => ({ name: name, orgs: bySegment[name] }))

  return {
    segments: segments,
    total: orgs.length,
    truncated: truncated,
    limit: MAX_ORGS,
  }
}
