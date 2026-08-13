// Refreshes the Blackbird Ventures demo events: pushes the existing (now-expired)
// events to future dates and adds a varied set of new events so the events surface
// shows the full range of features — virtual / hybrid / in-person, registration
// forms with every field type, approval-gated RSVPs, waitlists, a draft, and a
// past event for the "Past" tab.
//
// Events are stored as `nodes` rows (type='event') with everything in `metadata`
// (see apps/web/lib/eventRepo.ts). RSVPs live in `attendees` keyed by event_id, so
// shifting an event's dates leaves its existing guests intact.
//
// Same env resolution + local-only guard as the other db scripts. Idempotent.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('refresh-events: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:blackbird-ventures';
const HOST = 'person:dev_admin';
const NOW_ISO = '2026-06-13T00:00:00.000Z';

// ── Date helpers ───────────────────────────────────────────────────────────
// All anchored off 2026-06-13 so the demo set stays "fresh" regardless of when
// the script runs. Times are UTC; NZ (Pacific/Auckland) is UTC+12 in June, so an
// 18:00 NZST start is 06:00Z.
const day = (n) => {
  const base = Date.UTC(2026, 5, 13); // 2026-06-13
  return base + n * 86_400_000;
};
const at = (dayOffset, utcHour, utcMin = 0) =>
  new Date(day(dayOffset) + (utcHour * 60 + utcMin) * 60_000).toISOString();

const analytics = (rsvpCount = 0, checkinCount = 0) => ({
  views: 0, rsvpCount, checkinCount, createdAt: NOW_ISO, updatedAt: NOW_ISO,
});

const form = (slug, schema, { enabled = true, requireApproval = false } = {}) => ({
  slug, schema, enabled, requireApproval,
});

// Venue coordinates. The events list/feed and the page's Type filter classify an
// event as in-person vs virtual by whether location has lat/lon (see
// EventsFeedView.isVirtual and app/(auth)/events/page.tsx) — NOT by eventType. So
// in-person/hybrid events must carry coordinates to render with their venue and
// match the "In-person" filter.
const VENUE = {
  blackbirdHQ: { label: 'Blackbird HQ', address: '11 York St, Sydney NSW 2000', lat: -33.8665, lon: 151.205 },
  gridAKL: { label: 'GridAKL', address: '12 Madden St, Auckland CBD 1010', lat: -36.8443, lon: 174.7544 },
  bizDojo: { label: 'BizDojo Wellington', address: '115 Tory St, Te Aro, Wellington 6011', lat: -41.296, lon: 174.7821 },
  iccSydney: { label: 'ICC Sydney', address: '14 Darling Dr, Sydney NSW 2000', lat: -33.8744, lon: 151.1987 },
};

// ── 1. Shift the three existing events to future dates ───────────────────────
// jsonb_set keeps every other metadata field (forms, attendee-facing config) as-is.
// `location` optionally backfills coordinates so the event reads as in-person.
const SHIFTS = [
  // Summer Rooftop Mixer — simple, no form. → ~2 weeks out, evening.
  { id: 'event:c2178514b1c0', startAt: at(13, 6), endAt: at(13, 9), location: VENUE.blackbirdHQ },
  // Forms & Waitlist Test Night — 3-field form, capacity 2, waitlist on. → ~3 weeks.
  { id: 'event:90279d9912d7', startAt: at(20, 6), endAt: at(20, 8) },
  // Founders Demo Night — plus-ones + waitlist. → ~4 weeks.
  { id: 'event:founders-demo-night-20260613', startAt: at(27, 7), endAt: at(27, 9), location: VENUE.blackbirdHQ },
];

