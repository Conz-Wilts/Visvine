// Seeds the "Blackbird Ventures" notes contexts with rich, data-driven content.
//
// Builds two contexts in the context_notes table:
//   • the SHARED space context (owner_key = 'shared') — a portfolio knowledge
//     base generated from ./data/blackbird-ventures.research.json: a per-company
//     note for all 182 portfolio companies, one note per lead founder, per-sector
//     index pages, partner notes, a deals pipeline and fund-data notes — every
//     internal reference is an absolute `/path.md` link so the notes graph,
//     backlinks and search all light up.
//   • a PERSONAL "My Notes" context (owner_key = <space admin userId>) — a small
//     self-contained set of working notes (journal, meetings, watchlist, todos,
//     diligence) cross-linked to each other.
//
//   pnpm db:blackbird:notes            (after pnpm db:blackbird)
//   pnpm db:blackbird:notes -- --reset (clean rebuild of the live seeded notes)
//
// Requires the space + users from `pnpm db:blackbird` to already exist.
// Loads apps/web/.env (cwd-independent, via the guard) and refuses to run against
// any non-local host — same guard the destructive db:* scripts use.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-blackbird-notes: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const DATA_PATH = join(__dirname, 'data', 'blackbird-ventures.research.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const RAW = Array.isArray(data.companies) ? data.companies : [];

const pool = new pg.Pool({ connectionString });

const COMM = 'community:blackbird-ventures';
const SHARED = 'shared';
const RESET = process.argv.includes('--reset');
// 'all': every founder gets a people/<slug>.md note. Context notes are the
// source of graph links now (origin 'context'), so every founder must be
// mentioned from an entity note for the founder↔company edges to exist.
const FOUNDER_NOTE_MODE = 'all'; // 'lead' | 'all' | 'none'

// ---- taxonomy (kept in sync with add-blackbird-ventures.mjs CRM columns) -----

const SECTOR_OPTIONS = [
  'Fintech', 'Healthtech', 'Climate & Energy', 'SaaS & Enterprise',
  'Consumer & Marketplace', 'AI & ML', 'Deep Tech & Hardware', 'Space & Defence',
  'Biotech', 'Developer Tools', 'Agtech & Food', 'Crypto & Web3', 'Other',
];

const SECTOR_BLURB = {
  'Fintech': 'Payments, banking, lending and the financial infrastructure rails.',
  'Healthtech': 'Care delivery, clinical tooling and patient-facing health software.',
  'Climate & Energy': 'Decarbonisation, clean energy, grid and climate hardware.',
  'SaaS & Enterprise': 'B2B software giving functional teams superpowers.',
  'Consumer & Marketplace': 'Consumer products, marketplaces and creator tools.',
  'AI & ML': 'Foundation models, applied AI and machine-learning infrastructure.',
  'Deep Tech & Hardware': 'Robotics, semiconductors, sensors and frontier hardware.',
  'Space & Defence': 'Space access, satellites and sovereign defence capability.',
  'Biotech': 'Synthetic biology, therapeutics and the engineering of life.',
  'Developer Tools': 'Infrastructure, observability and the tools developers love.',
  'Agtech & Food': 'Agriculture, food production and the future of farming.',
  'Crypto & Web3': 'Digital assets, tokens and decentralised infrastructure.',
  'Other': "Companies that don't fit a single sector bucket.",
};

const STATUS_GROUP = {
  'Active': 'active', 'Exited': 'exit', 'IPO': 'ipo',
  'Onboarding': 'onboarding', 'Written Off': 'written-off',
};

// ---- helpers (slug/sector/stage copied from add-blackbird-ventures.mjs) ------

function slugify(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
}

const SECTOR_RULES = [
  ['Crypto & Web3', ['crypto', 'web3', 'blockchain', 'nft', 'token', 'tokenization', 'stablecoin', 'digital asset']],
  ['Fintech', ['fintech', 'payments', 'payment', 'banking', 'bank', 'lending', 'insurtech', 'insurance', 'wealth', 'remittance', 'financial', 'invoicing', 'accounting', 'payroll', 'spend management', 'treasury']],
  ['Space & Defence', ['satellite', 'spacecraft', 'rocket', 'aerospace', 'orbital', 'launch vehicle', 'hypersonic', 'space tech', 'space technology', 'defence', 'defense', 'missile']],
  ['Biotech', ['biotech', 'biotechnology', 'genomics', 'genomic', 'synthetic biology', 'drug discovery', 'life sciences', 'bioengineering', 'cultivated', 'cultured', 'protein', 'vaccine', 'molecular']],
  ['Healthtech', ['health', 'healthcare', 'medical', 'clinical', 'clinic', 'patient', 'wellness', 'mental health', 'telehealth', 'pharma', 'pharmaceutical', 'therapeutics', 'diagnostics', 'medtech']],
  ['Climate & Energy', ['climate', 'energy', 'solar', 'battery', 'batteries', 'carbon', 'renewable', 'cleantech', 'grid', 'hydrogen', 'emissions', 'sustainability', 'geothermal', 'nuclear', 'fusion']],
  ['Agtech & Food', ['agritech', 'agtech', 'farming', 'farm', 'agriculture', 'agricultural', 'livestock', 'dairy', 'crop', 'cattle', 'aquaculture', 'food']],
  ['Deep Tech & Hardware', ['quantum', 'robotics', 'robot', 'hardware', 'semiconductor', 'sensors', 'sensor', 'photonics', 'lidar', 'materials', 'manufacturing', 'drone', 'chip', 'wireless', 'neurotech', 'bionic', 'electronics', 'autonomous']],
  ['Developer Tools', ['developer', 'devtools', 'devops', 'infrastructure', 'observability', 'sdk', 'database', 'api', 'inference', 'deployment', 'compute']],
  ['AI & ML', ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'generative ai', 'genai', 'computer vision', 'agentic', 'neural']],
  ['SaaS & Enterprise', ['saas', 'enterprise', 'b2b', 'crm', 'hr', 'workflow', 'productivity', 'compliance', 'procurement', 'analytics']],
  ['Consumer & Marketplace', ['consumer', 'marketplace', 'ecommerce', 'e-commerce', 'retail', 'social', 'creator', 'gaming', 'dating', 'travel', 'fashion', 'subscription']],
];

