import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      if (i < 0) return null;
      const k = l.slice(0, i).trim();
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [k, v];
    })
    .filter(Boolean)
);

const pool = new pg.Pool({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
});

// Canonical TitleCase for every stored type value.
const TYPE_RENAMES = [
  ['event',        'Event'],
  ['person',       'Person'],
  ['organization', 'Organization'],
  ['founder',      'Founder'],
  ['investor',     'Investor'],
  ['startup',      'Startup'],
];

// Per-community nodeTypes that ensure every node's type resolves to a colour.
// Colours chosen per user direction: NODE_COLORS legacy palette for orphans.
const SF_NODE_TYPES = [
  { icon: '🌐', name: 'Community',    color: '#78d870', shape: 'circle' },
  { icon: '👤', name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { icon: '📦', name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
  { icon: '📅', name: 'Event',        color: '#9333ea', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'hexagon' },
  { icon: '🚀', name: 'Founder',      color: '#2563eb', shape: 'rectangle' },
];

const NZ_NODE_TYPES = [
  { icon: '🌐', name: 'Community',    color: '#78d870', shape: 'circle' },
  { icon: '👤', name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { icon: '📦', name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
  { icon: '📅', name: 'Event',        color: '#9333ea', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'hexagon' },
  { icon: '💰', name: 'Investor',     color: '#f59e0b', shape: 'rectangle' },
  { icon: '🌱', name: 'Startup',      color: '#16a34a', shape: 'rectangle' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  console.log('--- Normalising node.type capitalisation ---');
  for (const [from, to] of TYPE_RENAMES) {
    const r = await client.query('UPDATE nodes SET type = $1 WHERE type = $2', [to, from]);
    console.log(`  ${from.padEnd(15)} -> ${to.padEnd(15)} : ${r.rowCount} rows`);
  }

  console.log('\n--- Updating community.node_types configs ---');
  const sf = await client.query(
    'UPDATE communities SET node_types = $1::jsonb WHERE id = $2',
    [JSON.stringify(SF_NODE_TYPES), 'sf-ecosystem']
  );
  console.log(`  sf-ecosystem : ${sf.rowCount} row(s) updated`);
  const nz = await client.query(
    'UPDATE communities SET node_types = $1::jsonb WHERE id = $2',
    [JSON.stringify(NZ_NODE_TYPES), 'startup-nz']
  );
  console.log(`  startup-nz   : ${nz.rowCount} row(s) updated`);

  await client.query('COMMIT');
  console.log('\nCommitted.');

  console.log('\n--- Post-fix verification: types per community ---');
  const comms = await client.query('SELECT id, name, node_types FROM communities ORDER BY name');
  for (const c of comms.rows) {
    const cfgNames = new Set((c.node_types ?? []).map(t => t.name.toLowerCase()));
    const typesUsed = await client.query(
      'SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type',
      [c.id]
    );
    const unresolved = typesUsed.rows.filter(r => !cfgNames.has(r.type.toLowerCase()));
    console.log(`\n[${c.id}] ${c.name}`);
    console.log(`  config: ${(c.node_types ?? []).map(t => t.name).join(', ') || '(empty)'}`);
    console.log(`  used:   ${typesUsed.rows.map(r => `${r.type}(${r.count})`).join(', ')}`);
    if (unresolved.length === 0) {
      console.log('  ✓ all node types resolve via this community\'s config');
    } else {
      console.log(`  ⚠ unresolved (will fall back to defaults): ${unresolved.map(r => r.type).join(', ')}`);
    }
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