// ── 2. New events, covering the full feature matrix ──────────────────────────
const EVENTS = [
  // Virtual — online AMA, no form, public, free, big-ish cap.
  {
    id: 'event:vv-ai-founders-ama',
    name: 'AI Founders Virtual AMA',
    subtitle: 'Live Q&A with three Blackbird AI founders — bring your hardest questions.',
    location: 'Online (Zoom)',
    metadata: {
      slug: 'ai-founders-ama',
      description: 'A 60-minute open AMA with founders building at the frontier of applied AI. Submit questions live. Recording shared with all registrants afterwards.',
      eventType: 'virtual',
      virtualPlatform: 'Zoom',
      virtualLink: 'https://zoom.us/j/000-ai-founders-ama',
      start_at: at(9, 4), end_at: at(9, 5),
      timezone: 'Pacific/Auckland',
      visibility: 'public',
      status: 'published',
      hosts: [HOST],
      capacity: 500,
      theme: { color: '#6366f1' },
      allowPlusOnes: 0,
      waitlistEnabled: false,
      guestListVisible: false,
      allowedResponses: ['going', 'maybe', 'declined'],
      form_schema: form('ai-founders-ama', [], { enabled: false }),
      analytics: analytics(38),
    },
  },

  // Hybrid — in-person + livestream, light form, plus-ones, public.
  {
    id: 'event:vv-scaleup-hybrid-summit',
    name: 'Scaling Up: Hybrid Growth Summit',
    subtitle: 'Half-day summit on going from seed to Series B — attend in Sydney or online.',
    location: 'Blackbird HQ, Sydney',
    metadata: {
      slug: 'scaleup-hybrid-summit',
      description: 'Operators from the portfolio share growth playbooks across hiring, GTM, and fundraising. Join us at Blackbird HQ or tune into the livestream.',
      eventType: 'hybrid',
      virtualPlatform: 'YouTube Live',
      virtualLink: 'https://youtube.com/live/scaleup-summit',
      start_at: at(16, 23), end_at: at(17, 3), // 11:00–15:00 NZST next day boundary -> daytime AEST
      timezone: 'Australia/Sydney',
      visibility: 'public',
      status: 'published',
      hosts: [HOST],
      capacity: 180,
      theme: { color: '#0ea5e9' },
      allowPlusOnes: 1,
      waitlistEnabled: true,
      guestListVisible: true,
      allowedResponses: ['going', 'maybe', 'declined'],
      locationData: VENUE.blackbirdHQ,
      ticketPrice: 'Free',
      form_schema: form('scaleup-hybrid-summit', [
        { id: 'q_scaleup_attend', type: 'select', label: 'How will you attend?', required: true, options: ['In person (Sydney)', 'Online'] },
        { id: 'q_scaleup_company', type: 'company', label: 'Company', required: false, placeholder: 'Where do you work?' },
      ]),
      analytics: analytics(64),
    },
  },

  // Approval-gated, rich form (every field type), small cap + waitlist.
  {
    id: 'event:vv-investor-office-hours',
    name: 'Investor Office Hours (Application Required)',
    subtitle: 'Book a 1:1 slot with a Blackbird partner — applications reviewed by the team.',
    location: 'GridAKL, Auckland',
    metadata: {
      slug: 'investor-office-hours',
      description: 'Twelve 20-minute slots for pre-seed and seed founders to get direct feedback from a partner. Apply below; we approve attendees based on stage and fit.',
      eventType: 'in-person',
      start_at: at(23, 21), end_at: at(24, 1), // morning AKL
      timezone: 'Pacific/Auckland',
      visibility: 'public',
      status: 'published',
      hosts: [HOST],
      capacity: 12,
      theme: { color: '#f59e0b' },
      allowPlusOnes: 0,
      waitlistEnabled: true,
      guestListVisible: false,
      allowedResponses: ['going', 'declined'],
      locationData: VENUE.gridAKL,
      form_schema: form('investor-office-hours', [
        { id: 'q_ioh_company', type: 'company', label: 'Startup name', required: true },
        { id: 'q_ioh_website', type: 'url', label: 'Website or deck link', required: true, placeholder: 'https://' },
        { id: 'q_ioh_linkedin', type: 'linkedin', label: 'Your LinkedIn', required: false, placeholder: 'https://linkedin.com/in/...' },
        { id: 'q_ioh_stage', type: 'select', label: 'Current stage', required: true, options: ['Idea', 'Pre-seed', 'Seed', 'Series A+'] },
        { id: 'q_ioh_raising', type: 'select', label: 'Are you currently raising?', required: true, options: ['Yes', 'No', 'Soon'] },
        { id: 'q_ioh_ask', type: 'textarea', label: 'What do you most want feedback on?', required: true, placeholder: 'One or two sentences' },
        { id: 'q_ioh_nda', type: 'checkbox', label: 'I understand slots are confirmed only after review', required: true },
      ], { requireApproval: true }),
      analytics: analytics(7),
    },
  },

  // Paid multi-day conference, large cap, public, dietary form.
  {
    id: 'event:vv-anz-saas-conf-2026',
    name: 'ANZ SaaS Conference 2026',
    subtitle: 'Two days of talks, workshops, and networking for SaaS builders across ANZ.',
    location: 'ICC Sydney',
    metadata: {
      slug: 'anz-saas-conf-2026',
      description: 'The flagship gathering for ANZ SaaS founders and operators. Keynotes, hands-on workshops, and a curated hallway track. Tickets include both days and the closing party.',
      eventType: 'in-person',
      start_at: at(44, 22), end_at: at(45, 7),
      timezone: 'Australia/Sydney',
      visibility: 'public',
      status: 'published',
      hosts: [HOST],
      capacity: 600,
      theme: { color: '#ec4899' },
      allowPlusOnes: 0,
      waitlistEnabled: true,
      guestListVisible: true,
      allowedResponses: ['going', 'maybe', 'declined'],
      locationData: VENUE.iccSydney,
      ticketPrice: '$499',
      form_schema: form('anz-saas-conf-2026', [
        { id: 'q_saas_email', type: 'email', label: 'Email for your ticket', required: true },
        { id: 'q_saas_company', type: 'company', label: 'Company', required: false },
        { id: 'q_saas_role', type: 'text', label: 'Job title', required: false, placeholder: 'e.g. Founder, Head of Growth' },
        { id: 'q_saas_diet', type: 'select', label: 'Dietary requirements', required: false, options: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Other'] },
        { id: 'q_saas_party', type: 'checkbox', label: 'I plan to attend the closing party', required: false },
      ]),
      analytics: analytics(212, 0),
    },
  },

  // Small hands-on workshop, capacity 12, waitlist, code-of-conduct checkbox.
  {
    id: 'event:vv-pitch-deck-teardown',
    name: 'Workshop: Pitch Deck Teardown',
    subtitle: 'Bring your deck — we rebuild it live in a small hands-on session.',
    location: 'BizDojo, Wellington',
    metadata: {
      slug: 'pitch-deck-teardown',
      description: 'A practical, no-fluff workshop. Twelve founders, twelve decks, real-time critique and rewrites. Come ready to share your screen.',
      eventType: 'in-person',
      start_at: at(33, 6), end_at: at(33, 8),
      timezone: 'Pacific/Auckland',
      visibility: 'space',
      status: 'published',
      hosts: [HOST],
      capacity: 12,
      theme: { color: '#10b981' },
      allowPlusOnes: 0,
      waitlistEnabled: true,
      guestListVisible: true,
      allowedResponses: ['going', 'maybe', 'declined'],
      locationData: VENUE.bizDojo,
      form_schema: form('pitch-deck-teardown', [
        { id: 'q_deck_link', type: 'url', label: 'Link to your current deck (optional)', required: false, placeholder: 'https://' },
        { id: 'q_deck_focus', type: 'text', label: 'One thing you want help with', required: false },
        { id: 'q_deck_coc', type: 'checkbox', label: 'I agree to the code of conduct', required: true },
      ]),
      analytics: analytics(9),
    },
  },

  // Draft — not published, so it appears only in the manage view, not the public list.
  {
    id: 'event:vv-portfolio-holiday-party',
    name: 'Portfolio Holiday Party (Draft)',
    subtitle: 'End-of-year celebration for the whole portfolio — details TBC.',
    location: 'TBC',
    metadata: {
      slug: 'portfolio-holiday-party',
      description: 'Save the date — a relaxed evening to close out the year with founders, the team, and friends of Blackbird. Venue and final timing still being locked in.',
      eventType: 'in-person',
      start_at: at(70, 7), end_at: at(70, 11),
      timezone: 'Australia/Sydney',
      visibility: 'space',
      status: 'draft',
      hosts: [HOST],
      capacity: 250,
      theme: { color: '#ef4444' },
      allowPlusOnes: 1,
      waitlistEnabled: false,
      guestListVisible: false,
      allowedResponses: ['going', 'maybe', 'declined'],
      form_schema: form('portfolio-holiday-party', [], { enabled: false }),
      analytics: analytics(0),
    },
  },

  // Past event — dated before "now" so the Past tab isn't empty. Has check-ins.
  {
    id: 'event:vv-q1-founder-mixer',
    name: 'Q1 Founder Mixer',
    subtitle: 'Our first-quarter space catch-up — thanks to everyone who came.',
    location: 'Blackbird HQ, Sydney',
    metadata: {
      slug: 'q1-founder-mixer',
      description: 'A casual evening of drinks and introductions to kick off the year. This event has wrapped — check out upcoming events above.',
      eventType: 'in-person',
      start_at: at(-46, 7), end_at: at(-46, 10), // ~6 weeks ago
      timezone: 'Australia/Sydney',
      visibility: 'space',
      status: 'published',
      hosts: [HOST],
      capacity: 120,
      theme: { color: '#8b5cf6' },
      allowPlusOnes: 1,
      waitlistEnabled: false,
      guestListVisible: true,
      allowedResponses: ['going', 'maybe', 'declined'],
      locationData: VENUE.blackbirdHQ,
      form_schema: form('q1-founder-mixer', [], { enabled: false }),
      analytics: analytics(74, 61),
    },
  },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Sanity: confirm the target space exists before we attach events to it.
  const comm = await client.query('SELECT 1 FROM spaces WHERE id = $1', [COMM]);
  if (comm.rowCount === 0) throw new Error(`Space ${COMM} not found — run the Blackbird seed first.`);

  console.log('--- Shifting existing events to future dates ---');
  for (const s of SHIFTS) {
    // Always update start/end; when a venue is supplied, also backfill
    // locationData (with coords) and the node's location column so the event
    // reads as in-person in the feed and Type filter.
    const r = await client.query(`
      UPDATE nodes
      SET metadata = (
            CASE WHEN $4::jsonb IS NULL THEN metadata
                 ELSE jsonb_set(metadata, '{locationData}', $4::jsonb) END
          )
          || jsonb_build_object('start_at', $2::text, 'end_at', $3::text),
          location = COALESCE($5, location),
          updated_at = NOW()
      WHERE id = $1 AND type = 'event'
      RETURNING id, name`,
      [s.id, s.startAt, s.endAt, s.location ? JSON.stringify(s.location) : null, s.location?.label ?? null]);
    if (r.rowCount === 0) console.log(`  ⚠ not found (skipped): ${s.id}`);
    else console.log(`  ✓ ${r.rows[0].id.padEnd(40)} -> ${r.rows[0].name}  (${s.startAt.slice(0, 10)})`);
  }

  console.log('\n--- Upserting new events ---');
  for (const e of EVENTS) {
    const r = await client.query(`
      INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, space_id, alias, created_at, updated_at)
      VALUES ($1, 'event', $2, $3, $4, NULL, '{}'::text[], $5::jsonb, $6, $7, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET type = 'event', name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
        location = EXCLUDED.location, metadata = EXCLUDED.metadata, alias = EXCLUDED.alias, updated_at = NOW()
      RETURNING id, name`,
      [e.id, e.name, e.subtitle, e.location, JSON.stringify(e.metadata), COMM, e.metadata.slug]);
    console.log(`  ✓ ${r.rows[0].id.padEnd(40)} -> ${r.rows[0].name}`);
  }

  await client.query('COMMIT');
  console.log('\n=== Committed ===');

  const summary = await client.query(`
    SELECT name,
           metadata->>'start_at'   AS start_at,
           metadata->>'eventType'  AS type,
           metadata->>'status'     AS status,
           metadata->>'visibility' AS visibility,
           jsonb_array_length(COALESCE(metadata->'form_schema'->'schema', '[]'::jsonb)) AS form_fields
    FROM nodes WHERE space_id = $1 AND type = 'event'
    ORDER BY metadata->>'start_at'`, [COMM]);
  console.table(summary.rows);

} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
