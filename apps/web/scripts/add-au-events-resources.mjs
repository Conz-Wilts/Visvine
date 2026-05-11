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

// 1. Extend the community's nodeTypes to include Resource.
const NODE_TYPES = [
  { icon: '👤', name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'rectangle' },
  { icon: '📅', name: 'Event',        color: '#ef4444', shape: 'rectangle' },
  { icon: '👥', name: 'Group',        color: '#0ea5e9', shape: 'rectangle' },
  { icon: '🌐', name: 'Community',    color: '#10b981', shape: 'hexagon'   },
  { icon: '📦', name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
];

// 2. New Event nodes — real AU tech events not yet in the dataset.
const NEW_EVENTS = [
  {
    id: 'event:startcon-syd-2026', name: 'StartCon 2026',
    subtitle: "Australia's largest startup & growth conference",
    location: 'ICC Sydney', url: 'https://startcon.com',
    tags: ['Conference', 'Growth', 'Startups', 'Marketing'],
    metadata: { date: '2026-11-19', endDate: '2026-11-20', time: '9:00 AM AEDT', capacity: 3500, ticketPrice: '$799', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:pause-fest-melb-2026', name: 'Pause Fest 2026',
    subtitle: 'Tech, creativity & business festival',
    location: 'Federation Square, Melbourne', url: 'https://pausefest.com.au',
    tags: ['Conference', 'Creative Tech', 'Innovation', 'Culture'],
    metadata: { date: '2026-02-04', endDate: '2026-02-06', time: '9:00 AM AEDT', capacity: 2000, ticketPrice: '$549', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:spark-fest-syd-2026', name: 'Spark Festival 2026',
    subtitle: 'Two-week festival celebrating Sydney startups',
    location: 'Various venues, Sydney', url: 'https://sparkfestival.co',
    tags: ['Festival', 'Startups', 'Community', 'Sydney'],
    metadata: { date: '2026-10-12', endDate: '2026-10-23', time: 'Various', capacity: 8000, ticketPrice: 'Mostly free', format: 'Hybrid', status: 'upcoming' },
  },
  {
    id: 'event:ib-beachside-2026', name: 'Innovation Bay Beachside Investor Lunch',
    subtitle: 'Founders pitch to top AU investors over lunch',
    location: 'Bondi Beach, Sydney', url: 'https://innovationbay.com',
    tags: ['Pitch', 'Investors', 'Founders', 'Curated'],
    metadata: { date: '2026-03-06', time: '12:00 PM AEDT', capacity: 80, ticketPrice: 'Invite only', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:antler-demo-w26', name: 'Antler Australia Demo Day W26',
    subtitle: 'Antler AU residency cohort pitches',
    location: 'Antler Sydney HQ', url: 'https://antler.co/locations/sydney',
    tags: ['Demo Day', 'Pre-seed', 'Antler', 'Founders'],
    metadata: { date: '2026-04-29', time: '5:00 PM AEDT', capacity: 250, ticketPrice: 'Invite only', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:startmate-climate-demo-2026', name: 'Startmate Climate Tech Demo Day',
    subtitle: 'Startmate Climate cohort pitches its climate-tech startups',
    location: 'Carriageworks, Sydney', url: 'https://startmate.com',
    tags: ['Demo Day', 'Climate Tech', 'Startmate', 'Sustainability'],
    metadata: { date: '2026-05-22', time: '4:30 PM AEST', capacity: 400, ticketPrice: 'Free', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:intersekt-2026', name: 'Intersekt Fintech Conference 2026',
    subtitle: "Fintech Australia's flagship event",
    location: 'Melbourne Convention Centre', url: 'https://intersekt.com.au',
    tags: ['Fintech', 'Payments', 'Conference', 'Regulation'],
    metadata: { date: '2026-08-25', endDate: '2026-08-26', time: '9:00 AM AEST', capacity: 1500, ticketPrice: '$1099', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:syd-tech-week-2026', name: 'Sydney Tech Week 2026',
    subtitle: "Sydney's curated week of tech meetups, summits & launches",
    location: 'Sydney-wide', url: 'https://sydneytechweek.com',
    tags: ['Tech Week', 'Sydney', 'Meetups', 'Curated'],
    metadata: { date: '2026-09-14', endDate: '2026-09-18', time: 'Various', capacity: 6000, ticketPrice: 'Varies', format: 'In-person', status: 'upcoming' },
  },
];

// 3. New Resource nodes — useful tools, reports, and references for AU founders.
const NEW_RESOURCES = [
  {
    id: 'resource:cut-through-state', name: 'State of Australian Startups',
    subtitle: 'Annual report by Cut Through Venture & Folklore Ventures',
    location: 'Australia-wide', url: 'https://cutthroughventure.com',
    tags: ['Report', 'Data', 'Annual', 'Benchmarks'],
  },
  {
    id: 'resource:tca-annual-report', name: 'Tech Council Annual Report',
    subtitle: 'Sector data, employment & policy positions',
    location: 'Australia-wide', url: 'https://techcouncil.com.au',
    tags: ['Report', 'Policy', 'Data', 'National'],
  },
  {
    id: 'resource:au-vc-landscape', name: 'Australian VC Landscape Map',
    subtitle: 'Directory of active AU funds with stage & cheque size',
    location: 'Australia-wide', url: null,
    tags: ['Directory', 'VC', 'Reference', 'Fundraising'],
  },
  {
    id: 'resource:rnd-tax-guide', name: 'R&D Tax Incentive Founders Guide',
    subtitle: 'Practical how-to for claiming the R&D tax offset',
    location: 'Australia-wide', url: 'https://business.gov.au/rdti',
    tags: ['Guide', 'Tax', 'Government', 'Funding'],
  },
  {
    id: 'resource:austender', name: 'AusTender',
    subtitle: 'Federal government procurement & contract portal',
    location: 'Australia-wide', url: 'https://tenders.gov.au',
    tags: ['Procurement', 'Government', 'Contracts', 'B2G'],
  },
  {
    id: 'resource:ey-fintech-census', name: 'EY FinTech Australia Census',
    subtitle: "Annual industry-wide fintech sector survey",
    location: 'Australia-wide', url: 'https://fintechaustralia.org.au',
    tags: ['Report', 'Fintech', 'Census', 'Annual'],
  },
  {
    id: 'resource:asic-search', name: 'ASIC Company Register',
    subtitle: 'Verify ABNs, directors & company status',
    location: 'Australia-wide', url: 'https://asic.gov.au',
    tags: ['Reference', 'Legal', 'Compliance', 'Verification'],
  },
  {
    id: 'resource:austrade-export', name: 'Austrade Export Markets',
    subtitle: 'Market entry guides for AU companies going global',
    location: 'Australia-wide', url: 'https://austrade.gov.au',
    tags: ['Export', 'Global', 'Markets', 'Government'],
  },
];

// 4. New links wiring the events and resources into the existing graph.
const NEW_LINKS = [
  // StartCon — sponsored by AirTree, hosted in Sydney
  { sourceId: 'org:airtree',                  targetId: 'event:startcon-syd-2026',       relationship: 'sponsors' },
  { sourceId: 'community:au-techsydney',      targetId: 'event:startcon-syd-2026',       relationship: 'partners_with' },

  // Pause Fest — Melbourne community + LaunchVic
  { sourceId: 'community:au-techmelbourne',   targetId: 'event:pause-fest-melb-2026',    relationship: 'partners_with' },
  { sourceId: 'org:launchvic',                targetId: 'event:pause-fest-melb-2026',    relationship: 'sponsors' },

  // Spark Festival — Sydney community
  { sourceId: 'community:au-techsydney',      targetId: 'event:spark-fest-syd-2026',     relationship: 'partners_with' },

  // Innovation Bay — Niki Scevak (Blackbird) regular attendee
  { sourceId: 'person:niki-scevak',           targetId: 'event:ib-beachside-2026',       relationship: 'attended' },
  { sourceId: 'org:blackbird',                targetId: 'event:ib-beachside-2026',       relationship: 'sponsors' },

  // Antler Demo Day — Antler AU runs it
  { sourceId: 'resource:antler-au',           targetId: 'event:antler-demo-w26',         relationship: 'hosts' },

  // Startmate Climate Demo Day — Startmate runs it, Mike Cannon-Brookes attends (climate)
  { sourceId: 'resource:startmate',           targetId: 'event:startmate-climate-demo-2026', relationship: 'hosts' },
  { sourceId: 'person:mike-cannon-brookes',   targetId: 'event:startmate-climate-demo-2026', relationship: 'attended' },

  // Intersekt — Fintech Australia / Tech Council
  { sourceId: 'community:au-tech-council',    targetId: 'event:intersekt-2026',          relationship: 'partners_with' },

  // Sydney Tech Week — TechSydney hosts it
  { sourceId: 'community:au-techsydney',      targetId: 'event:syd-tech-week-2026',      relationship: 'hosts' },

  // Resources — link to their publishers / topics
  { sourceId: 'resource:fund-folklore',       targetId: 'resource:cut-through-state',    relationship: 'publishes' },
  { sourceId: 'community:au-tech-council',    targetId: 'resource:tca-annual-report',    relationship: 'publishes' },
  { sourceId: 'resource:rnd-tax-guide',       targetId: 'resource:gov-rnd-tax',          relationship: 'documents' },
  { sourceId: 'community:au-tech-council',    targetId: 'resource:ey-fintech-census',    relationship: 'partners_with' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Add Resource to nodeTypes
  console.log('--- Adding Resource to AU.nodeTypes ---');
  await client.query(
    'UPDATE communities SET node_types = $1::jsonb WHERE id = $2',
    [JSON.stringify(NODE_TYPES), COMM]
  );
  console.log('  ✓ AU nodeTypes now includes Resource (amber, rectangle)');

  // 2. Insert events
  console.log('\n--- Inserting events ---');
  for (const e of NEW_EVENTS) {
    const r = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
      VALUES ($1, 'Event', $2, $3, $4, $5, $6, $7::jsonb, $8, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'Event', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, updated_at = NOW()
      RETURNING id, name`,
      [e.id, e.name, e.subtitle, e.location, e.url, e.tags, JSON.stringify(e.metadata ?? {}), COMM]);
    console.log(`  ✓ ${r.rows[0].id.padEnd(40)} -> ${r.rows[0].name}`);
  }

  // 3. Insert resources
  console.log('\n--- Inserting resources ---');
  for (const r of NEW_RESOURCES) {
    const res = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
      VALUES ($1, 'Resource', $2, $3, $4, $5, $6, '{}'::jsonb, $7, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'Resource', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, updated_at = NOW()
      RETURNING id, name`,
      [r.id, r.name, r.subtitle, r.location, r.url, r.tags, COMM]);
    console.log(`  ✓ ${res.rows[0].id.padEnd(40)} -> ${res.rows[0].name}`);
  }

  // 4. Links
  console.log('\n--- Inserting links ---');
  for (const l of NEW_LINKS) {
    const sExists = await client.query('SELECT 1 FROM nodes WHERE id = $1', [l.sourceId]);
    const tExists = await client.query('SELECT 1 FROM nodes WHERE id = $1', [l.targetId]);
    if (sExists.rowCount === 0) { console.log(`  ⚠ source missing: ${l.sourceId}`); continue; }
    if (tExists.rowCount === 0) { console.log(`  ⚠ target missing: ${l.targetId}`); continue; }
    const dup = await client.query(
      'SELECT 1 FROM links WHERE source_id = $1 AND target_id = $2 AND relationship = $3',
      [l.sourceId, l.targetId, l.relationship]
    );
    if (dup.rowCount > 0) { console.log(`  ~ exists: ${l.sourceId} -[${l.relationship}]-> ${l.targetId}`); continue; }
    await client.query(
      `INSERT INTO links (source_id, target_id, relationship, community_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW())`,
      [l.sourceId, l.targetId, l.relationship, COMM]
    );
    console.log(`  ✓ ${l.sourceId} -[${l.relationship}]-> ${l.targetId}`);
  }

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  // Final breakdown
  console.log('\n--- AU type breakdown (after) ---');
  const r = await client.query(
    "SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type",
    [COMM]
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
