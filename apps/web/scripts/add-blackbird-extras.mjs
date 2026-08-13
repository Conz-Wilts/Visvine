// Fills the Blackbird Ventures community with the surfaces the portfolio and
// notes layers don't cover, so every tool in the app has something in it:
// events (+ attendees, hosting/attended links, a registration form), the
// resource file library, channel spaces + channels + messages + a DM, and the
// community feed. Also adds a standalone Resource node so that node type shows
// up in the directory alongside the companies and founders.
//
//   node apps/web/scripts/add-blackbird-extras.mjs
//   (or as part of `pnpm db:blackbird:full`)
//
// Runs after prisma/seed.ts (which creates the community, the four @local.dev
// anchors and the aliases) and after add-blackbird-ventures.mjs (the portfolio).
//
// Additive & idempotent: explicit ids + ON CONFLICT upserts, or
// delete-by-seed-marker where rows have generated ids. Never touches another
// community. Loads apps/web/.env (cwd-independent, via the guard) and refuses
// to run against any non-local host.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-blackbird-extras: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:blackbird-ventures';
const TZ = 'Australia/Sydney';

// The anchors from prisma/seed.ts. ADMIN holds Owner + Partner.
const ADMIN = 'user_dev_admin';
const PARTNER = 'user_dev_partner';
const MEMBER = 'user_dev_member';
const LP = 'user_dev_lp';
const ANCHORS = [ADMIN, PARTNER, MEMBER, LP];

const NODE_ADMIN = 'person:dev_admin';
const NODE_PARTNER = 'person:dev_partner';
const NODE_MEMBER = 'person:dev_member';
const NODE_LP = 'person:dev_lp';

