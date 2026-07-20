// Seeds the "Local Dev Community" (community:local-dev) notes brains with a
// small, interlinked knowledge base so the Context page has real data to play
// with in local dev.
//
// Builds two brains in the community_notes table:
//   • the SHARED community brain (owner_key = 'shared') — a mini startup
//     knowledge base: companies, people, meetings and playbooks, cross-linked
//     with absolute `/path.md` links so the graph/backlinks/search light up.
//   • a PERSONAL brain for the dev admin (owner_key = user_dev_admin) — a few
//     working notes (journal, todos, watchlist).
//
//   pnpm db:dev:notes            (after pnpm db:seed / db:fresh)
//   pnpm db:dev:notes -- --reset (clean rebuild of the live seeded notes)
//
// Requires the community + users from prisma/seed.ts to already exist.
// Local-only — same env resolution + refusal the destructive db:* scripts use.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-local-dev-notes: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:local-dev';
const SHARED = 'shared';
const ADMIN = 'user_dev_admin';
const RESET = process.argv.includes('--reset');

const fm = (title, tags = []) =>
  `---\ntype: Note\ntitle: ${title}\ntags: [${tags.join(', ')}]\n---\n\n`;

// ---- shared brain -----------------------------------------------------------

const shared = [
  {
    path: 'welcome.md',
    pinned: true,
    content:
      fm('Welcome to the Local Dev brain', ['start-here']) +
      `This is the shared brain of the **Local Dev Community** — seeded content for local development.

Start with:

- [Companies index](/companies/index.md) — the portfolio we track
- [People index](/people/index.md) — founders and operators
- [Fundraising playbook](/playbooks/fundraising.md)
- [Weekly sync notes](/meetings/2026-07-06-weekly-sync.md)

Everything is cross-linked, so the graph view should light up. #welcome
`,
  },
  {
    path: 'companies/index.md',
    pinned: false,
    content:
      fm('Companies', ['index']) +
      `The companies we track locally:

- [Kea Robotics](/companies/kea-robotics.md) — warehouse automation, Series A
- [Fernwave](/companies/fernwave.md) — coastal climate sensing, Seed
- [Mokoflow](/companies/mokoflow.md) — dev-tools, pre-seed

See also the [fundraising playbook](/playbooks/fundraising.md). #companies
`,
  },
  {
    path: 'companies/kea-robotics.md',
    pinned: false,
    content:
      fm('Kea Robotics', ['robotics', 'series-a']) +
      `Warehouse automation out of Auckland. Founded 2023 by [Aroha Ngata](/people/aroha-ngata.md).

## Snapshot

- **Stage:** Series A (raised NZ$12m, 2025)
- **Team:** 28 FTE, hiring controls engineers
- **Traction:** 4 enterprise deployments, NZ + AU

## Notes

Strong pull from 3PL operators. Main risk is hardware margin — discussed in the
[2026-07-06 weekly sync](/meetings/2026-07-06-weekly-sync.md). #robotics
`,
  },
  {
    path: 'companies/fernwave.md',
    pinned: false,
    content:
      fm('Fernwave', ['climate', 'seed']) +
      `Coastal climate-sensing buoys + data platform. Founded by [Tom Selwyn](/people/tom-selwyn.md).

## Snapshot

- **Stage:** Seed (NZ$2.5m, 2026)
- **Customers:** regional councils, aquaculture
- **Ask:** intros to AU port operators

Follows the wedge strategy in the [go-to-market playbook](/playbooks/go-to-market.md). #climate
`,
  },
  {
    path: 'companies/mokoflow.md',
    pinned: false,
    content:
      fm('Mokoflow', ['devtools', 'pre-seed']) +
      `CI-pipeline observability for monorepos. Solo founder [Priya Sharma](/people/priya-sharma.md),
currently raising a pre-seed.

Open questions from diligence:

- [ ] Wedge vs. incumbents (Buildkite analytics?)
- [ ] Pricing — per-seat or per-pipeline?

Raise strategy discussed in the [fundraising playbook](/playbooks/fundraising.md). #devtools
`,
  },
  {
    path: 'people/index.md',
    pinned: false,
    content:
      fm('People', ['index']) +
      `Founders and operators in the network:

- [Aroha Ngata](/people/aroha-ngata.md) — CEO, [Kea Robotics](/companies/kea-robotics.md)
- [Tom Selwyn](/people/tom-selwyn.md) — CEO, [Fernwave](/companies/fernwave.md)
- [Priya Sharma](/people/priya-sharma.md) — founder, [Mokoflow](/companies/mokoflow.md)
`,
  },
  {
    path: 'people/aroha-ngata.md',
    pinned: false,
    content:
      fm('Aroha Ngata', ['founder']) +
      `CEO and co-founder of [Kea Robotics](/companies/kea-robotics.md). Ex-Rocket Lab
manufacturing lead. Exceptional at hardware ops; hiring a VP Sales in Q3.

Last spoke at the [weekly sync](/meetings/2026-07-06-weekly-sync.md). #founder
`,
  },
  {
    path: 'people/tom-selwyn.md',
    pinned: false,
    content:
      fm('Tom Selwyn', ['founder']) +
      `CEO of [Fernwave](/companies/fernwave.md). Oceanographer turned founder (PhD, Otago).
Wants intros to AU port operators — see the ask in the company note. #founder
`,
  },
  {
    path: 'people/priya-sharma.md',
    pinned: false,
    content:
      fm('Priya Sharma', ['founder']) +
      `Solo founder of [Mokoflow](/companies/mokoflow.md). Previously staff engineer at Xero,
deep monorepo/CI experience. Raising pre-seed — notes in the
[fundraising playbook](/playbooks/fundraising.md). #founder
`,
  },
  {
    path: 'meetings/2026-07-06-weekly-sync.md',
    pinned: false,
    content:
      fm('Weekly sync — 6 Jul 2026', ['meeting']) +
      `## Agenda

1. [Kea Robotics](/companies/kea-robotics.md) — hardware margin review
2. [Fernwave](/companies/fernwave.md) — AU port intros
3. [Mokoflow](/companies/mokoflow.md) — pre-seed diligence

## Actions

- [ ] Margin model for Kea by Friday
- [ ] Intro [Tom Selwyn](/people/tom-selwyn.md) to Ports of Auckland contact
- [x] Send [Priya Sharma](/people/priya-sharma.md) the diligence checklist

#meeting
`,
  },
  {
    path: 'playbooks/fundraising.md',
    pinned: false,
    content:
      fm('Fundraising playbook', ['playbook']) +
      `How we run a raise, end to end.

1. **Narrative first** — one-pager before deck.
2. **Tiered target list** — 20 funds, 3 tiers, warm paths only.
3. **Momentum window** — all first meetings inside 2 weeks.

Applied currently to [Mokoflow](/companies/mokoflow.md)'s pre-seed.
Related: [go-to-market playbook](/playbooks/go-to-market.md). #playbook
`,
  },
  {
    path: 'playbooks/go-to-market.md',
    pinned: false,
    content:
      fm('Go-to-market playbook', ['playbook']) +
      `Wedge → land → expand.

- Pick a niche the incumbents ignore ([Fernwave](/companies/fernwave.md): aquaculture councils).
- Land with a painkiller, not a platform.
- Expand only after 3 referenceable customers.

Related: [fundraising playbook](/playbooks/fundraising.md). #playbook
`,
  },
];

