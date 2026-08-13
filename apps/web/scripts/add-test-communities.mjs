// Adds 8 extra "test" communities and joins the two dev anchor users
// (user_dev_admin, user_dev_member) to each, so the community-selector
// dropdown has enough rows to exercise the scroll (cap is 4 visible).
//
// Idempotent: re-running upserts the communities and skips memberships
// that already exist. Local-only — same env resolution + refusal the
// destructive db:* scripts use (guard-local-db.mjs).
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-test-communities: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

// The seeded /dev/login users (see prisma/seed.ts). Membership carries no role;
// `owner` marks who also gets the Owner alias here, which is what makes someone
// an admin (lib/auth.ts#isAdmin).
const OWNER_ALIAS_NAME = 'Owner';
const ANCHORS = [
  { id: 'user_dev_admin', owner: true },
  { id: 'user_dev_member', owner: false },
];

const COMMUNITIES = [
  { id: 'community:test-techstars', name: 'Techstars',            description: 'Global startup accelerator network backing founders from idea to IPO.',                location: 'Boulder, USA',        tags: ['Accelerator', 'Global'],          country: 'US' },
  { id: 'community:test-yc',        name: 'Y Combinator',         description: 'Seed accelerator behind Airbnb, Stripe, and thousands of startups.',                  location: 'San Francisco, USA',  tags: ['Accelerator', 'Seed'],            country: 'US' },
  { id: 'community:test-sequoia',   name: 'Sequoia Capital',      description: 'Venture firm partnering with founders from seed to growth across decades.',           location: 'Menlo Park, USA',     tags: ['VC', 'Growth'],                   country: 'US' },
  { id: 'community:test-a16z',      name: 'Andreessen Horowitz',  description: 'Multi-stage venture firm investing across software, crypto, bio, and consumer.',       location: 'Menlo Park, USA',     tags: ['VC', 'Multi-stage'],              country: 'US' },
  { id: 'community:test-antler',    name: 'Antler',               description: 'Early-stage VC and company builder operating across six continents.',                 location: 'Singapore',           tags: ['VC', 'Company Builder'],          country: 'SG' },
  { id: 'community:test-500',       name: '500 Global',           description: 'Early-stage venture fund and accelerator with a global founder community.',            location: 'San Francisco, USA',  tags: ['VC', 'Accelerator'],              country: 'US' },
  { id: 'community:test-eqt',       name: 'EQT Ventures',         description: 'European multi-stage VC backing the most ambitious founders in tech.',                 location: 'Stockholm, Sweden',   tags: ['VC', 'Europe'],                   country: 'SE' },
  { id: 'community:test-accel',     name: 'Accel',                description: 'Global venture firm partnering with exceptional teams from inception onward.',         location: 'Palo Alto, USA',      tags: ['VC', 'Global'],                   country: 'US' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  console.log(`--- Upserting ${COMMUNITIES.length} test communities + joining ${ANCHORS.length} anchor users ---`);
  for (const c of COMMUNITIES) {
    await client.query(
      `
      INSERT INTO communities (id, name, description, location, tags, country, visibility, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'public', NOW())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        location = EXCLUDED.location, tags = EXCLUDED.tags, country = EXCLUDED.country
      `,
      [c.id, c.name, c.description, c.location, c.tags, c.country],
    );

    for (const a of ANCHORS) {
      await client.query(
        `
        INSERT INTO user_communities (user_id, community_id, status, joined_at)
        VALUES ($1, $2, 'active', NOW())
        ON CONFLICT (user_id, community_id) DO NOTHING
        `,
        [a.id, c.id],
      );
      if (a.owner) {
        // The schema default for community_aliases already carries the built-in
        // Owner alias, so holding it here is enough to manage the community.
        await client.query(
          `
          INSERT INTO user_aliases (community_id, user_id, alias_name, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (community_id, user_id, alias_name) DO NOTHING
          `,
          [c.id, a.id, OWNER_ALIAS_NAME],
        );
      }
    }
    console.log(`  ✓ ${c.name}`);
  }

  await client.query('COMMIT');

  const total = await client.query(
    `SELECT COUNT(*)::int AS n FROM user_communities WHERE user_id = 'user_dev_admin'`,
  );
  console.log(`\nDone. Dev Admin is now in ${total.rows[0].n} communities.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
