import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); if (i < 0) return null;
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }).filter(Boolean)
);
const pool = new pg.Pool({ host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

// Mirror the lib/types.ts resolver exactly so we know what the renderer will see.
const DEFAULTS = [
  { name: 'Community',    color: '#10b981', shape: 'hexagon'   },
  { name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { name: 'Organization', color: '#9333ea', shape: 'rectangle' },
  { name: 'Event',        color: '#ef4444', shape: 'rectangle' },
  { name: 'Group',        color: '#0ea5e9', shape: 'rectangle' },
  { name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
];

function resolveColour({ type, alias }, communityNodeTypes, communityAliases) {
  // Alias first (only if it matches an alias of the same nodeType)
  if (alias) {
    const a = (communityAliases ?? []).find(x => x.name === alias && x.nodeType === type);
    if (a) return { color: a.color, via: `alias "${alias}"` };
  }
  // Community type
  const ct = (communityNodeTypes ?? []).find(x => x.name.toLowerCase() === type.toLowerCase());
  if (ct) return { color: ct.color, via: 'community type' };
  // Default type
  const dt = DEFAULTS.find(x => x.name.toLowerCase() === type.toLowerCase());
  if (dt) return { color: dt.color, via: 'default type' };
  return { color: '#6b7280', via: 'GREY FALLBACK' };
}

const COMM = 'au-ecosystem';
const comm = (await pool.query('SELECT id, name, node_types, community_aliases FROM communities WHERE id = $1', [COMM])).rows[0];
const nodeTypes = comm.node_types ?? [];
const aliases = comm.community_aliases ?? [];

console.log(`=== Community: ${comm.name} ===`);
console.log('nodeTypes:', nodeTypes.map(t => `${t.name}(${t.color}, ${t.shape})`).join(', '));
console.log('aliases:  ', aliases.map(a => `${a.name}->${a.nodeType}(${a.color})`).join(', '));

const nodes = (await pool.query(
  'SELECT type, alias, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type, alias ORDER BY type, alias',
  [COMM]
)).rows;

console.log('\n=== Colour resolution per (type, alias) ===');
let greyCount = 0;
let totalNodes = 0;
const issues = [];
for (const row of nodes) {
  totalNodes += row.count;
  // Path 1: with full community config (what the directory uses)
  const full = resolveColour({ type: row.type, alias: row.alias }, nodeTypes, aliases);
  // Path 2: without community config (loading state / graph before community loads)
  const fallback = resolveColour({ type: row.type, alias: row.alias }, undefined, undefined);
  // Path 3: without aliases (what the OLD graph view used)
  const noAlias = resolveColour({ type: row.type, alias: null }, nodeTypes, undefined);

  const flag = full.via === 'GREY FALLBACK' || fallback.via === 'GREY FALLBACK' ? ' ⚠️ ' : '   ';
  console.log(
    `${flag}${row.type.padEnd(14)} ${(row.alias ?? '(none)').padEnd(20)} x${String(row.count).padEnd(4)}` +
    `  full=${full.color} (${full.via})  fallback=${fallback.color} (${fallback.via})`
  );
  if (full.via === 'GREY FALLBACK') { greyCount += row.count; issues.push(`${row.type} / ${row.alias}: grey under full config`); }
  if (fallback.via === 'GREY FALLBACK') issues.push(`${row.type} / ${row.alias}: grey when community config not yet loaded (${row.count} nodes)`);
}

console.log(`\nTotal AU nodes: ${totalNodes}`);
console.log(`Nodes resolving to GREY under full config: ${greyCount}`);
if (issues.length) {
  console.log('\nIssues:');
  for (const i of issues) console.log(`  • ${i}`);
} else {
  console.log('\n✓ No grey fallbacks expected after this fix.');
}

// Check for stray/invalid types
console.log('\n=== Sanity: any null/empty types? ===');
const bad = (await pool.query(
  `SELECT id, type, name FROM nodes WHERE community_id = $1 AND (type IS NULL OR type = '') LIMIT 10`,
  [COMM]
)).rows;
console.log(bad.length === 0 ? '  ✓ all nodes have a non-empty type' : '  ⚠ bad rows:'); if (bad.length) console.table(bad);

// Check for aliases that don't match any configured alias
console.log('\n=== Sanity: aliases that have no matching config entry ===');
const aliasSet = new Set(aliases.map(a => `${a.name}|${a.nodeType}`));
const allAliased = (await pool.query(
  `SELECT id, type, alias, name FROM nodes WHERE community_id = $1 AND alias IS NOT NULL`,
  [COMM]
)).rows;
const unmapped = allAliased.filter(r => !aliasSet.has(`${r.alias}|${r.type}`));
if (unmapped.length === 0) console.log('  ✓ every alias maps to a configured CommunityAlias');
else { console.log(`  ⚠ ${unmapped.length} unmapped aliases:`); console.table(unmapped.slice(0, 10)); }

await pool.end();