function kwRegex(k) {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + '\\b', 'i');
}

function snapSector(c) {
  const hay = [c.sector, (c.subSectors || []).join(' ')].filter(Boolean).join(' ');
  if (!hay.trim()) return 'Other';
  for (const [label, kws] of SECTOR_RULES) {
    if (kws.some((k) => kwRegex(k).test(hay))) return label;
  }
  return 'Other';
}

function parseRound(s) {
  if (!s) return null;
  const l = String(s).toLowerCase();
  if (l.includes('pre-seed') || l.includes('preseed') || l.includes('pre seed')) return 'Pre-seed';
  if (/series\s*[d-z]/.test(l)) return 'Series D+';
  if (l.includes('series c')) return 'Series C';
  if (l.includes('series b')) return 'Series B';
  if (l.includes('series a')) return 'Series A';
  if (l.includes('seed')) return 'Seed';
  if (l.includes('growth') || l.includes('late')) return 'Growth';
  if (l.includes('ipo') || l.includes('public')) return 'Public';
  if (l.includes('acqui')) return 'Acquired';
  return null;
}

function snapStage(c) {
  if (c.status === 'IPO') return 'Public';
  const parsed = parseRound(c.fundingStage);
  if (c.status === 'Written Off') return parsed || 'Defunct';
  if (c.status === 'Exited') return parsed || 'Acquired';
  return parsed; // Active / Onboarding: may be null
}

function normLinkedin(u) {
  if (!u) return null;
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('?')[0].replace(/\/+$/, '');
  return s || null;
}

// ---- markdown emitters -------------------------------------------------------

// Frontmatter as YAML the app's `yaml` parser accepts. Every scalar is emitted
// via JSON.stringify (a JSON string is a valid YAML double-quoted scalar), so
// titles/descriptions containing `:` `&` or quotes always parse correctly.
function fm(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      const arr = v.filter((x) => x !== null && x !== undefined && x !== '');
      if (!arr.length) continue;
      lines.push(`${k}: [${arr.map((x) => JSON.stringify(String(x))).join(', ')}]`);
    } else {
      lines.push(`${k}: ${JSON.stringify(String(v))}`);
    }
  }
  return lines.join('\n');
}

