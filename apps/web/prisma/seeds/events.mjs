/**
 * Seed script for placeholder event nodes
 * Run: node apps/web/prisma/seeds/events.mjs
 */

import pg from 'pg';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`ERROR: ${name} is not set in apps/web/.env`);
    process.exit(1);
  }
  return v;
}

const pool = new pg.Pool({
  host: requireEnv('DB_HOST'),
  port: parseInt(requireEnv('DB_PORT')),
  database: requireEnv('DB_NAME'),
  user: requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
});

const COMMUNITY = 'sf-ecosystem';

// Dates relative to now
const now = new Date();
function daysFromNow(days) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d;
}

function makeISO(date, hour = 18, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ─── Events ──────────────────────────────────────────────────────────────────

const events = [
  {
    id: 'event:sf-ai-meetup',
    name: 'SF AI Builders Meetup',
    subtitle: 'Monthly gathering for AI engineers and researchers building the future of intelligence.',
    location: 'The Pearl, 601 19th St, San Francisco, CA',
    tags: ['AI', 'Machine Learning', 'Networking', 'LLMs'],
    metadata: {
      description: `Join 80+ AI engineers, researchers, and founders for our monthly SF AI Builders Meetup!\n\nThis month's theme: \"Beyond Transformers — What's Next for AI Architecture?\"\n\nAgenda:\n• 6:00 PM — Doors open, networking & drinks\n• 6:45 PM — Lightning talks (3 speakers, 10 min each)\n• 7:30 PM — Panel discussion with Q&A\n• 8:15 PM — Open networking\n• 9:00 PM — Wrap up\n\nFood and drinks provided. Come meet the people building the next generation of AI systems.`,
      start_at: makeISO(daysFromNow(21), 18, 0),
      end_at: makeISO(daysFromNow(21), 21, 0),
      timezone: 'America/Los_Angeles',
      capacity: 80,
      organizerEmail: 'events@sfaibuilders.com',
      hosts: ['Sarah Guo', 'Garry Tan'],
      locationData: { label: 'The Pearl, 601 19th St, San Francisco, CA', address: '601 19th St, San Francisco, CA 94107', lat: 37.7601, lon: -122.3894 },
      visibility: 'public',
      form: { enabled: true, slug: 'sf-ai-meetup', schema: [] },
      analytics: { views: 342, rsvpCount: 67, checkinCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    },
  },
  {
    id: 'event:product-design-workshop',
    name: 'Product Design Workshop: AI-First Interfaces',
    subtitle: 'Hands-on workshop on designing intuitive interfaces for AI-powered products.',
    location: 'WeWork SOMA, 156 2nd St, San Francisco, CA',
    tags: ['Design', 'Product', 'AI', 'UX', 'Workshop'],
    metadata: {
      description: `A hands-on, half-day workshop for product designers and PMs building AI-first products.\n\nWhat you'll learn:\n• How to design for probabilistic outputs (when AI isn't always right)\n• Progressive disclosure patterns for AI features\n• Building trust through transparency in AI interfaces\n• Real-world case studies from Notion AI, ChatGPT, and Linear\n\nBring your laptop — we'll work through exercises in Figma. Limited to 30 seats for quality interaction.\n\nInstructor: Maya Chen, Head of Design at Notion AI (prev. Google DeepMind)`,
      start_at: makeISO(daysFromNow(7), 13, 0),
      end_at: makeISO(daysFromNow(7), 17, 0),
      timezone: 'America/Los_Angeles',
      capacity: 30,
      organizerEmail: 'maya@designguild.co',
      hosts: ['Maya Chen'],
      locationData: { label: 'WeWork SOMA, 156 2nd St, San Francisco, CA', address: '156 2nd St, San Francisco, CA 94105', lat: 37.7873, lon: -122.3981 },
      visibility: 'public',
      form: { enabled: true, slug: 'product-design-workshop', schema: [] },
      analytics: { views: 189, rsvpCount: 28, checkinCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    },
  },
  {
    id: 'event:founders-dinner',
    name: 'Founders Networking Dinner',
    subtitle: 'Intimate dinner for early-stage founders building in SF.',
    location: 'Foreign Cinema, 2534 Mission St, San Francisco, CA',
    tags: ['Founders', 'Networking', 'Dinner', 'Startups'],
    metadata: {
      description: `An intimate dinner for 24 early-stage founders building startups in San Francisco.\n\nFormat:\n• Curated seating — we match founders at similar stages working on complementary problems\n• No pitches, no panels — just genuine conversation over great food\n• Chatham House Rules apply\n\nMenu: 3-course prix fixe dinner with wine pairing. Dietary restrictions accommodated.\n\nThis is our 12th dinner in the series. Past attendees have gone on to collaborate on products, co-invest, and build lasting friendships.\n\nDress code: Smart casual. Please arrive on time — seating begins promptly at 7:00 PM.`,
      start_at: makeISO(daysFromNow(2), 19, 0),
      end_at: makeISO(daysFromNow(2), 22, 0),
      timezone: 'America/Los_Angeles',
      capacity: 24,
      organizerEmail: 'founders@sfdinners.com',
      hosts: ['Elad Gil', 'Naval Ravikant'],
      locationData: { label: 'Foreign Cinema, 2534 Mission St, San Francisco, CA', address: '2534 Mission St, San Francisco, CA 94110', lat: 37.7561, lon: -122.4189 },
      visibility: 'community',
      form: { enabled: true, slug: 'founders-dinner', schema: [] },
      analytics: { views: 96, rsvpCount: 22, checkinCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    },
  },
  {
    id: 'event:bay-area-tech-conf',
    name: 'Bay Area Tech Conference 2026',
    subtitle: 'The premier gathering for the Bay Area tech ecosystem.',
    location: 'Moscone Center, 747 Howard St, San Francisco, CA',
    tags: ['Conference', 'Tech', 'AI', 'Startups', 'Enterprise'],
    metadata: {
      description: `Bay Area Tech Conference is back for its 8th year!\n\nJoin 500+ founders, engineers, investors, and operators for two days of talks, workshops, and networking.\n\nHighlights:\n• Keynote: Jensen Huang (NVIDIA) on "The Next Computing Platform"\n• 30+ breakout sessions across 4 tracks: AI, Infrastructure, Fintech, Climate\n• Startup Expo: 50 early-stage companies demo live\n• Investor Office Hours: 15-min slots with top VCs\n• After-party at Yerba Buena Gardens\n\nEarly bird pricing available until May 1st.\n\nSponsored by a16z, Sequoia, and Y Combinator.`,
      start_at: makeISO(daysFromNow(60), 9, 0),
      end_at: makeISO(daysFromNow(61), 18, 0),
      timezone: 'America/Los_Angeles',
      capacity: 500,
      organizerEmail: 'hello@batechconf.com',
      hosts: ['Marc Andreessen', 'Garry Tan', 'Jensen Huang'],
      locationData: { label: 'Moscone Center, 747 Howard St, San Francisco, CA', address: '747 Howard St, San Francisco, CA 94103', lat: 37.7842, lon: -122.4016 },
      visibility: 'public',
      form: { enabled: true, slug: 'bay-area-tech-conf', schema: [] },
      analytics: { views: 2450, rsvpCount: 312, checkinCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    },
  },
  {
    id: 'event:weekend-hackathon',
    name: 'Weekend Hackathon: Ship Something Real',
    subtitle: '48-hour hackathon focused on building products that solve real problems.',
    location: 'GitHub HQ, 88 Colin P Kelly Jr St, San Francisco, CA',
    tags: ['Hackathon', 'Engineering', 'AI', 'Open Source'],
    metadata: {
      description: `No themes. No mandatory pitches. Just 48 hours to build something you've been wanting to build.\n\nRules:\n• Solo or teams up to 4\n• Must be a new project (no pre-existing codebases)\n• Deploy it live by Sunday 5 PM\n• Top 3 projects win $5K, $2.5K, $1K prizes\n\nProvided:\n• Fast WiFi, monitors, power strips\n• Meals: Friday dinner, Saturday breakfast/lunch/dinner, Sunday breakfast/lunch\n• Coffee station open 24/7\n• Quiet sleeping room with cots\n• Mentor office hours (engineers from GitHub, Vercel, Supabase)\n\nBring your laptop, charger, and an idea. Or just show up and find a team.`,
      start_at: makeISO(daysFromNow(30), 18, 0),
      end_at: makeISO(daysFromNow(32), 17, 0),
      timezone: 'America/Los_Angeles',
      capacity: 100,
      organizerEmail: 'hack@shipitweekend.com',
      hosts: ['GitHub', 'Vercel'],
      locationData: { label: 'GitHub HQ, 88 Colin P Kelly Jr St, San Francisco, CA', address: '88 Colin P Kelly Jr St, San Francisco, CA 94107', lat: 37.7823, lon: -122.3912 },
      visibility: 'public',
      form: { enabled: true, slug: 'weekend-hackathon', schema: [] },
      analytics: { views: 567, rsvpCount: 78, checkinCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    },
  },
];

// ─── Attendees ───────────────────────────────────────────────────────────────

const attendees = [
  // SF AI Meetup
  { id: 'attendee:sf-ai-1', eventId: 'event:sf-ai-meetup', personId: 'person:sam-altman', email: 'sam@openai.com', status: 'registered', companyName: 'OpenAI', roleTitle: 'CEO' },
  { id: 'attendee:sf-ai-2', eventId: 'event:sf-ai-meetup', personId: 'person:sarah-guo', email: 'sarah@conviction.com', status: 'registered', companyName: 'Conviction', roleTitle: 'Founder' },
  { id: 'attendee:sf-ai-3', eventId: 'event:sf-ai-meetup', personId: 'person:elad-gil', email: 'elad@eladgil.com', status: 'registered', companyName: null, roleTitle: 'Angel Investor' },

  // Product Design Workshop
  { id: 'attendee:pdw-1', eventId: 'event:product-design-workshop', personId: null, email: 'alex.designer@gmail.com', status: 'registered', companyName: 'Figma', roleTitle: 'Senior Designer' },
  { id: 'attendee:pdw-2', eventId: 'event:product-design-workshop', personId: null, email: 'priya.pm@notion.so', status: 'registered', companyName: 'Notion', roleTitle: 'Product Manager' },
  { id: 'attendee:pdw-3', eventId: 'event:product-design-workshop', personId: null, email: 'james@linear.app', status: 'waitlisted', companyName: 'Linear', roleTitle: 'Design Lead' },

  // Founders Dinner
  { id: 'attendee:fd-1', eventId: 'event:founders-dinner', personId: 'person:elad-gil', email: 'elad@eladgil.com', status: 'registered', companyName: null, roleTitle: 'Angel Investor' },
  { id: 'attendee:fd-2', eventId: 'event:founders-dinner', personId: 'person:naval-ravikant', email: 'naval@angellist.co', status: 'checked_in', companyName: 'AngelList', roleTitle: 'Co-founder' },
  { id: 'attendee:fd-3', eventId: 'event:founders-dinner', personId: 'person:garry-tan', email: 'garry@ycombinator.com', status: 'registered', companyName: 'Y Combinator', roleTitle: 'CEO' },

  // Bay Area Tech Conf
  { id: 'attendee:batc-1', eventId: 'event:bay-area-tech-conf', personId: 'person:jensen-huang', email: 'jensen@nvidia.com', status: 'registered', companyName: 'NVIDIA', roleTitle: 'CEO' },
  { id: 'attendee:batc-2', eventId: 'event:bay-area-tech-conf', personId: 'person:marc-andreessen', email: 'marc@a16z.com', status: 'registered', companyName: 'a16z', roleTitle: 'GP' },
  { id: 'attendee:batc-3', eventId: 'event:bay-area-tech-conf', personId: 'person:reid-hoffman', email: 'reid@greylock.com', status: 'registered', companyName: 'Greylock', roleTitle: 'Partner' },

  // Weekend Hackathon
  { id: 'attendee:wh-1', eventId: 'event:weekend-hackathon', personId: null, email: 'dev@example.com', status: 'registered', companyName: 'Indie', roleTitle: 'Full-Stack Engineer' },
  { id: 'attendee:wh-2', eventId: 'event:weekend-hackathon', personId: null, email: 'hacker@buildfast.io', status: 'registered', companyName: 'BuildFast', roleTitle: 'Founder & CTO' },
];

// ─── Links (organizer → event) ───────────────────────────────────────────────

const links = [
  { source: 'person:sarah-guo', target: 'event:sf-ai-meetup', relationship: 'organizes' },
  { source: 'person:garry-tan', target: 'event:sf-ai-meetup', relationship: 'organizes' },
  { source: 'person:elad-gil', target: 'event:founders-dinner', relationship: 'organizes' },
  { source: 'person:naval-ravikant', target: 'event:founders-dinner', relationship: 'organizes' },
  { source: 'person:marc-andreessen', target: 'event:bay-area-tech-conf', relationship: 'organizes' },
  { source: 'person:garry-tan', target: 'event:bay-area-tech-conf', relationship: 'organizes' },
  { source: 'person:jensen-huang', target: 'event:bay-area-tech-conf', relationship: 'keynote speaker' },
];

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert event nodes
    for (const e of events) {
      await client.query(
        `INSERT INTO nodes (id, type, name, subtitle, location, community_id, tags, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           subtitle = EXCLUDED.subtitle,
           location = EXCLUDED.location,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [e.id, 'event', e.name, e.subtitle, e.location, COMMUNITY, e.tags, JSON.stringify(e.metadata)]
      );
    }
    console.log(`✓ Upserted ${events.length} event nodes`);

    // Upsert attendees
    for (const a of attendees) {
      await client.query(
        `INSERT INTO attendees (id, event_id, person_id, email, status, company_name, role_title, answers, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           company_name = EXCLUDED.company_name,
           role_title = EXCLUDED.role_title,
           updated_at = NOW()`,
        [a.id, a.eventId, a.personId, a.email, a.status, a.companyName, a.roleTitle, '{}']
      );
    }
    console.log(`✓ Upserted ${attendees.length} attendees`);

    // Fix sequence if needed
    await client.query(`SELECT setval('links_id_seq', (SELECT COALESCE(MAX(id), 0) FROM links))`);

    // Upsert links
    for (const l of links) {
      await client.query(
        `INSERT INTO links (source_id, target_id, community_id, relationship, metadata)
         SELECT $1, $2, $3, $4, $5::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM links WHERE source_id = $1 AND target_id = $2 AND community_id = $3
         )`,
        [l.source, l.target, COMMUNITY, l.relationship, '{}']
      );
    }
    console.log(`✓ Upserted ${links.length} links`);

    await client.query('COMMIT');
    console.log('\n✅ Event seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
