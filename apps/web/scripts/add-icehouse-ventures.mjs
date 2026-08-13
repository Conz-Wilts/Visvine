// Seeds the "Icehouse Ventures" space from web-researched data.
//
// Data lives in ./data/icehouse-ventures.json (firm + portfolio companies +
// founders + links), produced by the research workflow. This loader is generic:
// it upserts the space, then every node, then every link, idempotently.
//
// Mirrors add-nz-ecosystem.mjs: loads apps/web/.env (cwd-independent) and refuses
// to run against any non-local host via the shared guard.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, 'data', 'icehouse-ventures.json');

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-icehouse-ventures: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const { space, nodes, links } = data;
if (!space?.id || !Array.isArray(nodes) || !Array.isArray(links)) {
  throw new Error('add-icehouse-ventures: data file must have { space, nodes[], links[] }');
}
const COMM = space.id;

// The research data models portfolio companies / the VC firm as custom node
// types ("Startup"/"Investor"). The app's alias model wants a canonical base
// type plus a space-specific alias label (mirrors Blackbird), so collapse
// the custom types onto base types and carry the label across as the alias.
const TYPE_REMAP = {
  Investor:     { type: 'Space', alias: 'Investor' },
  Startup:      { type: 'Space', alias: 'Startup'  },
  Person:       { type: 'person', alias: null },
  Organization: { type: 'Space', alias: null },
};

// Base node types shown in the Types & Aliases console.
const NODE_TYPES = [
  { icon: '🏘️', name: 'Space', color: '#78d870', shape: 'square' },
  { icon: '👤', name: 'Person', color: '#2563eb', shape: 'rectangle' },
];

// The research data still prefixes organisation ids `org:`, the spelling that
// preceded Group and then Space. Remapped here rather than in the JSON so
// the source file stays a faithful copy of the research export — nodes and both
// ends of every link go through this.
const nodeId = (id) => String(id).replace(/^org:/, 'space:');

// `nodeType` matching is case-insensitive across the app; use canonical names.
const SPACE_ALIASES = [
  { name: 'Investor', color: '#0ea5e9', nodeType: 'Space' },
  { name: 'Startup',  color: '#f59e0b', nodeType: 'Space' },
];

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Space
  console.log('--- Upserting space ---');
  await client.query(
    `INSERT INTO spaces (id, name, description, location, tags, node_types, aliases, country, emoji, visibility, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'public', NOW())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
       location = EXCLUDED.location, tags = EXCLUDED.tags, node_types = EXCLUDED.node_types,
       aliases = EXCLUDED.aliases, country = EXCLUDED.country, emoji = EXCLUDED.emoji`,
    [
      space.id,
      space.name,
      space.description ?? null,
      space.location ?? null,
      space.tags ?? [],
      JSON.stringify(NODE_TYPES),
      JSON.stringify(SPACE_ALIASES),
      space.country ?? 'NZ',
      space.emoji ?? null,
    ]
  );
  console.log(`  ✓ ${COMM}`);

  // 2. Nodes
  console.log(`\n--- Upserting ${nodes.length} nodes ---`);
  for (const n of nodes) {
    const m = TYPE_REMAP[n.type] ?? { type: String(n.type).toLowerCase(), alias: null };
    await client.query(
      `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, space_id, alias, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
         location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata,
         space_id = EXCLUDED.space_id, alias = EXCLUDED.alias, updated_at = NOW()`,
      [
        nodeId(n.id), m.type, n.name, n.subtitle ?? null, n.location ?? null, n.url ?? null,
        n.tags ?? [], JSON.stringify(n.metadata ?? {}), COMM, n.alias ?? m.alias,
      ]
    );
  }
  console.log(`  ✓ ${nodes.length} nodes`);

  // 3. Links (skip if an endpoint is missing or the edge already exists)
  console.log(`\n--- Upserting ${links.length} links ---`);
  let added = 0, skipped = 0;
  for (const raw of links) {
    const l = { ...raw, sourceId: nodeId(raw.sourceId), targetId: nodeId(raw.targetId) };
    const s = await client.query('SELECT 1 FROM nodes WHERE id = $1', [l.sourceId]);
    const t = await client.query('SELECT 1 FROM nodes WHERE id = $1', [l.targetId]);
    if (s.rowCount === 0 || t.rowCount === 0) {
      console.log(`  ⚠ missing endpoint: ${l.sourceId} -[${l.relationship}]-> ${l.targetId}`);
      skipped++; continue;
    }
    const dup = await client.query(
      'SELECT 1 FROM links WHERE source_id = $1 AND target_id = $2 AND relationship = $3',
      [l.sourceId, l.targetId, l.relationship]
    );
    if (dup.rowCount > 0) { skipped++; continue; }
    await client.query(
      `INSERT INTO links (source_id, target_id, relationship, space_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW())`,
      [l.sourceId, l.targetId, l.relationship, COMM]
    );
    added++;
  }
  console.log(`  ✓ ${added} links added, ${skipped} skipped (dup/missing)`);

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  console.log('\n--- Node type breakdown ---');
  const breakdown = await client.query(
    "SELECT type, COUNT(*)::int AS count FROM nodes WHERE space_id = $1 GROUP BY type ORDER BY count DESC, type",
    [COMM]
  );
  console.table(breakdown.rows);

  const linkCount = await client.query(
    'SELECT relationship, COUNT(*)::int AS count FROM links WHERE space_id = $1 GROUP BY relationship ORDER BY count DESC',
    [COMM]
  );
  console.table(linkCount.rows);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