// Drop a leading `# Heading` line from a body: the note title now renders from
// frontmatter (see NoteEditor's notes-title), so a body-level title would duplicate
// it. Removes the first line if it's an ATX heading, plus the blank line after it.
function stripLeadingHeading(body) {
  const t = body.trim();
  const m = t.match(/^#{1,6}[ \t]+.*(?:\r?\n|$)/);
  return m ? t.slice(m[0].length).replace(/^\s*\r?\n/, '') : t;
}

// A note's full markdown. Matches joinFrontmatter's shape: `---\n…\n---\n\nbody\n`.
function note(notes, path, frontmatter, body, pinned = false) {
  notes.push({ path, content: `---\n${fm(frontmatter)}\n---\n\n${stripLeadingHeading(body)}\n`, pinned });
}

// Internal link → graph edge (absolute context-root href, must include `.md`).
const link = (label, absPath) => `[${label}](${absPath})`;
// External link → rendered but never a graph edge (http/mailto are dropped).
const ext = (label, url) => (url ? `[${label}](${url})` : null);
const joinDot = (parts) => parts.filter(Boolean).join('  ·  ');

// ---- build the in-memory model ----------------------------------------------

const orgs = [];               // { slug, c, sector, stage, statusGroup, founders:[{...f,key}] }
const orgBySlug = new Map();
const orgByName = new Map();    // lowercased name → org
const companiesBySector = new Map();
const slugSeen = new Set();

for (const c of RAW) {
  if (!c || !c.name) continue;
  let base = slugify(c.name) || ('co-' + orgs.length);
  let slug = base;
  if (slugSeen.has(slug)) {
    const suf = slugify(c.hqCountry || '') || 'x';
    slug = `${base}-${suf}`;
    let n = 2;
    while (slugSeen.has(slug)) { slug = `${base}-${suf}-${n}`; n++; }
  }
  slugSeen.add(slug);

  const sector = snapSector(c);
  const org = {
    slug, c, sector,
    stage: snapStage(c),
    statusGroup: STATUS_GROUP[c.status] ?? null,
    founders: [],
  };
  orgs.push(org);
  orgBySlug.set(slug, org);
  orgByName.set(c.name.trim().toLowerCase(), org);
  if (!companiesBySector.has(sector)) companiesBySector.set(sector, []);
  companiesBySector.get(sector).push(org);
}

// Founders: dedupe across companies (linkedin first, else name), then decide
// which get their own note. `lead` mode = the first founder of each company plus
// anyone spanning more than one company.
const personByKey = new Map(); // key → { key, name, role, bio, linkedinUrl, twitterUrl, website, location, companies:Set<slug> }

function dedupeKey(f) {
  const li = normLinkedin(f.linkedinUrl);
  return li ? 'li:' + li : 'nm:' + slugify(f.name);
}
function mergePerson(p, f) {
  if (!p.role && f.role) p.role = f.role;
  if (!p.bio && f.bio) p.bio = f.bio;
  if (!p.linkedinUrl && f.linkedinUrl) p.linkedinUrl = f.linkedinUrl;
  if (!p.twitterUrl && f.twitterUrl) p.twitterUrl = f.twitterUrl;
  if (!p.website && f.website) p.website = f.website;
  if (!p.location && f.location) p.location = f.location;
}

// Slug assignment mirrors add-blackbird-ventures.mjs exactly (same iteration
// order + collision suffix = current org slug), so each person's note slug equals
// its directory node id (`person:<slug>`). That makes people/<slug>.md the
// canonical entity-note path that `[[ ]]` mentions resolve to.
const personSlugSeen = new Map(); // slug → key

for (const o of orgs) {
  const founders = Array.isArray(o.c.founders) ? o.c.founders : [];
  for (const f of founders) {
    if (!f || !f.name || !f.name.trim()) continue;
    const key = dedupeKey(f);
    o.founders.push({ name: f.name.trim(), role: f.role || null, key });
    if (personByKey.has(key)) {
      const p = personByKey.get(key);
      p.companies.add(o.slug);
      mergePerson(p, f);
      continue;
    }
    let base = slugify(f.name) || ('founder-' + personByKey.size);
    let slug = base;
    if (personSlugSeen.has(slug) && personSlugSeen.get(slug) !== key) {
      const suf = o.slug;
      slug = `${base}-${suf}`;
      let n = 2;
      while (personSlugSeen.has(slug) && personSlugSeen.get(slug) !== key) { slug = `${base}-${suf}-${n}`; n++; }
    }
    personSlugSeen.set(slug, key);
    personByKey.set(key, {
      key, name: f.name.trim(), role: f.role || null, bio: f.bio || null,
      linkedinUrl: f.linkedinUrl || null, twitterUrl: f.twitterUrl || null,
      website: f.website || null, location: f.location || null,
      companies: new Set([o.slug]), slug,
    });
  }
}

// Which person keys get a founder note?
const noteworthy = new Set();
if (FOUNDER_NOTE_MODE !== 'none') {
  for (const o of orgs) {
    if (FOUNDER_NOTE_MODE === 'all') { for (const fr of o.founders) noteworthy.add(fr.key); }
    else if (o.founders.length) noteworthy.add(o.founders[0].key); // lead = first listed
  }
  for (const p of personByKey.values()) if (p.companies.size > 1) noteworthy.add(p.key);
}

// key → its people/<slug>/ slug (== the person's directory node id slug).
const founderSlugByKey = new Map();
for (const key of noteworthy) founderSlugByKey.set(key, personByKey.get(key).slug);

// ---- link helpers that only emit edges for targets that exist ---------------

const sectorPath = (label) => `/sectors/${slugify(label)}.md`;
const sectorLink = (label) =>
  companiesBySector.has(label) ? link(label, sectorPath(label)) : label;
const companyPath = (org) => `/communities/${org.slug}/index.md`;
const companyLink = (org) => link(org.c.name, companyPath(org));
// Reference a company by display name (plain text if it isn't in the portfolio).
function coLink(name) {
  const o = orgByName.get(String(name).trim().toLowerCase());
  return o ? companyLink(o) : name;
}

// Sectors that actually have companies, ordered by canonical taxonomy order.
const sectorsPresent = SECTOR_OPTIONS.filter((s) => companiesBySector.has(s));
const cmpName = (a, b) => a.c.name.localeCompare(b.c.name);

// ---- shared context ------------------------------------------------------------

const shared = [];

// index.md (pinned) — firm home
note(shared, 'index.md', { type: 'Index', title: 'Blackbird Ventures', tags: ['firm', 'home'] }, `
# Blackbird Ventures 🐦

The firm's working context — the portfolio we've backed, the founders behind it, and
how we think about the next decade. Backing the most ambitious people in Australia
and New Zealand.

## Start here

- ${link('Portfolio', '/communities/index.md')} — all ${orgs.length} companies, grouped by sector
- ${link('Sectors', '/sectors/index.md')} — where we invest and why
- ${link('Investment thesis', '/thesis.md')} — what we're looking for
- ${link('Team', '/team/index.md')} — the partners and who covers what
- ${link('Deals', '/deals/index.md')} — pipeline and process
- ${link('Data', '/data/index.md')} — marks, dashboards and the fund roll-up

> Every note is plain Markdown — link notes by their context-root path and explore the
> connections in the **Graph** tab.
`, true);

// thesis.md (pinned)
const thesisSectors = ['AI & ML', 'Climate & Energy', 'Deep Tech & Hardware', 'Space & Defence', 'Biotech', 'Fintech'];
note(shared, 'thesis.md', { type: 'Note', title: 'Investment thesis', tags: ['thesis', 'firm'] }, `
# Investment thesis

We back founders chasing outsized, generational outcomes — not incremental wins.
Most of the fund is reserved for follow-on, concentrated into the breakouts.

## Where we lean in

${thesisSectors.map((s) => `- ${sectorLink(s)} — ${SECTOR_BLURB[s]}`).join('\n')}

The full sector map lives in ${link('Sectors', '/sectors/index.md')}; the realised
track record is in ${link('Exits', '/communities/exits.md')}, and the honest other
side is the ${link('Graveyard', '/communities/graveyard.md')}.
`, true);

// communities/index.md (pinned) — grouped by sector
const portfolioBody = [];
portfolioBody.push(`# Portfolio\n`);
portfolioBody.push(`${orgs.length} companies across ${sectorsPresent.length} sectors. See also ${link('Exits', '/communities/exits.md')} and the ${link('Graveyard', '/communities/graveyard.md')}.\n`);
for (const s of sectorsPresent) {
  const list = [...companiesBySector.get(s)].sort(cmpName);
  portfolioBody.push(`## ${sectorLink(s)} (${list.length})`);
  for (const o of list) portfolioBody.push(`- ${companyLink(o)} — ${o.c.status}`);
  portfolioBody.push('');
}
note(shared, 'communities/index.md', { type: 'Index', title: 'Companies', tags: ['portfolio'] }, portfolioBody.join('\n'), true);

// communities/<slug>.md — one per company (the directory entity note for `[[ ]]`)
for (const o of orgs) {
  const c = o.c;
  const facts = [
    `- **Sector:** ${sectorLink(o.sector)}`,
    `- **Status:** ${c.status}${o.stage ? `   ·   **Stage:** ${o.stage}` : ''}${c.foundedYear ? `   ·   **Founded:** ${c.foundedYear}` : ''}`,
  ];
  const hq = c.hqLocation || c.hqCountry;
  if (hq) facts.push(`- **HQ:** ${hq}${c.totalRaised ? `   ·   **Total raised:** ${c.totalRaised}` : ''}`);
  else if (c.totalRaised) facts.push(`- **Total raised:** ${c.totalRaised}`);

  const sections = [`# ${c.name}`, '', c.longDescription || c.subtitle || '', '', facts.join('\n')];

  if (o.founders.length) {
    sections.push('', '## Founders');
    for (const fr of o.founders) {
      const role = fr.role || 'Founder';
      sections.push(founderSlugByKey.has(fr.key)
        ? `- ${link(fr.name, `/people/${founderSlugByKey.get(fr.key)}/index.md`)} — ${role}`
        : `- **${fr.name}** — ${role}`);
    }
  }

  const links = [ext('Website', c.website), ext('LinkedIn', c.linkedin), ext('Crunchbase', c.crunchbase), ext('Twitter / X', c.twitter)].filter(Boolean);
  if (links.length) sections.push('', '## Links', `- ${links.join('  ·  ')}`);

  const exited = c.status === 'Exited' || c.status === 'IPO';
  sections.push('', '---', `Part of ${link('Portfolio', '/communities/index.md')} · ${sectorLink(o.sector)}${exited ? ` · ${link('Exits', '/communities/exits.md')}` : ''}${c.status === 'Written Off' ? ` · ${link('Graveyard', '/communities/graveyard.md')}` : ''}`);

  // An organisation is a folder: its record is the folder's index.
  note(shared, `communities/${o.slug}/index.md`, {
    type: 'Company', title: c.name,
    description: c.subtitle || null,
    node: `company:${o.slug}`,
    tags: [slugify(o.sector), o.statusGroup, 'portfolio', 'company'],
  }, sections.join('\n'));
}

// communities/exits.md + graveyard.md
// exitDetails in the research JSON is a structured object ({type, acquirer,
// year, amount, ticker}) — render it as a short human line, never interpolate
// the object itself (that prints "[object Object]").
function fmtExit(d) {
  if (!d) return null;
  if (typeof d === 'string') return d;
  const year = d.year ? ` (${d.year})` : '';
  const t = String(d.type || '').toLowerCase();
  if (t.includes('ipo')) return `IPO${d.ticker ? ` — ${d.ticker}` : ''}${year}`;
  if (t.includes('merger')) return `${d.acquirer ? `Merged with ${d.acquirer}` : 'Merger'}${year}`;
  if (t.includes('shutdown')) return `Shut down${year}`;
  if (d.acquirer) return `Acquired by ${d.acquirer}${year}`;
  return d.type ? `${d.type}${year}` : null;
}

const exits = orgs.filter((o) => o.c.status === 'Exited' || o.c.status === 'IPO').sort(cmpName);
note(shared, 'communities/exits.md', { type: 'Note', title: 'Exits', tags: ['portfolio', 'exits'] }, `
# Exits

Realised outcomes — acquisitions and public listings (${exits.length}).

${exits.map((o) => { let d = fmtExit(o.c.exitDetails); if (d && d.startsWith(o.c.status)) d = d.slice(o.c.status.length).replace(/^\s*—\s*/, '').trim() || null; return `- ${companyLink(o)} — ${o.c.status}${d ? ` · ${d}` : ''}`; }).join('\n')}

Back to ${link('Portfolio', '/communities/index.md')} · ${link('Fund roll-up', '/data/fund-roll-up.md')}
`);

const graveyard = orgs.filter((o) => o.c.status === 'Written Off').sort(cmpName);
note(shared, 'communities/graveyard.md', { type: 'Note', title: 'Graveyard', tags: ['portfolio', 'written-off'] }, `
# Graveyard

The companies that didn't make it (${graveyard.length}). We keep them visible —
the losses are part of the venture power-law, and there are lessons in each.

${graveyard.map((o) => `- ${companyLink(o)}`).join('\n')}

Back to ${link('Portfolio', '/communities/index.md')}
`);

// sectors/index.md + per-sector pages
note(shared, 'sectors/index.md', { type: 'Index', title: 'Sectors', tags: ['sectors'] }, `
# Sectors

How the portfolio breaks down. Each sector page lists its companies.

${sectorsPresent.map((s) => `- ${sectorLink(s)} (${companiesBySector.get(s).length}) — ${SECTOR_BLURB[s]}`).join('\n')}

See the ${link('investment thesis', '/thesis.md')} for where we lean in.
`);

for (const s of sectorsPresent) {
  const list = [...companiesBySector.get(s)].sort(cmpName);
  note(shared, `sectors/${slugify(s)}.md`, { type: 'Sector', title: s, tags: ['sector', slugify(s)] }, `
# ${s}

${SECTOR_BLURB[s]}

Part of the ${link('portfolio', '/communities/index.md')}; see the ${link('thesis', '/thesis.md')}.

## Companies (${list.length})

${list.map((o) => `- ${companyLink(o)} — ${joinDot([o.c.status, o.stage])}`).join('\n')}
`);
}

// people/index.md + per-founder notes
if (FOUNDER_NOTE_MODE !== 'none' && founderSlugByKey.size) {
  const founderNotes = [...founderSlugByKey.keys()]
    .map((key) => ({ key, p: personByKey.get(key), slug: founderSlugByKey.get(key) }))
    .sort((a, b) => a.p.name.localeCompare(b.p.name));

  note(shared, 'people/index.md', { type: 'Index', title: 'People', tags: ['founders', 'people'] }, `
# Founders

The people building the portfolio (${founderNotes.length} profiled).

${founderNotes.map(({ p, slug }) => `- ${link(p.name, `/people/${slug}/index.md`)}${p.role ? ` — ${p.role}` : ''}`).join('\n')}
`);

  for (const { p, slug } of founderNotes) {
    const cos = [...p.companies].map((s) => orgBySlug.get(s)).filter(Boolean).sort(cmpName);
    const primary = cos[0];
    const links = [ext('LinkedIn', p.linkedinUrl), ext('Website', p.website), ext('Twitter / X', p.twitterUrl)].filter(Boolean);
    const sections = [`# ${p.name}`, ''];
    if (p.bio) sections.push(p.bio, '');
    const meta = [];
    if (p.role) meta.push(`- **Role:** ${p.role}`);
    if (p.location) meta.push(`- **Based in:** ${p.location}`);
    if (meta.length) sections.push(meta.join('\n'), '');
    sections.push('## Companies', cos.map((o) => `- ${companyLink(o)}`).join('\n'));
    if (links.length) sections.push('', '## Links', `- ${links.join('  ·  ')}`);
    sections.push('', `Back to ${link('Founders', '/people/index.md')}`);
    // A person is a folder: the note is its index, sub-notes go beside it.
    note(shared, `people/${slug}/index.md`, {
      type: 'Person', title: p.name,
      description: p.role || null,
      node: `person:${slug}`,
      tags: ['founder', 'person', primary ? slugify(primary.sector) : null].filter(Boolean),
    }, sections.join('\n'));
  }
}

// team/index.md + partner notes (curated — not in the research JSON)
const PARTNERS = [
  { name: 'Niki Scevak', role: 'Co-founder & Partner', focus: 'Firm strategy; marketplaces & consumer.', sectors: ['Consumer & Marketplace', 'SaaS & Enterprise'] },
  { name: 'Rick Baker', role: 'Co-founder & Partner', focus: 'Firm strategy; enterprise & fintech.', sectors: ['Fintech', 'SaaS & Enterprise'] },
  { name: 'Samantha Wong', role: 'Partner', focus: 'Enterprise software & developer tools.', sectors: ['SaaS & Enterprise', 'Developer Tools'] },
  { name: 'Nick Crocker', role: 'Partner', focus: 'Health, wellbeing & the life sciences.', sectors: ['Healthtech', 'Biotech'] },
  { name: 'Phoebe Harrop', role: 'Partner', focus: 'Climate, energy and the transition.', sectors: ['Climate & Energy', 'Agtech & Food'] },
  { name: 'Michael Tolo', role: 'Partner', focus: 'Deep tech, space and frontier science.', sectors: ['Deep Tech & Hardware', 'Space & Defence'] },
  { name: 'Tom Humphrey', role: 'Partner (NZ)', focus: 'The New Zealand ecosystem.', sectors: ['Agtech & Food', 'Deep Tech & Hardware'], companies: ['Halter'] },
  { name: 'Alex Apoifis', role: 'Partner & COO', focus: 'Fund operations and the platform team.', sectors: [] },
  { name: 'Connor Wiltshire', role: 'Data Analyst', focus: 'Portfolio data, marks and dashboards.', sectors: [], data: true },
];

note(shared, 'team/index.md', { type: 'Index', title: 'Team', tags: ['team'] }, `
# Team

Who's who at Blackbird and what they cover.

${PARTNERS.map((p) => `- ${link(p.name, `/team/${slugify(p.name)}.md`)} — ${p.role}`).join('\n')}
`);

for (const p of PARTNERS) {
  const sectorLines = (p.sectors || []).map((s) => `- ${sectorLink(s)}`);
  const coLines = (p.companies || []).map((n) => `- ${coLink(n)}`);
  const sections = [`# ${p.name}`, '', `**${p.role}.** ${p.focus}`];
  if (sectorLines.length) sections.push('', '## Sectors', sectorLines.join('\n'));
  if (coLines.length) sections.push('', '## Sponsors', coLines.join('\n'));
  if (p.data) sections.push('', `Keeper of the ${link('fund roll-up', '/data/fund-roll-up.md')} and ${link('dashboards', '/data/dashboards.md')}.`);
  sections.push('', `Back to ${link('Team', '/team/index.md')}`);
  note(shared, `team/${slugify(p.name)}.md`, { type: 'Person', title: p.name, description: p.role, tags: ['team', 'partner'] }, sections.join('\n'));
}

// deals/index.md + pipeline.md
note(shared, 'deals/index.md', { type: 'Index', title: 'Deals', tags: ['deals'] }, `
# Deals

How deals move from first meeting to investment committee.

- ${link('Pipeline', '/deals/pipeline.md')} — what's live and the process
`);

const onboarding = orgs.filter((o) => o.c.status === 'Onboarding').sort(cmpName);
note(shared, 'deals/pipeline.md', { type: 'Note', title: 'Pipeline', tags: ['deals', 'process'] }, `
# Pipeline

Pipeline review every Monday 9am before IC. Each sponsoring partner walks their live
deals; anything past first meeting needs a one-pager. Roughly half the fund is
reserved for follow-on, concentrated into the breakouts.

## Onboarding now

${onboarding.length ? onboarding.map((o) => `- ${companyLink(o)} — closing / onboarding`).join('\n') : '- (none currently onboarding)'}

## Reserves

Follow-on capital concentrates into the breakouts — e.g. ${coLink('Canva')},
${coLink('Airwallex')} and ${coLink('Halter')} — revisited quarterly against fresh
${link('marks', '/data/mark-to-market.md')}.
`);

// data/* — fund roll-up is computed from the in-memory model
const statusCounts = {};
for (const o of orgs) statusCounts[o.c.status] = (statusCounts[o.c.status] || 0) + 1;
const raised = orgs.filter((o) => typeof o.c.totalRaisedUsd === 'number');
const totalUsd = raised.reduce((a, o) => a + o.c.totalRaisedUsd, 0);
const biggest = [...raised].sort((a, b) => b.c.totalRaisedUsd - a.c.totalRaisedUsd).slice(0, 8);
const fmtUsd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`);

note(shared, 'data/index.md', { type: 'Index', title: 'Data', tags: ['data'] }, `
# Data

The numbers behind the fund.

- ${link('Fund roll-up', '/data/fund-roll-up.md')} — portfolio by status and sector
- ${link('Mark-to-market', '/data/mark-to-market.md')} — TVPI / DPI with and without Canva
- ${link('Dashboards', '/data/dashboards.md')} — the live views
`);

note(shared, 'data/fund-roll-up.md', { type: 'Note', title: 'Fund roll-up', tags: ['data', 'reporting'] }, `
# Fund roll-up

${orgs.length} companies tracked. Aggregate disclosed funding across ${raised.length}
companies with known raises is **${fmtUsd(totalUsd)}**.

## By status

${Object.keys(statusCounts).sort().map((s) => `- **${s}:** ${statusCounts[s]}`).join('\n')}

## By sector

| Sector | Companies |
| --- | --- |
${sectorsPresent.map((s) => `| ${s} | ${companiesBySector.get(s).length} |`).join('\n')}

## Biggest disclosed raises

${biggest.map((o) => `- ${companyLink(o)} — ${o.c.totalRaised || fmtUsd(o.c.totalRaisedUsd)}`).join('\n')}

See ${link('Exits', '/communities/exits.md')} and the ${link('Graveyard', '/communities/graveyard.md')} for realised outcomes.
`);

note(shared, 'data/mark-to-market.md', { type: 'Note', title: 'Mark-to-market', tags: ['data', 'reporting'] }, `
# Mark-to-market

Published monthly; full fund roll-up quarterly. We show TVPI and DPI **with and
without ${coLink('Canva')}** so LPs can see the underlying shape — Canva still
anchors the value, so the next generation is easier to read once it's stripped out.

Open marks to reconcile: ${coLink('Airwallex')} · ${coLink('SafetyCulture')}.
Roll-up lives in ${link('Fund roll-up', '/data/fund-roll-up.md')}.
`);

note(shared, 'data/dashboards.md', { type: 'Note', title: 'Dashboards', tags: ['data'] }, `
# Dashboards

The live views the team checks each week — pipeline throughput, reserves remaining,
and sector concentration. All driven off the ${link('fund roll-up', '/data/fund-roll-up.md')}.
`);

// ---- personal context (self-contained — links only to other personal notes) ----

const personal = [];

// Every folder carries an index note — the index IS the folder (see
// lib/notes/shared/indexNote.ts). That includes the context root.
note(personal, 'index.md', { type: 'Index', title: 'My Context', tags: ['home'] }, `
# My Context

My own context — nothing here is shared with the space.

- ${link('Journal', '/journal/index.md')} — weekly notes and reflections
- ${link('Meetings', '/meetings/index.md')} — partner syncs, founder calls, IC prep
- ${link('Diligence', '/diligence/index.md')} — working notes on live deals
- ${link('Watchlist', '/watchlist.md')} — what I'm tracking
- ${link('Todos', '/todos.md')} — open actions
`);

note(personal, 'journal/index.md', { type: 'Index', title: 'Journal', tags: ['journal'] }, `
# Journal

Weekly notes and reflections.

- ${link('2026-06-26', '/journal/2026-06-26.md')}
- ${link('2026-06-19', '/journal/2026-06-19.md')}
- ${link('2026-06-12', '/journal/2026-06-12.md')}
`);

note(personal, 'journal/2026-06-26.md', { type: 'Journal', title: '2026-06-26', tags: ['journal'] }, `
# 2026-06-26

Deep on the climate book this week. Spent most of Wednesday in the Azonic data room
— wrote it up in ${link('diligence', '/diligence/azonic.md')}. Net: strong team,
unproven GTM. Parked the open questions in ${link('todos', '/todos.md')}.

Monday's ${link('partner sync', '/meetings/partner-sync.md')} reset reserves toward
the breakouts. Added two names to the ${link('watchlist', '/watchlist.md')}.
`);

note(personal, 'journal/2026-06-19.md', { type: 'Journal', title: '2026-06-19', tags: ['journal'] }, `
# 2026-06-19

Founder catch-ups dominated. Notes from the Azonic call are in
${link('meetings', '/meetings/founder-catchup-azonic.md')}. Halter keeps coming up in
NZ conversations — the virtual-fencing wedge into US dairy is real. Tracking it on the
${link('watchlist', '/watchlist.md')}.
`);

note(personal, 'journal/2026-06-12.md', { type: 'Journal', title: '2026-06-12', tags: ['journal'] }, `
# 2026-06-12

Quiet week, mostly IC prep — see ${link('IC prep', '/meetings/ic-prep.md')}. Cleared
half the ${link('todos', '/todos.md')} list. The fintech cohort is heating up again;
worth a thesis refresh next month.
`);

note(personal, 'meetings/index.md', { type: 'Index', title: 'Meetings', tags: ['meetings'] }, `
# Meetings

- ${link('Partner sync', '/meetings/partner-sync.md')}
- ${link('Founder catch-up — Azonic', '/meetings/founder-catchup-azonic.md')}
- ${link('IC prep', '/meetings/ic-prep.md')}
`);

note(personal, 'meetings/partner-sync.md', { type: 'Meeting', title: 'Partner sync', tags: ['meetings'] }, `
# Partner sync — 2026-06-22

Reserves reset toward the breakouts (Canva, Airwallex, Halter). Agreed to keep
powder dry for the climate cohort. Actions tracked in ${link('todos', '/todos.md')};
new names on the ${link('watchlist', '/watchlist.md')}.
`);

note(personal, 'meetings/founder-catchup-azonic.md', { type: 'Meeting', title: 'Founder catch-up — Azonic', tags: ['meetings'] }, `
# Founder catch-up — Azonic

Strong technical founder, clear wedge, but the go-to-market is still a hypothesis.
Following up with a data request — see ${link('diligence', '/diligence/azonic.md')}.
On the ${link('watchlist', '/watchlist.md')} pending the next data drop.
`);

note(personal, 'meetings/ic-prep.md', { type: 'Meeting', title: 'IC prep', tags: ['meetings'] }, `
# IC prep

One-pagers due before Monday IC. Pulled comps and reserves math; open items in
${link('todos', '/todos.md')}.
`);

note(personal, 'watchlist.md', { type: 'Note', title: 'Watchlist', tags: ['watchlist'] }, `
# Watchlist

Companies and themes I'm tracking (not yet committed):

- **Azonic** — climate; diligence in progress, see ${link('notes', '/diligence/azonic.md')}
- **Halter** — agtech / deep tech; watching the US dairy expansion
- **Fintech cohort** — refreshing the thesis next month

Open actions live in ${link('todos', '/todos.md')}.
`, true);

note(personal, 'todos.md', { type: 'Note', title: 'Todos', tags: ['todos'] }, `
# Todos

- [ ] Send Azonic the cohort-retention data request
- [ ] Refresh the fintech thesis ahead of next IC
- [ ] Update reserves model after the ${link('partner sync', '/meetings/partner-sync.md')}
- [x] Write up the ${link('Azonic diligence', '/diligence/azonic.md')} note
- [x] File this week's ${link('journal', '/journal/2026-06-26.md')} entry
`);

note(personal, 'diligence/index.md', { type: 'Index', title: 'Diligence', tags: ['diligence'] }, `
# Diligence

Working notes on live deals — what I've checked, what's still open.

- ${link('Azonic', '/diligence/azonic.md')} — climate; cohort-retention data outstanding
`);

note(personal, 'diligence/azonic.md', { type: 'Note', title: 'Azonic — diligence', tags: ['diligence'] }, `
# Azonic — diligence

Working notes from the data room (${link('founder call', '/meetings/founder-catchup-azonic.md')}).

**Strengths:** technical founding team, defensible wedge, early design partners.
**Open questions:** GTM motion, retention curve, true CAC at scale.
**Next:** cohort-retention data request (tracked in ${link('todos', '/todos.md')}).

Back to the ${link('watchlist', '/watchlist.md')}.
`);

// ---- write to the DB ---------------------------------------------------------

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const comm = await client.query('SELECT id FROM spaces WHERE id = $1', [COMM]);
  if (comm.rowCount === 0) {
    throw new Error(`space "${COMM}" not found — run \`pnpm db:blackbird\` first`);
  }

  // Whoever manages the space gets the personal context. There is no role
  // column — an admin is someone holding a Person alias flagged `owner` or
  // `system` in spaces.aliases (lib/auth.ts#isAdmin), so ask
  // that list directly and fall back to the earliest member.
  const adminRes = await client.query(
    `SELECT u.id, u.name FROM space_members uc
       JOIN users u ON u.id = uc.user_id
      WHERE uc.space_id = $1
      ORDER BY EXISTS (
        SELECT 1 FROM user_aliases ua
          JOIN spaces c ON c.id = uc.space_id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.aliases, '[]'::jsonb)) AS a
         WHERE ua.space_id = uc.space_id
           AND ua.user_id = uc.user_id
           AND ua.alias_id = a->>'id'
           AND (a->>'owner' = 'true' OR a->>'system' = 'true')
      ) DESC, uc.joined_at ASC
      LIMIT 1`,
    [COMM],
  );
  const adminId = adminRes.rows[0]?.id;
  if (!adminId) throw new Error(`no members found for ${COMM}; run \`pnpm db:blackbird\` first`);
  console.log(`add-blackbird-notes: admin = ${adminId} (${adminRes.rows[0]?.name ?? 'unknown'})`);

  if (RESET) {
    const del = await client.query(
      `DELETE FROM context_notes
        WHERE space_id = $1 AND owner_key = ANY($2) AND deleted_at IS NULL`,
      [COMM, [SHARED, adminId]],
    );
    console.log(`add-blackbird-notes: --reset removed ${del.rowCount} live note(s) (trash preserved)`);
  }

  const contexts = [
    { ownerKey: SHARED, notes: shared },
    { ownerKey: adminId, notes: personal },
  ];

  for (const { ownerKey, notes } of contexts) {
    for (const n of notes) {
      await client.query(
        `INSERT INTO context_notes (space_id, owner_key, path, content, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (space_id, owner_key, path)
         DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [COMM, ownerKey, n.path, n.content, adminId],
      );
    }
  }

  await client.query('COMMIT');
  console.log('\n=== Committed ===');
  console.log(`  shared context:   ${shared.length} notes (owner_key=shared)`);
  console.log(`  personal context: ${personal.length} notes (owner_key=${adminId})`);

  const tally = (notes) => {
    const byFolder = {};
    for (const n of notes) {
      const top = n.path.includes('/') ? n.path.split('/')[0] + '/' : '(root)';
      byFolder[top] = (byFolder[top] || 0) + 1;
    }
    return Object.entries(byFolder).map(([folder, count]) => ({ folder, count }));
  };
  console.log('\n--- Shared context by folder ---');
  console.table(tally(shared));
  console.log('--- Personal context by folder ---');
  console.table(tally(personal));
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
