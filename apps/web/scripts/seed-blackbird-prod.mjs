// PRODUCTION seed for the "Blackbird Ventures" community.
//
// This is the prod-safe sibling of add-blackbird-ventures.mjs. The differences
// that matter:
//
//   1. NO local-db guard. This script is *meant* to run against Cloud SQL, so
//      instead of refusing non-local hosts it refuses to run UNLESS the caller
//      explicitly opts in with `CONFIRM_PROD_SEED=blackbird` (or `--yes`). That
//      flips the safety default the right way for a prod target.
//
//   2. Admin is a real human, not the @local.dev seed users. It upserts a
//      single User row for BLACKBIRD_ADMIN_EMAIL (default connor@visvine.com)
//      as an ACTIVE account and grants it `admin` on the community. Active +
//      matched-by-email means the Google OAuth callback (see
//      app/api/auth/callback/google/route.ts step 7) links the real Google
//      identity to THIS row on first login, so the admin grant carries over.
//
//   3. Idempotent + non-destructive by default. The data transform is
//      deterministic, so re-running is safe. On a deploy where the community
//      already has nodes it does NOT wipe + rebuild (that would clobber any
//      admin edits made in the live UI) — it only ensures the community and the
//      admin grant exist. Pass BLACKBIRD_RESEED=1 to force a full rebuild from
//      the research JSON.
//
// Usage (local, behind the Cloud SQL Auth Proxy — see scripts/start-cloud-sql-proxy.sh):
//   CONFIRM_PROD_SEED=blackbird node apps/web/scripts/seed-blackbird-prod.mjs
//
// Usage (CI, inside .github/workflows/deploy.yml, with DATABASE_URL already
// pointed at the proxied prod instance):
//   DATABASE_URL="$DB_URL" CONFIRM_PROD_SEED=blackbird node scripts/seed-blackbird-prod.mjs
//
// Data comes from ./data/blackbird-ventures.research.json (same source the local
// seed uses).
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- prod safety gate -------------------------------------------------------
// Inverse of guard-local-db: this script targets prod on purpose, so require an
// explicit, hard-to-trip-by-accident opt-in.
const confirmed =
  process.env.CONFIRM_PROD_SEED === 'blackbird' || process.argv.includes('--yes');
if (!confirmed) {
  console.error(
    '\n  REFUSED: seed-blackbird-prod is a PRODUCTION seed.\n' +
      '  Re-run with CONFIRM_PROD_SEED=blackbird (or pass --yes) once you are sure\n' +
      '  the resolved DATABASE_URL points at the intended Cloud SQL instance.\n',
  );
  process.exit(1);
}

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('seed-blackbird-prod: no DATABASE_URL / DB_HOST resolved');

// Log the target host (never the password) so prod runs are auditable.
try {
  const u = new URL(connectionString);
  console.log(`seed-blackbird-prod: target host=${u.hostname}:${u.port || '(default)'} db=${u.pathname.slice(1) || '(unknown)'}`);
} catch {
  console.log('seed-blackbird-prod: target = (discrete DB_* parts)');
}

const ADMIN_EMAIL = (process.env.BLACKBIRD_ADMIN_EMAIL ?? 'connor@visvine.com').toLowerCase();
const ADMIN_NAME = process.env.BLACKBIRD_ADMIN_NAME ?? 'Connor Wiltshire';
const FORCE_RESEED = process.env.BLACKBIRD_RESEED === '1' || process.argv.includes('--reseed');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:blackbird-ventures';
const COMM_NAME = 'Blackbird Ventures';
const COMM_DESC =
  'Blackbird Ventures is a leading Australian & New Zealand venture capital firm. ' +
  'This community maps its portfolio companies and the founders behind them.';

const NODE_TYPES = [
  { icon: '🏢', name: 'Organization', color: '#9333ea', shape: 'hexagon' },
  { icon: '👤', name: 'Person', color: '#2563eb', shape: 'rectangle' },
];

const COMMUNITY_ALIASES = [
  { name: 'Portfolio Company', color: '#0891b2', nodeType: 'Organization' },
  { name: 'Founder', color: '#16a34a', nodeType: 'Person' },
];

