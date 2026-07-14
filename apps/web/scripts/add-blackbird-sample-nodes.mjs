// Adds one Event and one Resource node to the Blackbird Ventures community so you
// can see how those node types display in the directory alongside Groups & People.
// Idempotent (ON CONFLICT) and local-only (guard refuses non-local hosts).
//
//   pnpm --filter @visvine/web exec node scripts/add-blackbird-sample-nodes.mjs
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-blackbird-sample-nodes: no DATABASE_URL resolved');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:blackbird-ventures';

// Canonical base types so Event/Resource resolve to the right colour + shape and
// show up in the directory's Type filter. No emoji icons — the app renders type
// glyphs / initials.
const NODE_TYPES = [
  { name: 'Group',    color: '#9333ea', shape: 'square'    },
  { name: 'Person',   color: '#2563eb', shape: 'rectangle' },
  { name: 'Event',    color: '#ef4444', shape: 'rectangle' },
  { name: 'Resource', color: '#f59e0b', shape: 'rectangle' },
];

const EVENT = {
  id: 'event:blackbird-founder-summit-2026',
  name: 'Blackbird Founder Summit 2026',
  subtitle: 'Annual gathering of Blackbird portfolio founders across ANZ',
  location: 'Sydney, Australia',
  url: 'https://blackbird.vc',
  tags: ['Summit', 'Founders', 'Portfolio'],
  metadata: { startAt: '2026-11-05', format: 'In-person', capacity: 400, organizerEmail: 'events@blackbird.vc', status: 'upcoming' },
};

const RESOURCE = {
  id: 'resource:blackbird-founder-playbook',
  name: 'Blackbird Founder Playbook',
  subtitle: 'Fundraising, hiring & scaling guides for portfolio companies',
  url: 'https://blackbird.vc/playbook',
  tags: ['Guide', 'Fundraising', 'Playbook'],
};

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Register Event + Resource on the community's node types (idempotent replace).
  await client.query(
    `UPDATE communities SET node_types = $2::jsonb WHERE id = $1`,
    [COMM, JSON.stringify(NODE_TYPES)],
  );
  console.log('✓ node types: Group, Person, Event, Resource');

  // 2. Event node
  await client.query(
    `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
     VALUES ($1, 'Event', $2, $3, $4, $5, $6, $7::jsonb, $8, NULL, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET type = 'Event', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
       location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, updated_at = NOW()`,
    [EVENT.id, EVENT.name, EVENT.subtitle, EVENT.location, EVENT.url, EVENT.tags, JSON.stringify(EVENT.metadata), COMM],
  );
  console.log(`✓ event    -> ${EVENT.name}`);

  // 3. Resource node
  await client.query(
    `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
     VALUES ($1, 'Resource', $2, $3, NULL, $4, $5, '{}'::jsonb, $6, NULL, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET type = 'Resource', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
       url = EXCLUDED.url, tags = EXCLUDED.tags, updated_at = NOW()`,
    [RESOURCE.id, RESOURCE.name, RESOURCE.subtitle, RESOURCE.url, RESOURCE.tags, COMM],
  );
  console.log(`✓ resource -> ${RESOURCE.name}`);

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  const r = await client.query(
    'SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type',
    [COMM],
  );
  console.table(r.rows);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