// ---- personal brain (dev admin) ----------------------------------------------

const personal = [
  {
    path: 'journal.md',
    pinned: true,
    content:
      fm('Journal', ['journal']) +
      `## 7 Jul 2026

Reviewed [Mokoflow](/companies/mokoflow.md) metrics — pipeline growth is real.

## 6 Jul 2026

Weekly sync ran long; margin questions on [Kea Robotics](/companies/kea-robotics.md). #journal
`,
  },
  {
    path: 'todos.md',
    pinned: false,
    content:
      fm('Todos', ['todo']) +
      `- [ ] Draft Kea margin model
- [ ] Chase AU port intro for [Tom Selwyn](/people/tom-selwyn.md)
- [x] Update the [fundraising playbook](/playbooks/fundraising.md) with 2026 fund list
`,
  },
  {
    path: 'watchlist.md',
    pinned: false,
    content:
      fm('Watchlist', ['watchlist']) +
      `Companies I'm watching personally (not yet in the shared brain):

- **Glowworm Bio** — synbio, too early
- **Southerly** — freight marketplace, waiting on Q3 numbers

Compare against [the shared companies index](/companies/index.md).
`,
  },
];

// ---- write -------------------------------------------------------------------

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const comm = await client.query('SELECT id FROM communities WHERE id = $1', [COMM]);
  if (comm.rowCount === 0) throw new Error(`community ${COMM} not found — run \`pnpm db:seed\` first`);
  const admin = await client.query('SELECT id FROM "user" WHERE id = $1', [ADMIN]);
  if (admin.rowCount === 0) throw new Error(`user ${ADMIN} not found — run \`pnpm db:seed\` first`);

  if (RESET) {
    const del = await client.query(
      `DELETE FROM community_notes
        WHERE community_id = $1 AND owner_key = ANY($2) AND deleted_at IS NULL`,
      [COMM, [SHARED, ADMIN]],
    );
    console.log(`add-local-dev-notes: --reset removed ${del.rowCount} live note(s) (trash preserved)`);
  }

  const brains = [
    { ownerKey: SHARED, notes: shared },
    { ownerKey: ADMIN, notes: personal },
  ];

  // The starred column is derived from the frontmatter `starred:` flag on every
  // app write, so seed starred notes with the flag in the frontmatter too.
  const withStar = (content, starred) =>
    starred ? content.replace(/^---\n/, '---\nstarred: true\n') : content;

  for (const { ownerKey, notes } of brains) {
    for (const n of notes) {
      await client.query(
        `INSERT INTO community_notes (community_id, owner_key, path, content, created_by, starred, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (community_id, owner_key, path)
         DO UPDATE SET content = EXCLUDED.content, starred = EXCLUDED.starred, updated_at = now()`,
        [COMM, ownerKey, n.path, withStar(n.content, n.pinned ?? false), ADMIN, n.pinned ?? false],
      );
    }
  }

  await client.query('COMMIT');
  console.log('=== Committed ===');
  console.log(`  shared brain:   ${shared.length} notes (owner_key=${SHARED})`);
  console.log(`  personal brain: ${personal.length} notes (owner_key=${ADMIN})`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
