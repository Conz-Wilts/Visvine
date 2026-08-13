// Transforms the research-workflow output into the seed data file consumed by
// add-icehouse-ventures.mjs.
//
//   node build-icehouse-data.mjs <mainResult.output> [supplementResult.output ...]
//
// Each input file is a task-output envelope { summary, logs, result } (or the
// raw result object), where result = { firm, companies[], dropped[] } for the
// main run and { companies[] } for supplements. Output: data/icehouse-ventures.json
// shaped as { space, nodes[], links[], report }.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MAIN =
  'C:/Users/Connor/AppData/Local/Temp/claude/C--Users-Connor-dev-Projects-Visvine/1a99f23e-42a3-493d-b260-96f35fbf3ec8/tasks/w59xoihc5.output';

const argFiles = process.argv.slice(2);
const files = argFiles.length ? argFiles : [DEFAULT_MAIN];

function readResult(p) {
  let j = JSON.parse(readFileSync(p, 'utf8'));
  if (j && typeof j === 'object' && !Array.isArray(j) && 'result' in j) j = j.result;
  if (typeof j === 'string') j = JSON.parse(j);
  return j;
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ── Collect firm + all companies across inputs ───────────────────────────────
let firm = null;
const companies = [];
const seenInput = new Set();
for (const f of files) {
  const r = readResult(f);
  if (r.firm && !firm) firm = r.firm;
  for (const c of r.companies ?? []) {
    if (seenInput.has(c.inputName)) continue; // keep first occurrence
    seenInput.add(c.inputName);
    companies.push(c);
  }
}
if (!firm) throw new Error('No firm record found in inputs');

const COMM = 'community:icehouse-ventures';
const FIRM_ID = 'org:iv-icehouse-ventures';

const nodeTypes = [
  { icon: '🧊', name: 'Investor', color: '#0ea5e9', shape: 'square' },
  { icon: '🚀', name: 'Startup', color: '#9333ea', shape: 'rectangle' },
  { icon: '👤', name: 'Person', color: '#2563eb', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#f59e0b', shape: 'rectangle' },
];

const space = {
  id: COMM,
  name: 'Icehouse Ventures',
  description:
    "Icehouse Ventures' portfolio — New Zealand's most active early-stage venture investor, the Kiwi-founded companies it backs, and the founders behind them. Seeded from web research.",
  location: 'Auckland, New Zealand',
  tags: ['Venture Capital', 'New Zealand', 'Startups', 'Icehouse Ventures'],
  country: 'NZ',
  emoji: '🧊',
  nodeTypes,
};

const nodes = [];
const links = [];
const linkSeen = new Set();
function addLink(sourceId, targetId, relationship) {
  const k = `${sourceId}|${targetId}|${relationship}`;
  if (linkSeen.has(k)) return;
  linkSeen.add(k);
  links.push({ sourceId, targetId, relationship });
}

// ── Investor node (the firm) ─────────────────────────────────────────────────
nodes.push({
  id: FIRM_ID,
  type: 'Investor',
  name: firm.name,
  subtitle: firm.oneLiner,
  location: firm.hqLocation,
  url: firm.website,
  tags: firm.tags ?? [],
  metadata: {
    bio: firm.description,
    founded: firm.founded,
    investmentStage: firm.investmentStage,
    sectorFocus: firm.sectorFocus,
    portfolioCount: firm.portfolioCount,
    checkSize: firm.checkSize ?? undefined,
    totalInvested: firm.totalInvested,
    notableExits: firm.notableExits ?? [],
    sources: firm.sources ?? [],
  },
});

// ── People (founders + firm leadership), de-duplicated by slug ───────────────
const peopleById = new Map();
function upsertPerson(name, { role, bio, linkedinUrl, priorBackground, location, sources }, assoc) {
  const id = `person:iv-${slug(name)}`;
  let p = peopleById.get(id);
  if (!p) {
    p = {
      id,
      type: 'Person',
      name,
      subtitle: assoc ? `${role || 'Co-founder'}, ${assoc}` : role || null,
      location: location ?? null,
      url: linkedinUrl ?? null,
      tags: [],
      metadata: {
        bio: bio ?? null,
        role: role ?? null,
        linkedinUrl: linkedinUrl ?? null,
        priorBackground: priorBackground ?? null,
        companies: [],
        sources: [],
      },
    };
    peopleById.set(id, p);
  }
  // Enrich if this record has data the first one lacked.
  if (!p.metadata.bio && bio) p.metadata.bio = bio;
  if (!p.url && linkedinUrl) { p.url = linkedinUrl; p.metadata.linkedinUrl = linkedinUrl; }
  if (!p.location && location) p.location = location;
  if (!p.metadata.priorBackground && priorBackground) p.metadata.priorBackground = priorBackground;
  for (const s of sources ?? []) if (!p.metadata.sources.includes(s)) p.metadata.sources.push(s);
  return p;
}

// Firm leadership
for (const L of firm.leadership ?? []) {
  if (!L?.name) continue;
  const p = upsertPerson(L.name, { role: L.role, bio: L.bio, linkedinUrl: L.linkedinUrl, sources: firm.sources }, 'Icehouse Ventures');
  if (!p.tags.includes('Icehouse Ventures')) p.tags.push('Icehouse Ventures');
  if (!p.tags.includes('Investor')) p.tags.push('Investor');
  addLink(p.id, FIRM_ID, 'works_at');
}

// ── Company (Startup) nodes + founders ───────────────────────────────────────
const STATUS_TAG = { acquired: 'Acquired', closed: 'Closed', ipo: 'IPO' };
for (const c of companies) {
  const id = `org:iv-${slug(c.inputName)}`;
  const tags = Array.from(new Set([...(c.tags ?? []), 'Icehouse Portfolio', STATUS_TAG[c.status]].filter(Boolean)));
  nodes.push({
    id,
    type: 'Startup',
    name: c.name,
    subtitle: c.oneLiner,
    location: c.hqLocation,
    url: c.website,
    tags,
    metadata: {
      bio: c.description,
      industry: c.industry,
      founded: c.foundedYear,
      stage: c.stage,
      status: c.status,
      statusDetail: c.statusDetail ?? undefined,
      fundingNotable: c.fundingNotable ?? undefined,
      icehouseBacked: c.icehouseBacked,
      confidence: c.confidence,
      verifyVerdict: c.verifyVerdict ?? undefined,
      verifyNote: c.verifyNote ?? undefined,
      website: c.website ?? undefined,
      notes: c.notes ?? undefined,
      sources: c.sources ?? [],
    },
  });
  // Icehouse invested_in company (the whole space is its portfolio)
  addLink(FIRM_ID, id, 'invested_in');
  // Founders
  for (const f of c.founders ?? []) {
    if (!f?.name) continue;
    const p = upsertPerson(f.name, { role: f.role, bio: f.bio, linkedinUrl: f.linkedinUrl, priorBackground: f.priorBackground, location: f.location, sources: c.sources }, c.name);
    if (!p.tags.includes('Founder')) p.tags.push('Founder');
    if (!p.metadata.companies.includes(c.name)) p.metadata.companies.push(c.name);
    addLink(p.id, id, 'founded');
  }
}

for (const p of peopleById.values()) nodes.push(p);

// ── Uncertainty report ───────────────────────────────────────────────────────
const flagged = companies
  .filter((c) => c.icehouseBacked !== 'confirmed' || c.confidence !== 'high' || ['unverified', 'partly-confirmed'].includes(c.verifyVerdict))
  .map((c) => ({ name: c.name, inputName: c.inputName, icehouseBacked: c.icehouseBacked, confidence: c.confidence, verifyVerdict: c.verifyVerdict, status: c.status, founders: (c.founders ?? []).length, note: c.verifyNote || c.notes || null }));
const noFounders = companies.filter((c) => !(c.founders ?? []).length).map((c) => c.name);

const data = {
  space,
  nodes,
  links,
  report: {
    companies: companies.length,
    people: peopleById.size,
    investorNodes: 1,
    links: links.length,
    flaggedCount: flagged.length,
    flagged,
    companiesWithNoFounders: noFounders,
  },
};

const outDir = join(__dirname, 'data');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'icehouse-ventures.json');
writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`Wrote ${outPath}`);
console.log(`  nodes: ${nodes.length} (1 Investor, ${companies.length} Startup, ${peopleById.size} Person)`);
console.log(`  links: ${links.length}`);
console.log(`  flagged (uncertain) companies: ${flagged.length}`);
for (const f of flagged) console.log(`    - ${f.name}: backed=${f.icehouseBacked} conf=${f.confidence} verdict=${f.verifyVerdict} founders=${f.founders}`);
if (noFounders.length) console.log(`  companies with no founders found: ${noFounders.join(', ')}`);
