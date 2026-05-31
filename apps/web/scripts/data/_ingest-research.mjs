// One-off: parse the blackbird-portfolio-research workflow result, decode HTML
// entities that crept into agent text, and write the data file the seed script
// reads. Usage: node _ingest-research.mjs <workflow-output-file>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inPath = process.argv[2];
if (!inPath) throw new Error('pass the workflow output file path as argv[2]');
const outPath = join(__dirname, 'blackbird-ventures.research.json');

const raw = readFileSync(inPath, 'utf8');
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  parsed = JSON.parse(raw.slice(s, e + 1));
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ' };
function decode(str) {
  return str.replace(/&(amp|lt|gt|quot|#39|#x27|apos|nbsp);/g, (m) => ENT[m] ?? m);
}
function walk(v) {
  if (typeof v === 'string') return decode(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = walk(v[k]);
    return o;
  }
  return v;
}

const root = parsed.result ?? parsed; // workflow output is wrapped in { summary, logs, result }
const companies = walk(root.companies || []);
const out = { researchedAt: root.researchedAt ?? null, count: companies.length, companies };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

// quick stats
const byStatus = {};
let founders = 0, noFounders = 0, lowConf = 0, noWebsite = 0, noYear = 0;
const noFounderNames = [];
for (const c of companies) {
  byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  const f = (c.founders || []).length;
  founders += f;
  if (!f) { noFounders++; noFounderNames.push(c.name); }
  if (c.confidence === 'low') lowConf++;
  if (!c.website) noWebsite++;
  if (!c.foundedYear) noYear++;
}
console.log('wrote', companies.length, 'companies ->', outPath);
console.log('byStatus:', byStatus);
console.log('founder records:', founders, '| companies w/o founders:', noFounders, '| lowConfidence:', lowConf, '| noWebsite:', noWebsite, '| noFoundedYear:', noYear);
console.log('companies w/o founders:', noFounderNames.join(', ') || '(none)');