const SECTOR_OPTIONS = [
  'Fintech', 'Healthtech', 'Climate & Energy', 'SaaS & Enterprise',
  'Consumer & Marketplace', 'AI & ML', 'Deep Tech & Hardware', 'Space & Defence',
  'Biotech', 'Developer Tools', 'Agtech & Food', 'Crypto & Web3', 'Other',
];

const STATUS_OPTIONS = ['Active', 'Exited', 'IPO', 'Onboarding', 'Written Off'];
const STAGE_OPTIONS = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Growth', 'Public', 'Acquired', 'Defunct'];
const COUNTRY_OPTIONS = ['Australia', 'New Zealand', 'USA', 'United Kingdom', 'Singapore', 'Other'];

const COLUMNS = [
  { key: 'status', name: 'Status', type: 'select', options: STATUS_OPTIONS },
  { key: 'sector', name: 'Sector', type: 'select', options: SECTOR_OPTIONS },
  { key: 'funding_stage', name: 'Funding Stage', type: 'select', options: STAGE_OPTIONS },
  { key: 'founded', name: 'Founded', type: 'number', options: null },
  { key: 'hq_country', name: 'HQ Country', type: 'select', options: COUNTRY_OPTIONS },
  { key: 'total_raised', name: 'Total Raised', type: 'text', options: null },
  { key: 'website', name: 'Website', type: 'text', options: null },
];

const STATUS_GROUP = {
  'Active': 'active', 'Exited': 'exit', 'IPO': 'ipo',
  'Onboarding': 'onboarding', 'Written Off': 'written-off',
};

// ---- helpers (verbatim from add-blackbird-ventures.mjs) ----------------------

