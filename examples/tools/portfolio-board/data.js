// The server-side half of the Portfolio Board. Runs in the QuickJS isolate
// (lib/tools/dataRun.ts) as a plain script — no imports, no exports, no network.
// `visvine` is the same bridge the interface uses, so every read below goes
// through the perimeter declared in index.md and lands under the viewer's own
// grants. The perimeter is read-only, so nothing here writes.
//
// Frontmatter is never parsed in the Tool: `visvine.context.read` hands it back
// already parsed by Visvine's own YAML parser. See index.md.

/**
 * Companies one load will read. `context.list` hands back path/title/type but
 * NOT tags, and the sector lives in the tags — so each company costs a read.
 * The isolate has 20s, so this is the honest ceiling rather than a guess; when
 * it bites, the interface says so instead of quietly showing a partial board.
 */
const MAX_COMPANIES = 200

const UNSORTED = 'Unsorted'

/** Tags that say what happened to a company rather than what it does. */
const STATUS_TAGS = ['active', 'onboarding', 'exit', 'exits', 'ipo', 'written-off']

/** Tags every company note carries, which say nothing about this company. */
const NOISE_TAGS = ['portfolio', 'company']

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

/** "communities/alloy-robotics.md" → "alloy-robotics" */
function slugOfPath(path, dir) {
  const match = new RegExp('^' + dir + '/([^/]+)\\.md$').exec(String(path || ''))
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
 * The sector vocabulary, read from the `sectors/` notes rather than hardcoded:
 * a space that renames a sector or adds one gets it here for free. Returns a
 * slug → display-title map, e.g. { 'agtech-food': 'Agtech & Food' }.
 */
async function sectorTitles(visvine) {
  const titles = {}
  const entries = await visvine.context.list('sectors/*.md')
  for (const entry of entries) {
    const slug = slugOfPath(entry.path, 'sectors')
    if (!slug || slug === 'index') continue
    titles[slug] = trimmed(entry.title) || titleFromSlug(slug)
  }
  return titles
}

/**
 * The board. One cheap list of the sector vocabulary, then one read per company
 * note for its tags — which is where both the sector and the status live.
 */
handlers.loadPortfolio = async (args, visvine) => {
  const titles = await sectorTitles(visvine)

  const entries = await visvine.context.list('communities/*.md')
  const wanted = []
  for (const entry of entries) {
    const slug = slugOfPath(entry.path, 'communities')
    // The folder index is not a company.
    if (!slug || slug === 'index') continue
    wanted.push({ slug: slug, path: entry.path, title: entry.title, updatedAt: entry.updatedAt })
  }
  wanted.sort((a, b) => a.slug.localeCompare(b.slug))

  const truncated = wanted.length > MAX_COMPANIES
  const companies = []
  for (const item of wanted.slice(0, MAX_COMPANIES)) {
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
    let sector = ''
    let status = ''
    for (const tag of tags) {
      // A sector is a tag that names a real sector note — which is why the
      // vocabulary is read rather than pattern-matched. Anything unrecognised
      // is left alone rather than guessed at.
      if (!sector && titles[tag]) sector = tag
      if (!status && STATUS_TAGS.indexOf(tag) !== -1) status = tag
    }

    companies.push({
      slug: item.slug,
      path: item.path,
      title: trimmed(front.title) || trimmed(item.title) || titleFromSlug(item.slug),
      sector: sector ? titles[sector] : UNSORTED,
      status: status,
      updatedAt: item.updatedAt,
    })
  }

  // Group into the columns the interface draws, biggest first so the board
  // reads top-down by where the portfolio actually has weight.
  const bySector = {}
  for (const company of companies) {
    if (!bySector[company.sector]) bySector[company.sector] = []
    bySector[company.sector].push(company)
  }
  const sectors = Object.keys(bySector)
    .sort((a, b) => {
      // Unsorted always last, however big it is.
      if (a === UNSORTED) return 1
      if (b === UNSORTED) return -1
      return bySector[b].length - bySector[a].length || a.localeCompare(b)
    })
    .map((name) => ({ name: name, companies: bySector[name] }))

  return {
    sectors: sectors,
    total: companies.length,
    truncated: truncated,
    limit: MAX_COMPANIES,
  }
}
