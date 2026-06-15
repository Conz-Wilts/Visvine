// Loads apps/web/.env (cwd-independent) and refuses to run against any
// non-local host — same env resolution + refusal the destructive db:* scripts use.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-nz-ecosystem: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:nz-ecosystem';
const COMM_NAME = 'NZ Startup Ecosystem';

const NODE_TYPES = [
  { icon: '👤', name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'rectangle' },
  { icon: '📅', name: 'Event',        color: '#ef4444', shape: 'rectangle' },
  { icon: '👥', name: 'Group',        color: '#0ea5e9', shape: 'rectangle' },
  { icon: '🌐', name: 'Community',    color: '#10b981', shape: 'square'   },
  { icon: '📦', name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
];

// Organizations — accelerators, VCs, government, coworking, industry bodies.
// metadata.kind drives downstream filtering / display.
const ORGS = [
  // accelerators
  { id: 'org:icehouse',         name: 'The Icehouse',          subtitle: 'NZ\'s longest-running startup incubator (since 2001)', location: 'Auckland', url: 'https://theicehouse.co.nz',  tags: ['Accelerator', 'Incubator', 'Auckland'],                metadata: { kind: 'accelerator', founded: 2001 } },
  { id: 'org:creative-hq',      name: 'Creative HQ',           subtitle: 'Wellington-based startup accelerator & GovTech specialists', location: 'Wellington', url: 'https://creativehq.co.nz', tags: ['Accelerator', 'GovTech', 'Wellington'],                metadata: { kind: 'accelerator', founded: 2003 } },
  { id: 'org:sprout-agritech',  name: 'Sprout Agritech',       subtitle: 'NZ\'s agritech-focused accelerator',             location: 'Palmerston North', url: 'https://sprout.ag', tags: ['Accelerator', 'Agritech', 'Manawatū'],                metadata: { kind: 'accelerator' } },
  { id: 'org:kiwinet',          name: 'KiwiNet',               subtitle: 'Commercialising research from NZ universities & CRIs', location: 'Auckland', url: 'https://kiwinet.org.nz',  tags: ['Accelerator', 'DeepTech', 'Research'],                metadata: { kind: 'accelerator' } },
  { id: 'org:mahuki',           name: 'Mahuki',                subtitle: 'Te Papa\'s innovation accelerator for cultural-sector startups', location: 'Wellington', url: 'https://mahuki.org', tags: ['Accelerator', 'Cultural', 'Wellington'],                metadata: { kind: 'accelerator' } },
  { id: 'org:lightning-lab',    name: 'Lightning Lab',         subtitle: 'Outcome-focused accelerator (run by Creative HQ)', location: 'Wellington', url: 'https://lightninglab.co.nz', tags: ['Accelerator', 'Programme'],                metadata: { kind: 'accelerator' } },

  // venture capital
  { id: 'org:movac',            name: 'Movac',                 subtitle: 'NZ\'s largest VC fund — Series A / B tech investor', location: 'Wellington', url: 'https://movac.co.nz', tags: ['VC', 'Series A', 'Series B'],                metadata: { kind: 'vc', stage: 'Series A/B' } },
  { id: 'org:icehouse-ventures',name: 'Icehouse Ventures',     subtitle: 'NZ\'s most active early-stage tech investor',     location: 'Auckland', url: 'https://icehouseventures.co.nz', tags: ['VC', 'Seed', 'Early Stage'],                metadata: { kind: 'vc', stage: 'Seed/Series A' } },
  { id: 'org:outset-ventures',  name: 'Outset Ventures',       subtitle: 'Deep-tech research lab & venture fund',           location: 'Auckland', url: 'https://outset.ventures', tags: ['VC', 'DeepTech', 'Hardware'],                metadata: { kind: 'vc', stage: 'Pre-seed/Seed' } },
  { id: 'org:gd1',              name: 'GD1 (Global from Day 1)', subtitle: 'NZ\'s software-focused growth fund',           location: 'Auckland', url: 'https://gd1.vc',          tags: ['VC', 'Software', 'Growth'],                metadata: { kind: 'vc', stage: 'Series A/B' } },
  { id: 'org:pacific-channel',  name: 'Pacific Channel',       subtitle: 'Deep-tech VC across health, climate & food',      location: 'Auckland', url: 'https://pacificchannel.com', tags: ['VC', 'DeepTech', 'Climate', 'Health'],                metadata: { kind: 'vc', stage: 'Seed/Series A' } },
  { id: 'org:blackbird-nz',     name: 'Blackbird Aotearoa',    subtitle: 'Trans-Tasman VC — NZ chapter',                    location: 'Auckland', url: 'https://blackbird.vc', tags: ['VC', 'Trans-Tasman', 'Generalist'],                metadata: { kind: 'vc', stage: 'Pre-seed to Series B' } },

  // government / public funders
  { id: 'org:callaghan',        name: 'Callaghan Innovation',  subtitle: 'NZ\'s government innovation agency — R&D grants & tax incentive', location: 'Wellington', url: 'https://callaghaninnovation.govt.nz', tags: ['Government', 'Funding', 'R&D'],                metadata: { kind: 'gov_agency' } },
  { id: 'org:nzte',             name: 'NZTE',                  subtitle: 'New Zealand Trade & Enterprise — export & global growth support', location: 'Wellington', url: 'https://nzte.govt.nz', tags: ['Government', 'Export', 'International'],                metadata: { kind: 'gov_agency' } },
  { id: 'org:mbie',             name: 'MBIE',                  subtitle: 'Ministry of Business, Innovation & Employment',   location: 'Wellington', url: 'https://mbie.govt.nz', tags: ['Government', 'Policy'],                metadata: { kind: 'gov_agency' } },
  { id: 'org:nzgcp',            name: 'NZGCP',                 subtitle: 'NZ Growth Capital Partners — Aspire & Elevate funds', location: 'Wellington', url: 'https://nzgcp.co.nz', tags: ['Government', 'Funding', 'VC'],                metadata: { kind: 'gov_agency' } },

  // coworking
  { id: 'org:bizdojo',          name: 'BizDojo',               subtitle: 'Coworking & community spaces across NZ',          location: 'Auckland / Wellington', url: 'https://bizdojo.com', tags: ['Coworking', 'Community'],                metadata: { kind: 'coworking' } },
  { id: 'org:gridakl',          name: 'GridAKL',               subtitle: 'Innovation precinct in Auckland\'s Wynyard Quarter', location: 'Auckland', url: 'https://gridakl.co.nz', tags: ['Coworking', 'Innovation', 'Auckland'],                metadata: { kind: 'coworking' } },
  { id: 'org:epic-chch',        name: 'EPIC Christchurch',     subtitle: 'Post-quake innovation campus for ChCh tech',      location: 'Christchurch', url: 'https://epicinnovation.co.nz', tags: ['Coworking', 'Innovation', 'Christchurch'],                metadata: { kind: 'coworking' } },

  // industry bodies / networks
  { id: 'org:nztech',           name: 'NZTech',                subtitle: 'NZ\'s tech sector representative body',           location: 'Auckland', url: 'https://nztech.org.nz', tags: ['Industry Body', 'Advocacy'],                metadata: { kind: 'industry_body' } },
  { id: 'org:angelhq',          name: 'AngelHQ',               subtitle: 'Wellington-based angel investor network',         location: 'Wellington', url: 'https://angelhq.nz', tags: ['Angel', 'Investors', 'Wellington'],                metadata: { kind: 'industry_body' } },
  { id: 'org:fintechnz',        name: 'FinTechNZ',             subtitle: 'NZTech\'s fintech industry group',                location: 'Auckland', url: 'https://fintechnz.org.nz', tags: ['Fintech', 'Industry Body'],                metadata: { kind: 'industry_body' } },
];

// Events — real / representative NZ tech & startup events in 2026.
const EVENTS = [
  { id: 'event:techweek-akl-2026',      name: 'TechWeek Auckland 2026',   subtitle: 'NZ\'s biggest week of tech meetups & summits',         location: 'Auckland-wide', url: 'https://techweek.co.nz',         tags: ['Tech Week', 'Auckland', 'Meetups'],            metadata: { date: '2026-05-18', endDate: '2026-05-24', format: 'Hybrid', capacity: 8000, ticketPrice: 'Mostly free', status: 'upcoming' } },
  { id: 'event:hi-tech-awards-2026',    name: 'NZ Hi-Tech Awards 2026',   subtitle: 'Annual celebration of NZ\'s top tech companies & founders', location: 'Christchurch', url: 'https://hitech.org.nz', tags: ['Awards', 'National', 'Tech'],                  metadata: { date: '2026-05-29', format: 'In-person', capacity: 1000, ticketPrice: '$345', status: 'upcoming' } },
  { id: 'event:southern-saas-2026',     name: 'Southern SaaS 2026',       subtitle: 'NZ\'s SaaS founder community conference',             location: 'Queenstown',    url: 'https://southernsaas.co', tags: ['SaaS', 'Conference', 'Queenstown'],          metadata: { date: '2026-09-10', endDate: '2026-09-11', format: 'In-person', capacity: 350, ticketPrice: '$899', status: 'upcoming' } },
  { id: 'event:startup-grind-akl-may',  name: 'Startup Grind Auckland — May meetup', subtitle: 'Monthly founder fireside chat',          location: 'GridAKL',       url: 'https://startupgrind.com/auckland', tags: ['Meetup', 'Auckland', 'Founders'],                metadata: { date: '2026-05-21', format: 'In-person', capacity: 120, ticketPrice: '$15', status: 'upcoming' } },
  { id: 'event:startup-grind-wlg-may',  name: 'Startup Grind Wellington — May meetup', subtitle: 'Monthly fireside with a Wellington founder', location: 'BizDojo Wellington', url: 'https://startupgrind.com/wellington', tags: ['Meetup', 'Wellington', 'Founders'],                metadata: { date: '2026-05-28', format: 'In-person', capacity: 80, ticketPrice: '$10', status: 'upcoming' } },
  { id: 'event:icehouse-first-cut-2026',name: 'Icehouse First Cut Demo Day', subtitle: 'Icehouse pre-seed cohort pitches its companies',   location: 'GridAKL',       url: 'https://theicehouse.co.nz',         tags: ['Demo Day', 'Pre-seed', 'Icehouse'],            metadata: { date: '2026-06-12', format: 'In-person', capacity: 200, ticketPrice: 'Invite only', status: 'upcoming' } },
  { id: 'event:sprout-demo-2026',       name: 'Sprout Agritech Demo Day',  subtitle: 'Annual showcase of Sprout\'s agritech cohort',        location: 'Palmerston North', url: 'https://sprout.ag', tags: ['Demo Day', 'Agritech', 'Manawatū'],                metadata: { date: '2026-10-08', format: 'Hybrid', capacity: 300, ticketPrice: 'Free', status: 'upcoming' } },
  { id: 'event:startup-weekend-akl-2026', name: 'Startup Weekend Auckland', subtitle: '54-hour build sprint from idea to pitch',            location: 'Auckland',      url: 'https://startupweekend.org', tags: ['Hackathon', 'Auckland', 'Builders'],                metadata: { date: '2026-08-21', endDate: '2026-08-23', format: 'In-person', capacity: 100, ticketPrice: '$99', status: 'upcoming' } },
  { id: 'event:angelhq-pitch-jun-2026', name: 'AngelHQ Pitch Night — June', subtitle: 'Three pre-vetted startups pitch to Wellington angels', location: 'Wellington', url: 'https://angelhq.nz',         tags: ['Pitch', 'Investors', 'Wellington'],                metadata: { date: '2026-06-04', format: 'In-person', capacity: 80, ticketPrice: 'Invite only', status: 'upcoming' } },
  { id: 'event:nzte-beachheads-2026',   name: 'NZTE Beachheads briefing — North America', subtitle: 'NZTE-led market entry briefing for US-bound founders', location: 'Auckland', url: 'https://nzte.govt.nz', tags: ['Export', 'NZTE', 'USA'],                metadata: { date: '2026-07-15', format: 'In-person', capacity: 60, ticketPrice: 'Free', status: 'upcoming' } },
  { id: 'event:climate-connect-2026',   name: 'Climate Connect Aotearoa Summit', subtitle: 'Annual climate-tech gathering hosted at AUT',  location: 'Auckland',      url: 'https://climateconnect.org.nz', tags: ['Climate Tech', 'Summit', 'Auckland'],                metadata: { date: '2026-09-23', endDate: '2026-09-24', format: 'In-person', capacity: 500, ticketPrice: '$299', status: 'upcoming' } },
  { id: 'event:nz-ai-summit-2026',      name: 'NZ AI Summit 2026',        subtitle: 'Applied AI for NZ businesses & policy',               location: 'Wellington',    url: 'https://aiforum.org.nz', tags: ['AI', 'Summit', 'Wellington'],                metadata: { date: '2026-11-04', format: 'In-person', capacity: 600, ticketPrice: '$449', status: 'upcoming' } },
  { id: 'event:fintech-forum-2026',     name: 'NZ Fintech Forum 2026',    subtitle: 'FinTechNZ\'s flagship industry event',                location: 'Auckland',      url: 'https://fintechnz.org.nz', tags: ['Fintech', 'Forum'],                metadata: { date: '2026-09-04', format: 'In-person', capacity: 400, ticketPrice: '$599', status: 'upcoming' } },
  { id: 'event:agritech-summit-2026',   name: 'Aotearoa AgriTech Summit', subtitle: 'AgriTech NZ\'s annual industry summit',               location: 'Hamilton',      url: 'https://agritechnz.org.nz', tags: ['Agritech', 'Summit', 'Waikato'],                metadata: { date: '2026-08-13', endDate: '2026-08-14', format: 'In-person', capacity: 350, ticketPrice: '$549', status: 'upcoming' } },
  { id: 'event:founders-marketplace-2026', name: 'Founders Marketplace AKL', subtitle: 'Founder-to-founder peer marketplace (Icehouse)',   location: 'Auckland',      url: 'https://theicehouse.co.nz', tags: ['Networking', 'Founders', 'Icehouse'],                metadata: { date: '2026-06-26', format: 'In-person', capacity: 150, ticketPrice: 'Invite only', status: 'upcoming' } },
  { id: 'event:mahuki-showcase-2026',   name: 'Mahuki Innovation Showcase', subtitle: 'Cultural-sector startup demos at Te Papa',           location: 'Wellington',    url: 'https://mahuki.org', tags: ['Demo Day', 'Cultural', 'Wellington'],                metadata: { date: '2026-11-13', format: 'In-person', capacity: 200, ticketPrice: 'Free', status: 'upcoming' } },
];

// Resources — always-on programmes, guides, reports, references.
const RESOURCES = [
  { id: 'resource:callaghan-rdti',   name: 'R&D Tax Incentive (RDTI)',       subtitle: '15% rebate on eligible R&D — flagship Callaghan programme', url: 'https://callaghaninnovation.govt.nz/rdti', tags: ['Funding', 'Tax', 'Government', 'R&D'] },
  { id: 'resource:callaghan-grants', name: 'Callaghan R&D Grants',          subtitle: 'Project, Career & Student grants for NZ R&D-active firms',  url: 'https://callaghaninnovation.govt.nz/grants', tags: ['Funding', 'Grant', 'R&D'] },
  { id: 'resource:nzte-beachheads',  name: 'NZTE Beachheads Programme',     subtitle: 'On-the-ground export advisors in 13 key global markets',    url: 'https://nzte.govt.nz/beachheads', tags: ['Export', 'International', 'NZTE'] },
  { id: 'resource:inz-ewv',          name: 'Entrepreneur Work Visa',        subtitle: 'INZ visa pathway for founders relocating to NZ',            url: 'https://immigration.govt.nz', tags: ['Visa', 'Founders', 'Immigration'] },
  { id: 'resource:fernmark',         name: 'FernMark Licensing Programme',   subtitle: 'NZTE country-of-origin trustmark for NZ exporters',         url: 'https://nzte.govt.nz/fernmark', tags: ['Export', 'Branding', 'NZTE'] },
  { id: 'resource:nzgcp-aspire',     name: 'NZGCP Aspire Seed Fund',         subtitle: 'Co-investment seed fund matching private capital 1:1',      url: 'https://nzgcp.co.nz/aspire', tags: ['Funding', 'Seed', 'Government'] },
  { id: 'resource:mbie-endeavour',   name: 'MBIE Endeavour Fund',            subtitle: 'NZ\'s largest contestable research investment fund',         url: 'https://mbie.govt.nz/endeavour', tags: ['Funding', 'Research', 'Government'] },
  { id: 'resource:hitech-report',    name: 'NZ Hi-Tech Sector Report',       subtitle: 'Annual benchmark of NZ tech sector size, growth & exports', url: 'https://hitech.org.nz/report', tags: ['Report', 'Sector', 'Annual'] },
  { id: 'resource:startup-council',  name: 'NZ Startup Advisors\' Council Report', subtitle: 'Policy recommendations for NZ\'s startup ecosystem',  url: 'https://mbie.govt.nz/startup-council', tags: ['Report', 'Policy', 'Government'] },
  { id: 'resource:equity-calc',      name: 'Aotearoa Founder Equity Calculator', subtitle: 'Open-source equity-split tool tuned to NZ deal terms', url: 'https://angelhq.nz/equity-calculator', tags: ['Tool', 'Founders', 'Equity'] },
];

// Links — wire orgs, events, and resources into a connected graph.
const LINKS = [
  // Government agencies own / fund the public resources
  { sourceId: 'org:callaghan',  targetId: 'resource:callaghan-rdti',    relationship: 'owns' },
  { sourceId: 'org:callaghan',  targetId: 'resource:callaghan-grants',  relationship: 'owns' },
  { sourceId: 'org:nzte',       targetId: 'resource:nzte-beachheads',   relationship: 'owns' },
  { sourceId: 'org:nzte',       targetId: 'resource:fernmark',          relationship: 'owns' },
  { sourceId: 'org:nzgcp',      targetId: 'resource:nzgcp-aspire',      relationship: 'owns' },
  { sourceId: 'org:mbie',       targetId: 'resource:mbie-endeavour',    relationship: 'owns' },
  { sourceId: 'org:mbie',       targetId: 'resource:startup-council',   relationship: 'publishes' },
  { sourceId: 'org:nztech',     targetId: 'resource:hitech-report',     relationship: 'publishes' },
  { sourceId: 'org:angelhq',    targetId: 'resource:equity-calc',       relationship: 'publishes' },

  // Event hosts
  { sourceId: 'org:nztech',          targetId: 'event:techweek-akl-2026',         relationship: 'hosts' },
  { sourceId: 'org:nztech',          targetId: 'event:hi-tech-awards-2026',       relationship: 'hosts' },
  { sourceId: 'org:icehouse',        targetId: 'event:icehouse-first-cut-2026',   relationship: 'hosts' },
  { sourceId: 'org:icehouse',        targetId: 'event:founders-marketplace-2026', relationship: 'hosts' },
  { sourceId: 'org:sprout-agritech', targetId: 'event:sprout-demo-2026',          relationship: 'hosts' },
  { sourceId: 'org:angelhq',         targetId: 'event:angelhq-pitch-jun-2026',    relationship: 'hosts' },
  { sourceId: 'org:nzte',            targetId: 'event:nzte-beachheads-2026',      relationship: 'hosts' },
  { sourceId: 'org:fintechnz',       targetId: 'event:fintech-forum-2026',        relationship: 'hosts' },
  { sourceId: 'org:mahuki',          targetId: 'event:mahuki-showcase-2026',      relationship: 'hosts' },
  { sourceId: 'org:gridakl',         targetId: 'event:startup-grind-akl-may',     relationship: 'hosts' },
  { sourceId: 'org:bizdojo',         targetId: 'event:startup-grind-wlg-may',     relationship: 'hosts' },

  // Sponsorship / partnership
  { sourceId: 'org:callaghan',       targetId: 'event:techweek-akl-2026',         relationship: 'sponsors' },
  { sourceId: 'org:icehouse-ventures', targetId: 'event:icehouse-first-cut-2026', relationship: 'partners_with' },
  { sourceId: 'org:movac',           targetId: 'event:southern-saas-2026',        relationship: 'sponsors' },
  { sourceId: 'org:gd1',             targetId: 'event:southern-saas-2026',        relationship: 'sponsors' },
  { sourceId: 'org:pacific-channel', targetId: 'event:climate-connect-2026',      relationship: 'sponsors' },
  { sourceId: 'org:outset-ventures', targetId: 'event:climate-connect-2026',      relationship: 'sponsors' },
  { sourceId: 'org:blackbird-nz',    targetId: 'event:nz-ai-summit-2026',         relationship: 'sponsors' },

  // Ecosystem capital flows (VCs invest into accelerator cohorts)
  { sourceId: 'org:icehouse-ventures', targetId: 'org:icehouse',                relationship: 'funds' },
  { sourceId: 'org:movac',           targetId: 'org:gd1',                        relationship: 'co_invests_with' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Community
  console.log('--- Upserting NZ community ---');
  await client.query(`
    INSERT INTO communities (id, name, description, location, tags, node_types, country, created_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'NZ', NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
      location = EXCLUDED.location, tags = EXCLUDED.tags, node_types = EXCLUDED.node_types, country = 'NZ'
  `, [COMM, COMM_NAME, 'New Zealand startup ecosystem — events, resources, accelerators, funders, and the orgs that connect them.', 'Aotearoa New Zealand', ['NZ', 'Startup', 'Ecosystem'], JSON.stringify(NODE_TYPES)]);
  console.log(`  ✓ ${COMM}`);

  // 2. Organizations
  console.log('\n--- Inserting organizations ---');
  for (const o of ORGS) {
    const r = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
      VALUES ($1, 'organization', $2, $3, $4, $5, $6, $7::jsonb, $8, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'organization', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, updated_at = NOW()
      RETURNING id, name`,
      [o.id, o.name, o.subtitle, o.location, o.url, o.tags, JSON.stringify(o.metadata ?? {}), COMM]);
    console.log(`  ✓ ${r.rows[0].id.padEnd(28)} -> ${r.rows[0].name}`);
  }

  // 3. Events
  console.log('\n--- Inserting events ---');
  for (const e of EVENTS) {
    const r = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
      VALUES ($1, 'event', $2, $3, $4, $5, $6, $7::jsonb, $8, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'event', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, updated_at = NOW()
      RETURNING id, name`,
      [e.id, e.name, e.subtitle, e.location, e.url, e.tags, JSON.stringify(e.metadata ?? {}), COMM]);
    console.log(`  ✓ ${r.rows[0].id.padEnd(42)} -> ${r.rows[0].name}`);
  }

  // 4. Resources
  console.log('\n--- Inserting resources ---');
  for (const r of RESOURCES) {
    const res = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
      VALUES ($1, 'resource', $2, $3, NULL, $4, $5, '{}'::jsonb, $6, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'resource', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        url = EXCLUDED.url, tags = EXCLUDED.tags, updated_at = NOW()
      RETURNING id, name`,
      [r.id, r.name, r.subtitle, r.url, r.tags, COMM]);
    console.log(`  ✓ ${res.rows[0].id.padEnd(35)} -> ${res.rows[0].name}`);
  }

  // 5. Links
  console.log('\n--- Inserting links ---');
  for (const l of LINKS) {
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

  console.log('\n--- NZ node type breakdown ---');
  const r = await client.query(
    "SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type",
    [COMM]
  );
  console.table(r.rows);

} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