function slugify(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function normLinkedin(u) {
  if (!u) return null;
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('?')[0].replace(/\/+$/, '');
  return s || null;
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
  return parsed;
}

function snapCountry(x) {
  if (!x) return null;
  const l = String(x).toLowerCase();
  if (l.includes('australia')) return 'Australia';
  if (l.includes('zealand') || l === 'nz' || l.includes('aotearoa')) return 'New Zealand';
  if (l.includes('united states') || l === 'usa' || l === 'us' || l.includes('u.s') || l.includes('america')) return 'USA';
  if (l.includes('united kingdom') || l === 'uk' || l.includes('england') || l.includes('britain') || l.includes('scotland')) return 'United Kingdom';
  if (l.includes('singapore')) return 'Singapore';
  return 'Other';
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// ---- load + build the in-memory model ---------------------------------------

const DATA_PATH = join(__dirname, 'data', 'blackbird-ventures.research.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const RESEARCHED_AT = data.researchedAt ?? null;
const RAW = Array.isArray(data.companies) ? data.companies : [];

const orgs = [];
const orgSlugSeen = new Set();
const foundedYearByOrg = new Map();

for (const c of RAW) {
  if (!c || !c.name) continue;
  const base = slugify(c.name) || ('co-' + orgs.length);
  let slug = base;
  if (orgSlugSeen.has(slug)) {
    const suf = slugify(c.hqCountry || '') || 'x';
    slug = base + '-' + suf;
    let n = 2;
    while (orgSlugSeen.has(slug)) { slug = base + '-' + suf + '-' + n; n++; }
  }
  orgSlugSeen.add(slug);
  const id = 'org:' + slug;
  if (c.foundedYear) foundedYearByOrg.set(id, String(c.foundedYear));

  const snappedSector = snapSector(c);
  const columnValues = {
    status: c.status,
    sector: snappedSector,
    funding_stage: snapStage(c),
    founded: c.foundedYear ? String(c.foundedYear) : null,
    hq_country: snapCountry(c.hqCountry),
    total_raised: c.totalRaised || null,
    website: c.website || null,
  };

  orgs.push({ id, c, snappedSector, columnValues });
}

const personByKey = new Map();
const personSlugSeen = new Map();

function mergePerson(p, f) {
  if (!p.role && f.role) p.role = f.role;
  if (!p.bio && f.bio) p.bio = f.bio;
  if (!p.linkedinUrl && f.linkedinUrl) p.linkedinUrl = f.linkedinUrl;
  if (!p.twitterUrl && f.twitterUrl) p.twitterUrl = f.twitterUrl;
  if (!p.website && f.website) p.website = f.website;
  if (!p.location && f.location) p.location = f.location;
}

for (const o of orgs) {
  const founders = Array.isArray(o.c.founders) ? o.c.founders : [];
  for (const f of founders) {
    if (!f || !f.name || !f.name.trim()) continue;
    const li = normLinkedin(f.linkedinUrl);
    const key = li ? 'li:' + li : 'nm:' + slugify(f.name);
    if (personByKey.has(key)) {
      const p = personByKey.get(key);
      p.companies.add(o.id);
      mergePerson(p, f);
      continue;
    }
    let base = slugify(f.name) || ('founder-' + personByKey.size);
    let slug = base;
    if (personSlugSeen.has(slug) && personSlugSeen.get(slug) !== key) {
      const suf = o.id.replace(/^org:/, '');
      slug = base + '-' + suf;
      let n = 2;
      while (personSlugSeen.has(slug) && personSlugSeen.get(slug) !== key) { slug = base + '-' + suf + '-' + n; n++; }
    }
    personSlugSeen.set(slug, key);
    personByKey.set(key, {
      id: 'person:' + slug,
      name: f.name.trim(),
      role: f.role || null,
      bio: f.bio || null,
      linkedinUrl: f.linkedinUrl || null,
      twitterUrl: f.twitterUrl || null,
      website: f.website || null,
      location: f.location || null,
      companies: new Set([o.id]),
      primaryCompanyName: o.c.name,
    });
  }
}

const persons = Array.from(personByKey.values());

const links = [];
for (const p of persons) {
  for (const orgId of p.companies) {
    links.push({ sourceId: p.id, targetId: orgId, since: foundedYearByOrg.get(orgId) ?? null });
  }
}

// ---- write to the DB --------------------------------------------------------

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Community (upsert — never destructive)
  console.log('--- Upserting Blackbird Ventures community ---');
  await client.query(
    `INSERT INTO communities (id, name, description, location, tags, node_types, community_aliases, country, emoji, image_url, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'AU', '🐦', NULL, NOW())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
       location = EXCLUDED.location, tags = EXCLUDED.tags, node_types = EXCLUDED.node_types,
       community_aliases = EXCLUDED.community_aliases, country = EXCLUDED.country, emoji = EXCLUDED.emoji`,
    [COMM, COMM_NAME, COMM_DESC, 'Sydney, Australia', ['VC', 'Portfolio', 'Australia', 'New Zealand'],
      JSON.stringify(NODE_TYPES), JSON.stringify(COMMUNITY_ALIASES)],
  );
  console.log(`  ✓ ${COMM}`);

  // 1b. Ensure the human admin exists as an ACTIVE user + grant admin.
  // Active + matched-by-email means the Google OAuth callback links the real
  // Google identity to this row on first login (see callback step 7), so the
  // admin role carries over without a separate claim flow.
  console.log('\n--- Ensuring community admin ---');
  const adminRow = await client.query(
    `INSERT INTO "user" (name, email, email_verified, is_active, created_at, updated_at)
     VALUES ($1, $2, true, true, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET is_active = true, updated_at = NOW()
     RETURNING id`,
    [ADMIN_NAME, ADMIN_EMAIL],
  );
  const adminId = adminRow.rows[0].id;
  await client.query(
    `INSERT INTO user_communities (user_id, community_id, role, joined_at, private_meta)
     VALUES ($1, $2, 'admin', NOW(), '{}'::jsonb)
     ON CONFLICT (user_id, community_id) DO UPDATE SET role = 'admin'`,
    [adminId, COMM],
  );
  console.log(`  ✓ ${ADMIN_EMAIL} (user ${adminId}) is admin of ${COMM}`);

  // Decide whether to (re)build the node graph. Non-destructive by default: if
  // the community already has nodes and we weren't told to reseed, leave the
  // data alone (don't clobber live admin edits) and just keep community+admin.
  const existing = await client.query('SELECT COUNT(*)::int AS n FROM nodes WHERE community_id = $1', [COMM]);
  const existingCount = existing.rows[0].n;
  const shouldBuild = existingCount === 0 || FORCE_RESEED;

  if (!shouldBuild) {
    await client.query(
      `UPDATE communities SET member_count = (SELECT COUNT(*) FROM user_communities WHERE community_id = $1) WHERE id = $1`,
      [COMM],
    );
    await client.query('COMMIT');
    console.log(
      `\n=== Community + admin ensured. Skipped data rebuild (${existingCount} existing node(s); ` +
        `set BLACKBIRD_RESEED=1 to force). Committed. ===`,
    );
  } else {
    // 2. CRM columns (before values so column_id exists). DB defaults the uuid id.
    console.log('\n--- Upserting CRM columns ---');
    const columnIdByKey = new Map();
    for (let i = 0; i < COLUMNS.length; i++) {
      const col = COLUMNS[i];
      const r = await client.query(
        `INSERT INTO community_columns (community_id, column_key, column_name, column_type, options, position, node_type, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'organization', NOW())
         ON CONFLICT (community_id, column_key) DO UPDATE SET column_name = EXCLUDED.column_name,
           column_type = EXCLUDED.column_type, options = EXCLUDED.options, position = EXCLUDED.position,
           node_type = EXCLUDED.node_type
         RETURNING id`,
        [COMM, col.key, col.name, col.type, col.options ? JSON.stringify(col.options) : null, i],
      );
      columnIdByKey.set(col.key, r.rows[0].id);
      console.log(`  ✓ ${col.key.padEnd(14)} (${col.type})`);
    }

    // Clear this community's existing nodes first so re-runs (and any id-scheme
    // change) don't leave orphans. Cascades to links + community_column_values.
    // Scoped strictly to community_id — touches no other tenant's data.
    const cleared = await client.query('DELETE FROM nodes WHERE community_id = $1', [COMM]);
    console.log(`\n--- Cleared ${cleared.rowCount} existing node(s) for a clean rebuild ---`);

    // 3. Organization (company) nodes
    console.log('\n--- Inserting companies ---');
    for (const o of orgs) {
      const c = o.c;
      const tags = uniq([o.snappedSector, c.status, 'Blackbird Portfolio', ...(c.subSectors || []).slice(0, 2)]);
      const metadata = {
        kind: 'portfolio_company',
        status: c.status,
        statusGroup: STATUS_GROUP[c.status] ?? null,
        foundedYear: c.foundedYear ?? null,
        sector: c.sector ?? null,
        snappedSector: o.snappedSector,
        subSectors: c.subSectors || [],
        fundingStage: c.fundingStage ?? null,
        totalRaised: c.totalRaised ?? null,
        totalRaisedUsd: c.totalRaisedUsd ?? null,
        hqCountry: c.hqCountry ?? null,
        longDescription: c.longDescription ?? null,
        website: c.website ?? null,
        crunchbase: c.crunchbase ?? null,
        linkedin: c.linkedin ?? null,
        twitter: c.twitter ?? null,
        exitDetails: c.exitDetails ?? null,
        matchedCompany: c.matchedCompany ?? null,
        research: { confidence: c.confidence ?? null, missingFields: c.missingFields || [], sources: c.sources || [], researchedAt: RESEARCHED_AT },
      };
      await client.query(
        `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, image_url, metadata, community_id, alias, created_at, updated_at)
         VALUES ($1, 'organization', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'Portfolio Company', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET type = 'organization', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
           location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, image_url = EXCLUDED.image_url,
           metadata = EXCLUDED.metadata, community_id = EXCLUDED.community_id, alias = EXCLUDED.alias, updated_at = NOW()`,
        [o.id, c.name, c.subtitle ?? null, c.hqLocation ?? null, c.website ?? null, tags, null, JSON.stringify(metadata), COMM],
      );
    }
    console.log(`  ✓ ${orgs.length} companies`);

    // 4. Founder (person) nodes
    console.log('\n--- Inserting founders ---');
    for (const p of persons) {
      const subtitle = (p.role || 'Founder') + (p.primaryCompanyName ? `, ${p.primaryCompanyName}` : '');
      const metadata = {
        kind: 'founder',
        bio: p.bio ?? null,
        website: p.website ?? null,
        linkedinUrl: p.linkedinUrl ?? null,
        twitterUrl: p.twitterUrl ?? null,
        role: p.role ?? null,
        companies: Array.from(p.companies),
        research: { researchedAt: RESEARCHED_AT },
      };
      await client.query(
        `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, image_url, metadata, community_id, alias, created_at, updated_at)
         VALUES ($1, 'person', $2, $3, $4, $5, $6, NULL, $7::jsonb, $8, 'Founder', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET type = 'person', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
           location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata,
           community_id = EXCLUDED.community_id, alias = EXCLUDED.alias, updated_at = NOW()`,
        [p.id, p.name, subtitle, p.location ?? null, p.website ?? null, ['Founder', 'Blackbird Portfolio'], JSON.stringify(metadata), COMM],
      );
    }
    console.log(`  ✓ ${persons.length} founders`);

    // 5. founded links. Schema-aware: the links table gained provenance/dedup
    // columns (origin, pair_key + the link_identity unique index — see
    // docs/link-management-design.md). pair_key is NOT NULL with no DB default,
    // so on the new schema we must compute it (LEAST|GREATEST of the endpoints,
    // identical to the migration + lib/graph upsertLink) and dedup via ON
    // CONFLICT. On an older prod schema that hasn't had the provenance push yet,
    // fall back to the legacy insert so this works either way (run-now vs
    // run-after-deploy).
    console.log('\n--- Inserting founded links ---');
    const hasPairKey =
      (await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'links' AND column_name = 'pair_key' LIMIT 1`,
      )).rowCount > 0;
    console.log(`  (links schema: ${hasPairKey ? 'provenance/pair_key present' : 'legacy — no pair_key'})`);
    let linkCount = 0;
    if (hasPairKey) {
      for (const l of links) {
        const r = await client.query(
          `INSERT INTO links (source_id, target_id, relationship, since, community_id, metadata, origin, pair_key, created_at, updated_at)
           VALUES ($1, $2, 'founded', $3, $4, '{}'::jsonb, 'import', LEAST($1, $2) || '|' || GREATEST($1, $2), NOW(), NOW())
           ON CONFLICT (community_id, pair_key, relationship) DO NOTHING`,
          [l.sourceId, l.targetId, l.since, COMM],
        );
        linkCount += r.rowCount;
      }
    } else {
      for (const l of links) {
        const dup = await client.query(
          'SELECT 1 FROM links WHERE source_id = $1 AND target_id = $2 AND relationship = $3',
          [l.sourceId, l.targetId, 'founded'],
        );
        if (dup.rowCount > 0) continue;
        await client.query(
          `INSERT INTO links (source_id, target_id, relationship, since, community_id, metadata, created_at)
           VALUES ($1, $2, 'founded', $3, $4, '{}'::jsonb, NOW())`,
          [l.sourceId, l.targetId, l.since, COMM],
        );
        linkCount++;
      }
    }
    console.log(`  ✓ ${linkCount} new founded links (${links.length} total)`);

    // 6. CRM column values (organization nodes)
    console.log('\n--- Inserting CRM column values ---');
    let valueCount = 0;
    for (const o of orgs) {
      for (const col of COLUMNS) {
        const v = o.columnValues[col.key];
        if (v === null || v === undefined || v === '') continue;
        await client.query(
          `INSERT INTO community_column_values (community_id, node_id, column_key, column_id, value, contributed_by_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, NOW())
           ON CONFLICT (community_id, node_id, column_key) DO UPDATE SET value = EXCLUDED.value,
             column_id = EXCLUDED.column_id, updated_at = NOW()`,
          [COMM, o.id, col.key, columnIdByKey.get(col.key), String(v)],
        );
        valueCount++;
      }
    }
    console.log(`  ✓ ${valueCount} column values`);

    await client.query(
      `UPDATE communities SET member_count = (SELECT COUNT(*) FROM user_communities WHERE community_id = $1) WHERE id = $1`,
      [COMM],
    );

    await client.query('COMMIT');
    console.log('\n=== Committed ===');

    console.log('\n--- Node type breakdown ---');
    console.table((await client.query(
      'SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type', [COMM],
    )).rows);

    console.log('\n--- Link breakdown ---');
    console.table((await client.query(
      'SELECT relationship, COUNT(*)::int AS count FROM links WHERE community_id = $1 GROUP BY 1', [COMM],
    )).rows);
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