// ---- utilities ---------------------------------------------------------------

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
const daysAgo = (d) => hoursAgo(d * 24);
/** ISO timestamp `d` days from now at `hh:mm` Sydney time. */
function inDays(d, hh, mm = 0) {
  const t = new Date(Date.now() + d * 24 * 3600_000);
  const yyyy = t.getFullYear();
  const mo = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+10:00`;
}

async function upsertNode(client, { id, type, name, subtitle = null, location = null, url = null, tags = [], metadata = {}, alias = null, createdDaysAgo = 60 }) {
  await client.query(
    `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, alias, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
       location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags,
       metadata = EXCLUDED.metadata, community_id = EXCLUDED.community_id, alias = EXCLUDED.alias, updated_at = NOW()`,
    [id, type, name, subtitle, location, url, tags, JSON.stringify(metadata), COMM, alias, daysAgo(createdDaysAgo)],
  );
}

async function upsertLinkRow(client, { sourceId, targetId, relationship, origin, originRef = null, since = null, metadata = {} }) {
  await client.query(
    `INSERT INTO links (source_id, target_id, relationship, since, metadata, community_id, origin, origin_ref, pair_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (community_id, pair_key, relationship) DO UPDATE SET
       metadata = EXCLUDED.metadata, origin = EXCLUDED.origin, origin_ref = EXCLUDED.origin_ref, updated_at = NOW()`,
    [sourceId, targetId, relationship, since, JSON.stringify(metadata), COMM, origin, originRef, pairKey(sourceId, targetId)],
  );
}

// ---- events ------------------------------------------------------------------

const demoDayForm = {
  enabled: true,
  slug: 'blackbird-demo-day',
  requireApproval: true,
  schema: [
    { id: 'company', label: 'Company', type: 'company', required: true, placeholder: 'Which company are you here for?' },
    { id: 'relationship', label: 'How are you connected to Blackbird?', type: 'select', required: true, options: ['Portfolio founder', 'LP', 'Co-investor', 'Prospective founder', 'Blackbird team'] },
    { id: 'pitching', label: "I'd like a 5-minute pitch slot", type: 'checkbox' },
    { id: 'dietary', label: 'Dietary requirements', type: 'text', placeholder: 'Vegetarian, GF, …' },
  ],
};

const EVENTS = [
  {
    slug: 'q3-lp-update', name: 'Q3 LP Update', hosts: [NODE_ADMIN],
    start: inDays(-21, 16), end: inDays(-21, 17, 30),
    location: { label: 'Blackbird — Sydney', address: '5 Martin Pl, Sydney NSW', lat: -33.8679, lon: 151.2093 },
    visibility: 'community', status: 'published', capacity: 60, views: 233,
    description: 'Quarterly update for limited partners: fund marks, new positions, and the reserves plan for the next two quarters.',
  },
  {
    slug: 'portfolio-founder-dinner', name: 'Portfolio Founder Dinner', hosts: [NODE_ADMIN, NODE_PARTNER],
    start: inDays(9, 18, 30), end: inDays(9, 22),
    location: { label: 'Bentley Restaurant + Bar', address: '27 O’Connell St, Sydney NSW', lat: -33.8641, lon: 151.2093 },
    visibility: 'community', status: 'published', capacity: 40, views: 187, allowPlusOnes: 1,
    description: 'Twice-yearly dinner for portfolio founders. No panels, no decks — just the people building, in one room.',
  },
  {
    slug: 'blackbird-demo-day', name: 'Blackbird Demo Day', hosts: [NODE_ADMIN, NODE_PARTNER],
    start: inDays(31, 15), end: inDays(31, 20),
    location: { label: 'Carriageworks', address: '245 Wilson St, Eveleigh NSW', lat: -33.8974, lon: 151.1949 },
    visibility: 'public', status: 'published', capacity: 250, views: 1204,
    waitlistEnabled: true, allowPlusOnes: 1, guestListVisible: true, form: demoDayForm,
    description: 'The portfolio on stage: ten companies, five minutes each, in front of LPs, co-investors and the wider ANZ ecosystem.',
  },
  {
    slug: 'nz-founder-office-hours', name: 'NZ Founder Office Hours (planning)', hosts: [NODE_PARTNER],
    start: inDays(52, 10), end: inDays(52, 13),
    location: { label: 'TBC — Auckland' },
    visibility: 'community', status: 'draft', capacity: 12, views: 6,
    description: 'Draft: a day of 20-minute slots for New Zealand founders, pre-seed and seed. Venue and date being locked in.',
  },
];

// eventSlug → attendees. Anchors reference their person nodes; guests are
// loginless (name/email only). Real portfolio founders are mixed in at runtime.
const ATTENDEES = {
  'q3-lp-update': [
    { n: 1, person: NODE_LP, email: 'lp@local.dev', status: 'checked_in', response: 'going' },
    { n: 2, person: NODE_PARTNER, email: 'partner@local.dev', status: 'checked_in', response: 'going' },
    { n: 3, name: 'Sandra Yeo', email: 'sandra.yeo@superfund.example.com', status: 'checked_in', response: 'going', company: 'Meridian Super', role: 'Investment Director' },
    { n: 4, name: 'Peter Hale', email: 'peter.hale@familyoffice.example.com', status: 'no_show', response: 'going', company: 'Hale Family Office' },
  ],
  'portfolio-founder-dinner': [
    { n: 1, person: NODE_MEMBER, email: 'member@local.dev', status: 'going', response: 'going' },
    { n: 2, person: NODE_ADMIN, email: 'admin@local.dev', status: 'going', response: 'going' },
    { n: 3, name: 'Nadia Rahman', email: 'nadia@example.com', status: 'going', response: 'going', company: 'Stealth', role: 'Founder', plusOnes: 1, plusOneNames: ['Sam Rahman'] },
    { n: 4, name: 'Tobias Green', email: 'tobias.green@example.com', status: 'waitlisted', response: 'going' },
  ],
  'blackbird-demo-day': [
    { n: 1, person: NODE_MEMBER, email: 'member@local.dev', status: 'going', response: 'going', answers: { company: 'Loopwork', relationship: 'Portfolio founder', pitching: true, dietary: '' } },
    { n: 2, person: NODE_LP, email: 'lp@local.dev', status: 'going', response: 'going', answers: { company: 'Meridian Super', relationship: 'LP', pitching: false, dietary: 'Vegetarian' } },
    { n: 3, person: NODE_PARTNER, email: 'partner@local.dev', status: 'going', response: 'going', answers: { company: 'Blackbird', relationship: 'Blackbird team', pitching: false, dietary: '' } },
    { n: 4, name: 'Priya Raman', email: 'priya.raman@example.com', status: 'pending', response: 'going', company: 'Northbound Capital', role: 'Principal', answers: { company: 'Northbound Capital', relationship: 'Co-investor', pitching: false, dietary: 'GF' } },
    { n: 5, name: 'Marcus Webb', email: 'marcus.webb@example.com', status: 'waitlisted', response: 'going', answers: { company: '—', relationship: 'Prospective founder', pitching: false, dietary: '' } },
    { n: 6, name: 'Elena Costa', email: 'elena.costa@example.com', status: 'invited', company: 'The Australian Financial Review', role: 'Reporter' },
  ],
};

// ---- resource library --------------------------------------------------------
// public/uploads/ is gitignored, so the files are written at seed time. fileUrl
// uses the legacy /uploads/... form the resource routes already tolerate.

const FILE_RESOURCES = [
  {
    file: 'fund-roll-up.csv', name: 'Fund roll-up (Q3)', fileType: 'csv', uploadedBy: ADMIN, daysAgo: 18,
    body: [
      'fund,vintage,committed_aud_m,called_pct,tvpi,dpi,net_irr_pct',
      'Blackbird Ventures I,2013,30,100,11.4,3.2,44.1',
      'Blackbird Ventures II,2015,75,100,6.8,1.1,38.7',
      'Blackbird Ventures III,2018,225,96,3.1,0.4,29.3',
      'Blackbird Ventures IV,2020,500,74,1.9,0.1,21.6',
      'Blackbird Ventures V,2022,1000,41,1.3,0.0,14.2',
      'Blackbird Follow-On I,2021,300,68,1.6,0.0,17.8',
    ].join('\n'),
  },
  {
    file: 'portfolio-review.csv', name: 'Portfolio review template', fileType: 'csv', uploadedBy: PARTNER, daysAgo: 11,
    body: [
      'company,sector,stage,last_round_date,ownership_pct,mark,runway_months,owner,flag',
      'Canva,SaaS & Enterprise,Growth,2024-05-01,2.1,hold,60+,Partner,',
      'Halter,Agtech & Food,Series D+,2024-09-12,6.4,mark up,34,Partner,',
      'Zeller,Fintech,Series C,2023-11-02,4.8,hold,22,Partner,watch',
      'Baraja,Deep Tech & Hardware,Series C,2022-07-19,5.1,mark down,11,Partner,watch',
    ].join('\n'),
  },
  {
    file: 'ic-memo-template.md', name: 'IC memo template', fileType: 'md', uploadedBy: ADMIN, daysAgo: 40,
    body: [
      '# Investment Committee memo',
      '',
      '## The one-liner',
      '_What does this company do, in a sentence a stranger would understand?_',
      '',
      '## Why now',
      '_What has changed in the world that makes this possible today and not three years ago?_',
      '',
      '## The team',
      '_Founder-market fit. What have they done that others could not?_',
      '',
      '## The wedge and the mountain',
      '_What is the beachhead, and what is the thing that gets very large if it works?_',
      '',
      '## Terms',
      '| Field | Value |',
      '| --- | --- |',
      '| Round | |',
      '| Pre-money | |',
      '| Our cheque | |',
      '| Ownership | |',
      '| Board | |',
      '',
      '## What would have to be true',
      '_The three assumptions this investment rests on, and how we would know early if one is wrong._',
      '',
      '## Risks we are knowingly taking',
      '',
      '## Recommendation',
    ].join('\n'),
  },
];

// A standalone Resource node so the Resource type appears in the directory.
const RESOURCE_NODE = {
  id: 'resource:blackbird-founder-playbook',
  name: 'Blackbird Founder Playbook',
  subtitle: 'Fundraising, hiring & scaling guides for portfolio companies',
  url: 'https://blackbird.vc/playbook',
  tags: ['Guide', 'Fundraising', 'Playbook'],
};

// ---- channels / posts / DM ---------------------------------------------------

const SPACES = [
  { id: 'space_bb_firm', name: 'Firm', emoji: '🐦', position: 0 },
  { id: 'space_bb_portfolio', name: 'Portfolio', emoji: '📈', position: 1 },
];

const CHANNELS = [
  { id: 'chan_bb_general', name: 'general', icon: '👋', space: 'space_bb_firm', description: 'Everything that does not have a better home.' },
  { id: 'chan_bb_dealflow', name: 'deal-flow', icon: '🔎', space: 'space_bb_firm', description: 'Inbound, intros and what we are looking at this week.' },
  { id: 'chan_bb_portfolio', name: 'portfolio-news', icon: '📣', space: 'space_bb_portfolio', description: 'Raises, launches, hires and press from the portfolio.' },
  { id: 'chan_bb_lp', name: 'lp-updates', icon: '📊', space: 'space_bb_portfolio', description: 'Reporting cycles, marks and LP correspondence.' },
];

// hoursAgo counts back from now; keeps ordering stable across runs.
const MESSAGES = [
  { id: 'msg_bb_001', chan: 'chan_bb_general', from: ADMIN, hoursAgo: 500, text: 'Morning all — Q3 close is the 30th. Marks need to be in the roll-up by the 24th, no exceptions this time 🙏', pinned: true, reactions: [{ from: PARTNER, emoji: '👍' }, { from: LP, emoji: '👀' }] },
  { id: 'msg_bb_002', chan: 'chan_bb_general', from: PARTNER, hoursAgo: 470, text: 'Flying to Auckland Thursday for two days of founder meetings. If anyone wants me to drop in on a company while I am there, shout.' },
  { id: 'msg_bb_003', chan: 'chan_bb_general', from: MEMBER, hoursAgo: 300, text: 'Is the IC memo template in the resource library the current one? The version I have has a different terms table.' },
  { id: 'msg_bb_004', chan: 'chan_bb_general', from: ADMIN, hoursAgo: 298, text: 'The library one is current — I updated it last month. Yours is probably the 2024 copy.', replyTo: 'msg_bb_003', reactions: [{ from: MEMBER, emoji: '🙏' }] },
  { id: 'msg_bb_010', chan: 'chan_bb_dealflow', from: PARTNER, hoursAgo: 420, text: 'Seeing a real cluster of ANZ climate-hardware companies raising this quarter. Four in the last fortnight, all with credible engineering teams. Something has shifted in the talent pool.', reactions: [{ from: ADMIN, emoji: '👀' }] },
  { id: 'msg_bb_011', chan: 'chan_bb_dealflow', from: ADMIN, hoursAgo: 418, text: 'Agreed. My read is it is the ex-Tritium and ex-Redflow people finally coming free.', replyTo: 'msg_bb_010' },
  { id: 'msg_bb_012', chan: 'chan_bb_dealflow', from: PARTNER, hoursAgo: 200, text: 'Reminder that anything with a term sheet needs the memo circulated 48h before IC, not the morning of. Looking at nobody in particular.', reactions: [{ from: ADMIN, emoji: '😅' }] },
  { id: 'msg_bb_013', chan: 'chan_bb_dealflow', from: MEMBER, hoursAgo: 60, text: 'Intro request came in via the invite link — founder out of Christchurch doing marine sensing. Deck is genuinely good. Putting it in the pipeline note.' },
  { id: 'msg_bb_020', chan: 'chan_bb_portfolio', from: ADMIN, hoursAgo: 360, text: '🎉 Halter closed their Series D. Congratulations to the whole team — eight years from a paddock in Waikato to this.', pinned: true, reactions: [{ from: PARTNER, emoji: '🎉' }, { from: MEMBER, emoji: '🐄' }, { from: LP, emoji: '👏' }] },
  { id: 'msg_bb_021', chan: 'chan_bb_portfolio', from: PARTNER, hoursAgo: 240, text: 'Canva shipped their enterprise suite. Worth reading the launch post even if you do not care about design tools — the go-to-market is the interesting part.' },
  { id: 'msg_bb_022', chan: 'chan_bb_portfolio', from: MEMBER, hoursAgo: 80, text: 'Zeller hit a milestone worth noting internally: more merchants added last quarter than in all of 2024.', reactions: [{ from: ADMIN, emoji: '📈' }] },
  { id: 'msg_bb_030', chan: 'chan_bb_lp', from: ADMIN, hoursAgo: 340, text: 'Q3 LP update deck is drafted. Partners — please read the marks section before Friday, that is the bit that generates questions.', reactions: [{ from: PARTNER, emoji: '✅' }] },
  { id: 'msg_bb_031', chan: 'chan_bb_lp', from: LP, hoursAgo: 150, text: 'Question from our side: are the Fund IV reserves still assuming a 2026 deployment schedule, or has that moved out?' },
  { id: 'msg_bb_032', chan: 'chan_bb_lp', from: ADMIN, hoursAgo: 148, text: 'Moved out by roughly two quarters — the detail is in the reserves section of the roll-up. Happy to walk through it on a call.', replyTo: 'msg_bb_031', reactions: [{ from: LP, emoji: '🙏' }] },
];

const POSTS = [
  { id: 'post_bb_1', from: ADMIN, hoursAgo: 330, content: 'Demo Day is locked in: Carriageworks, ten companies, five minutes each. Applications for pitch slots are open on the event page and close in three weeks. If you are on the fence — the five minutes are terrifying and worth it.', reactions: [{ from: PARTNER, emoji: '🚀' }, { from: MEMBER, emoji: '🔥' }], comments: [{ id: 'pc_bb_1a', from: MEMBER, text: 'Applied 😅' }] },
  { id: 'post_bb_2', from: PARTNER, hoursAgo: 210, content: 'A pattern from the last twenty first meetings: the founders who describe their customer better than they describe their product are, almost without exception, the ones still going in year three.', reactions: [{ from: ADMIN, emoji: '💡' }, { from: LP, emoji: '👏' }], comments: [{ id: 'pc_bb_2a', from: ADMIN, text: 'This is going in the memo template.' }, { id: 'pc_bb_2b', from: PARTNER, text: 'Steal freely.', parent: 'pc_bb_2a' }] },
  { id: 'post_bb_3', from: MEMBER, hoursAgo: 120, content: 'Portfolio founders — we have started a shared doc of ANZ-friendly infrastructure vendors that actually answer support tickets. Add yours, it saves the next person a week.', reactions: [{ from: PARTNER, emoji: '🙏' }] },
  { id: 'post_bb_4', from: ADMIN, hoursAgo: 30, content: 'Q3 close is done. Marks are in the roll-up, the LP update goes out Monday. Thank you to everyone who got their numbers in on time, and a pointed thank you to everyone who did not.', reactions: [{ from: PARTNER, emoji: '😂' }, { from: LP, emoji: '✅' }] },
];

const DM_MESSAGES = [
  { id: 'msg_bb_dm1', from: ADMIN, hoursAgo: 130, text: 'Got a minute to look at the Demo Day shortlist before it goes to the wider team?' },
  { id: 'msg_bb_dm2', from: PARTNER, hoursAgo: 129, text: 'Send it through.' },
  { id: 'msg_bb_dm3', from: ADMIN, hoursAgo: 128, text: 'Ten slots, seven obvious. The last three I have as Halter, Zeller and one wildcard from the open applications.' },
  { id: 'msg_bb_dm4', from: PARTNER, hoursAgo: 126, text: 'Halter and Zeller are both well past the stage where a demo day helps them. Give those two slots to companies that need the room.' },
  { id: 'msg_bb_dm5', from: ADMIN, hoursAgo: 125, text: 'Fair. Redoing the bottom half tonight.' },
  { id: 'msg_bb_dm6', from: PARTNER, hoursAgo: 18, text: 'Registrations are past 180 already. We may need the bigger hall 👀' },
];

// ---- write to the DB ---------------------------------------------------------

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const comm = await client.query('SELECT id FROM communities WHERE id = $1', [COMM]);
  if (comm.rowCount === 0) {
    throw new Error(`community "${COMM}" not found — run \`pnpm db:seed\` first`);
  }
  const users = await client.query(`SELECT id FROM users WHERE id = ANY($1)`, [ANCHORS]);
  if (users.rowCount < ANCHORS.length) {
    throw new Error(`add-blackbird-extras: expected the ${ANCHORS.length} seed anchors, found ${users.rowCount} — run \`pnpm db:seed\` first`);
  }

  // A few real portfolio founders to mix into the dinner guest list, so the
  // attendee table isn't only anchors. Absent if the portfolio layer hasn't run.
  const founders = await client.query(
    `SELECT id, name FROM nodes
      WHERE community_id = $1 AND type = 'person' AND alias = 'Founder'
        AND COALESCE(metadata->>'anchor', 'false') <> 'true'
      ORDER BY name LIMIT 4`,
    [COMM],
  );

  // 1. Events + attendees + attended/hosting links
  console.log('--- Events ---');
  let attendeeCount = 0;
  for (const e of EVENTS) {
    const eventId = `event:${e.slug}`;
    const rows = [...(ATTENDEES[e.slug] ?? [])];
    if (e.slug === 'portfolio-founder-dinner') {
      founders.rows.forEach((f, i) => {
        rows.push({
          n: 10 + i,
          person: f.id,
          name: f.name,
          email: `${f.id.replace(/^person:/, '')}@portfolio.example.com`,
          status: i === 3 ? 'cancelled' : 'going',
          response: i === 3 ? 'declined' : 'going',
        });
      });
    }
    const rsvpCount = rows.filter((a) => ['going', 'checked_in'].includes(a.status)).length;
    const checkinCount = rows.filter((a) => a.status === 'checked_in').length;
    const created = new Date(new Date(e.start).getTime() - 30 * 24 * 3600_000);
    const metadata = {
      seeded: true,
      description: e.description,
      start_at: e.start, end_at: e.end, timezone: TZ,
      locationData: e.location,
      hosts: e.hosts, organizerEmail: 'admin@local.dev',
      capacity: e.capacity, visibility: e.visibility, status: e.status, slug: e.slug,
      waitlistEnabled: e.waitlistEnabled ?? false,
      guestListVisible: e.guestListVisible ?? true,
      allowPlusOnes: e.allowPlusOnes ?? 0,
      form: e.form ?? { enabled: false, slug: '', schema: [] },
      analytics: { views: e.views ?? 0, rsvpCount, checkinCount, createdAt: created.toISOString(), updatedAt: new Date().toISOString() },
    };
    // Node.alias is the public /e/<slug> route for an event (lib/eventRepo.ts).
    await upsertNode(client, {
      id: eventId, type: 'event', name: e.name, subtitle: e.description.slice(0, 140),
      location: e.location.label, alias: e.slug, tags: ['event'], metadata,
    });

    for (const a of rows) {
      const attendeeId = `attendee:${e.slug}-${a.n}`;
      await client.query(
        `INSERT INTO attendees (id, event_id, person_id, name, email, company_name, role_title, answers, status, response,
           plus_ones, plus_one_names, created_at, updated_at, checkin_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, NOW(), $14)
         ON CONFLICT (event_id, email) DO UPDATE SET person_id = EXCLUDED.person_id, name = EXCLUDED.name,
           status = EXCLUDED.status, response = EXCLUDED.response, answers = EXCLUDED.answers, updated_at = NOW()`,
        [attendeeId, eventId, a.person ?? null, a.name ?? null, a.email, a.company ?? null, a.role ?? null,
          JSON.stringify(a.answers ?? {}), a.status, a.response ?? null, a.plusOnes ?? 0, a.plusOneNames ?? [],
          new Date(created.getTime() + a.n * 36 * 3600_000),
          a.status === 'checked_in' ? e.start : null],
      );
      attendeeCount++;
      if (a.person && !['cancelled', 'invited'].includes(a.status)) {
        await upsertLinkRow(client, {
          sourceId: a.person, targetId: eventId, relationship: 'attended',
          origin: 'event_attendance', originRef: attendeeId, since: e.start, metadata: { status: a.status },
        });
      }
    }
    for (const hostId of e.hosts) {
      await upsertLinkRow(client, {
        sourceId: hostId, targetId: eventId, relationship: 'hosting',
        origin: 'event_hosting', originRef: eventId, since: created.toISOString(),
      });
    }
  }
  console.log(`  ✓ ${EVENTS.length} events, ${attendeeCount} attendees (+ attended/hosting links)`);

  // 2. Resource node (so the Resource type shows in the directory)
  await upsertNode(client, {
    id: RESOURCE_NODE.id, type: 'resource', name: RESOURCE_NODE.name,
    subtitle: RESOURCE_NODE.subtitle, url: RESOURCE_NODE.url, tags: RESOURCE_NODE.tags,
    metadata: { seeded: true },
  });

  // 3. Resource library. public/uploads is gitignored, so write the files too —
  // otherwise every row in the library 404s on download.
  console.log('\n--- Resource library ---');
  const uploadDir = join(__dirname, '..', 'public', 'uploads', 'seed');
  mkdirSync(uploadDir, { recursive: true });
  await client.query(`DELETE FROM resources WHERE community_id = $1 AND metadata->>'seeded' = 'true'`, [COMM]);
  const resourceIdByFile = new Map();
  for (const r of FILE_RESOURCES) {
    const path = join(uploadDir, r.file);
    writeFileSync(path, r.body, 'utf8');
    const row = await client.query(
      `INSERT INTO resources (community_id, name, file_type, file_url, file_size, uploaded_by, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{"seeded": "true"}'::jsonb, $7) RETURNING id`,
      [COMM, r.name, r.fileType, `/uploads/seed/${r.file}`, Buffer.byteLength(r.body), r.uploadedBy, daysAgo(r.daysAgo)],
    );
    resourceIdByFile.set(r.file, row.rows[0].id);
  }
  await client.query(
    `INSERT INTO resource_comments (resource_id, cell_ref, author, content, created_at)
     VALUES ($1, 'F5', 'Dev Partner', 'Fund IV net IRR looks stale — this is the pre-mark number.', NOW() - interval '4 days'),
            ($1, NULL, 'Dev Admin', 'Good catch, refreshing after Q3 close.', NOW() - interval '3 days')`,
    [resourceIdByFile.get('fund-roll-up.csv')],
  );
  console.log(`  ✓ ${FILE_RESOURCES.length} files + 2 comments`);

  // 4. Channel spaces, channels, messages
  console.log('\n--- Channels & messages ---');
  for (const s of SPACES) {
    await client.query(
      `INSERT INTO channel_spaces (id, community_id, name, emoji, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, position = EXCLUDED.position`,
      [s.id, COMM, s.name, s.emoji, s.position],
    );
  }
  for (const ch of CHANNELS) {
    await client.query(
      `INSERT INTO conversations (id, type, name, description, icon, community_id, space_id, created_by_id, created_at, updated_at)
       VALUES ($1, 'CHANNEL', $2, $3, $4, $5, $6, $7, NOW() - interval '60 days', NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         icon = EXCLUDED.icon, space_id = EXCLUDED.space_id, updated_at = NOW()`,
      [ch.id, ch.name, ch.description, ch.icon, COMM, ch.space, ADMIN],
    );
    for (const uid of ANCHORS) {
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, $3::"ConversationMemberRole", NOW() - interval '60 days')
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [ch.id, uid, uid === ADMIN ? 'ADMIN' : 'MEMBER'],
      );
    }
  }
  for (const m of MESSAGES) {
    await client.query(
      `INSERT INTO messages (id, conversation_id, sender_id, text, reply_to_id, pinned_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, created_at = EXCLUDED.created_at`,
      [m.id, m.chan, m.from, m.text, m.replyTo ?? null, m.pinned ? hoursAgo(m.hoursAgo - 1) : null, hoursAgo(m.hoursAgo)],
    );
    for (const r of m.reactions ?? []) {
      await client.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [m.id, r.from, r.emoji],
      );
    }
  }
  console.log(`  ✓ ${SPACES.length} spaces, ${CHANNELS.length} channels, ${MESSAGES.length} messages`);

  // 5. Feed posts
  for (const p of POSTS) {
    await client.query(
      `INSERT INTO posts (id, community_id, author_id, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, created_at = EXCLUDED.created_at, updated_at = NOW()`,
      [p.id, COMM, p.from, p.content, hoursAgo(p.hoursAgo)],
    );
    for (const r of p.reactions ?? []) {
      await client.query(
        `INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id, emoji) DO NOTHING`,
        [p.id, r.from, r.emoji],
      );
    }
    for (const cm of p.comments ?? []) {
      await client.query(
        `INSERT INTO post_comments (id, post_id, author_id, parent_id, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
        [cm.id, p.id, cm.from, cm.parent ?? null, cm.text, hoursAgo(p.hoursAgo - 2)],
      );
    }
  }
  console.log(`  ✓ ${POSTS.length} feed posts`);

  // 6. Admin ↔ Partner DM
  const dmKey = [ADMIN, PARTNER].sort().join(':');
  const dm = await client.query(
    `INSERT INTO conversations (id, type, dm_key, created_by_id, created_at, updated_at)
     VALUES ('conv_bb_dm_admin_partner', 'DM', $1, $2, NOW() - interval '14 days', NOW())
     ON CONFLICT (dm_key) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [dmKey, ADMIN],
  );
  const dmId = dm.rows[0].id;
  for (const uid of [ADMIN, PARTNER]) {
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, joined_at)
       VALUES ($1, $2, NOW() - interval '14 days') ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [dmId, uid],
    );
  }
  for (const m of DM_MESSAGES) {
    await client.query(
      `INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, created_at = EXCLUDED.created_at`,
      [m.id, dmId, m.from, m.text, hoursAgo(m.hoursAgo)],
    );
  }
  console.log(`  ✓ admin↔partner DM (${DM_MESSAGES.length} messages)`);

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  const summary = await client.query(
    'SELECT type, COUNT(*)::int AS count FROM nodes WHERE community_id = $1 GROUP BY type ORDER BY type',
    [COMM],
  );
  console.table(summary.rows);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
