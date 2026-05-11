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

const COMM = 'au-ecosystem';

// 1. Updated nodeTypes: Community claims hexagon (since it's the new type), Organization becomes rectangle.
const NODE_TYPES = [
  { icon: '👤', name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'rectangle' },
  { icon: '📅', name: 'Event',        color: '#ef4444', shape: 'rectangle' },
  { icon: '👥', name: 'Group',        color: '#0ea5e9', shape: 'rectangle' },
  { icon: '🌐', name: 'Community',    color: '#10b981', shape: 'hexagon'   },
];

// 2. Reclassify existing nodes: Group/Org → Community. Drop the alias since these are no longer Groups.
const RECLASSIFY = [
  'group:au-founders-network',
  'group:au-vc-syndicate',
  'group:deep-tech-collective',
  'group:women-in-tech-au',
  'org:fishburners',
];

// 3. New Community nodes (real AU tech communities not yet in the dataset).
const NEW_COMMUNITIES = [
  {
    id: 'community:au-techsydney',
    name: 'TechSydney',
    subtitle: "Sydney's not-for-profit tech industry association",
    location: 'Sydney, NSW',
    url: 'https://techsydney.com.au',
    tags: ['Community', 'Sydney', 'Advocacy', 'Network'],
  },
  {
    id: 'community:au-techmelbourne',
    name: 'TechMelbourne',
    subtitle: "Melbourne's tech industry association",
    location: 'Melbourne, VIC',
    url: 'https://techmelbourne.org',
    tags: ['Community', 'Melbourne', 'Advocacy', 'Network'],
  },
  {
    id: 'community:au-tech-council',
    name: 'Tech Council of Australia',
    subtitle: "Australia's peak body for the tech sector",
    location: 'Australia-wide',
    url: 'https://techcouncil.com.au',
    tags: ['Community', 'Advocacy', 'Policy', 'National'],
  },
];

// 4. Connecting links between new communities and existing people who lead them.
const NEW_LINKS = [
  // Tech Council of Australia — Damian Kassabgi (current CEO), Kate Pounder (former CEO)
  { sourceId: 'person:damian-kassabgi', targetId: 'community:au-tech-council', relationship: 'leads' },
  { sourceId: 'person:kate-pounder',    targetId: 'community:au-tech-council', relationship: 'former_ceo' },
  // Light affiliations for the regional communities — just enough to keep them connected
  { sourceId: 'person:mike-cannon-brookes', targetId: 'community:au-techsydney',    relationship: 'member_of' },
  { sourceId: 'person:scott-farquhar',      targetId: 'community:au-techsydney',    relationship: 'member_of' },
  { sourceId: 'person:jack-zhang',          targetId: 'community:au-techmelbourne', relationship: 'member_of' },
  { sourceId: 'person:didier-elzinga',      targetId: 'community:au-techmelbourne', relationship: 'member_of' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // === 1. nodeTypes config ===
  console.log('--- Updating AU community.node_types ---');
  await client.query(
    'UPDATE communities SET node_types = $1::jsonb WHERE id = $2',
    [JSON.stringify(NODE_TYPES), COMM]
  );
  console.log('  ✓ Community added (hexagon, #10b981); Organization now rectangle');

  // === 2. Reclassify existing nodes ===
  console.log('\n--- Reclassifying existing nodes -> Community ---');
  for (const id of RECLASSIFY) {
    const r = await client.query(
      'UPDATE nodes SET type = $1, alias = NULL WHERE id = $2 AND community_id = $3 RETURNING name, type',
      ['Community', id, COMM]
    );
    if (r.rowCount === 0) console.log(`  ⚠ ${id}: not found`);
    else console.log(`  ✓ ${id.padEnd(35)} -> ${r.rows[0].name}`);
  }

  // === 3. Insert new Community nodes ===
  console.log('\n--- Inserting new Community nodes ---');
  for (const c of NEW_COMMUNITIES) {
    const r = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, community_id, alias, metadata, created_at, updated_at)
      VALUES ($1, 'Community', $2, $3, $4, $5, $6, $7, NULL, '{}'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, updated_at = NOW()
      RETURNING id, name
    `, [c.id, c.name, c.subtitle, c.location, c.url, c.tags, COMM]);
    console.log(`  ✓ ${r.rows[0].id.padEnd(35)} -> ${r.rows[0].name}`);
  }

  // === 4. Insert connecting links (links.id is autoincrement int) ===
  console.log('\n--- Inserting links ---');
  for (const l of NEW_LINKS) {
    const sourceExists = await client.query('SELECT 1 FROM nodes WHERE id = $1', [l.sourceId]);
    if (sourceExists.rowCount === 0) { console.log(`  ⚠ source missing: ${l.sourceId}`); continue; }
    const dup = await client.query(
      'SELECT 1 FROM links WHERE source_id = $1 AND target_id = $2 AND relationship = $3',
      [l.sourceId, l.targetId, l.relationship]
    );
    if (dup.rowCount > 0) { console.log(`  ~ skipped (exists): ${l.sourceId} -[${l.relationship}]-> ${l.targetId}`); continue; }
    await client.query(
      `INSERT INTO links (source_id, target_id, relationship, community_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW())`,
      [l.sourceId, l.targetId, l.relationship, COMM]
    );
    console.log(`  ✓ ${l.sourceId} -[${l.relationship}]-> ${l.targetId}`);
  }

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  // === Final verification ===
  console.log('\n--- AU node type breakdown (after) ---');
  const r = await client.query(
    "SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type",
    [COMM]
  );
  console.table(r.rows);

  console.log('\n--- AU Community-typed nodes ---');
  const r2 = await client.query(
    "SELECT id, name, subtitle FROM nodes WHERE community_id = $1 AND type = 'Community' ORDER BY name",
    [COMM]
  );
  for (const row of r2.rows) {
    console.log(`  ${row.id.padEnd(40)} ${row.name.padEnd(35)} "${(row.subtitle ?? '').slice(0, 50)}"`);
  }

} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
