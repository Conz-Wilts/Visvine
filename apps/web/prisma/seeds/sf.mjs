/**
 * Seed script for SF Ecosystem community
 * Run: node apps/web/prisma/seeds/sf.mjs
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

// ─── Nodes ────────────────────────────────────────────────────────────────────

const nodes = [
  // Existing founders already in DB — skip those, add more people + orgs + events

  // ── People ──
  { id: 'person:sam-altman',       type: 'Founder', name: 'Sam Altman',       subtitle: 'CEO, OpenAI',                location: 'San Francisco, CA', url: 'https://twitter.com/sama',            tags: ['AI', 'VC', 'YC'] },
  { id: 'person:jensen-huang',     type: 'Founder', name: 'Jensen Huang',     subtitle: 'CEO, NVIDIA',                location: 'Santa Clara, CA',   url: 'https://nvidia.com',                  tags: ['AI', 'Semiconductors'] },
  { id: 'person:dara-khosrowshahi',type: 'Founder', name: 'Dara Khosrowshahi',subtitle: 'CEO, Uber',                  location: 'San Francisco, CA', url: 'https://uber.com',                    tags: ['Mobility', 'Marketplace'] },
  { id: 'person:patrick-collison', type: 'Founder', name: 'Patrick Collison', subtitle: 'CEO, Stripe',               location: 'San Francisco, CA', url: 'https://stripe.com',                  tags: ['Fintech', 'Payments'] },
  { id: 'person:john-collison',    type: 'Founder', name: 'John Collison',    subtitle: 'President, Stripe',         location: 'San Francisco, CA', url: 'https://stripe.com',                  tags: ['Fintech', 'Payments'] },
  { id: 'person:tobi-lutke',       type: 'Founder', name: 'Tobi Lütke',       subtitle: 'CEO, Shopify',              location: 'Ottawa, Canada',    url: 'https://shopify.com',                 tags: ['Ecommerce', 'Platforms'] },
  { id: 'person:reid-hoffman',     type: 'Person',  name: 'Reid Hoffman',     subtitle: 'Partner, Greylock',         location: 'Palo Alto, CA',     url: 'https://twitter.com/reidhoffman',     tags: ['VC', 'LinkedIn', 'AI'] },
  { id: 'person:marc-andreessen',  type: 'Person',  name: 'Marc Andreessen',  subtitle: 'GP, a16z',                  location: 'Menlo Park, CA',    url: 'https://a16z.com',                    tags: ['VC', 'Crypto', 'AI'] },
  { id: 'person:peter-thiel',      type: 'Person',  name: 'Peter Thiel',      subtitle: 'Co-founder, Founders Fund', location: 'San Francisco, CA', url: 'https://foundersfund.com',            tags: ['VC', 'Crypto', 'Defense'] },
  { id: 'person:elad-gil',         type: 'Person',  name: 'Elad Gil',         subtitle: 'Angel Investor',            location: 'San Francisco, CA', url: 'https://twitter.com/eladgil',         tags: ['Angel', 'Biotech', 'AI'] },
  { id: 'person:naval-ravikant',   type: 'Person',  name: 'Naval Ravikant',   subtitle: 'Co-founder, AngelList',     location: 'San Francisco, CA', url: 'https://nav.al',                      tags: ['Angel', 'Philosophy', 'Crypto'] },
  { id: 'person:garry-tan',        type: 'Person',  name: 'Garry Tan',        subtitle: 'CEO, Y Combinator',         location: 'San Francisco, CA', url: 'https://twitter.com/garrytan',        tags: ['YC', 'VC', 'AI'] },
  { id: 'person:sarah-guo',        type: 'Person',  name: 'Sarah Guo',        subtitle: 'Founder, Conviction',       location: 'San Francisco, CA', url: 'https://conviction.com',              tags: ['VC', 'AI', 'Enterprise'] },
  { id: 'person:vinod-khosla',     type: 'Person',  name: 'Vinod Khosla',     subtitle: 'Founder, Khosla Ventures',  location: 'Menlo Park, CA',    url: 'https://khoslaventures.com',          tags: ['VC', 'Energy', 'AI'] },
  { id: 'person:ann-miura-ko',     type: 'Person',  name: 'Ann Miura-Ko',     subtitle: 'Co-founder, Floodgate',     location: 'Palo Alto, CA',     url: 'https://floodgate.com',               tags: ['VC', 'Deep Tech'] },

  // ── Organizations ──
  { id: 'org:openai',              type: 'Organization', name: 'OpenAI',           subtitle: 'AI research & deployment', location: 'San Francisco, CA', url: 'https://openai.com',         tags: ['AI', 'LLM', 'Research'] },
  { id: 'org:anthropic',           type: 'Organization', name: 'Anthropic',         subtitle: 'AI safety company',        location: 'San Francisco, CA', url: 'https://anthropic.com',      tags: ['AI', 'Safety', 'LLM'] },
  { id: 'org:stripe',              type: 'Organization', name: 'Stripe',            subtitle: 'Payments infrastructure',  location: 'San Francisco, CA', url: 'https://stripe.com',         tags: ['Fintech', 'Payments', 'B2B'] },
  { id: 'org:yc',                  type: 'Organization', name: 'Y Combinator',      subtitle: 'Top startup accelerator',  location: 'San Francisco, CA', url: 'https://ycombinator.com',    tags: ['Accelerator', 'Seed', 'YC'] },
  { id: 'org:a16z',                type: 'Organization', name: 'Andreessen Horowitz',subtitle: 'Venture capital firm',    location: 'Menlo Park, CA',    url: 'https://a16z.com',           tags: ['VC', 'Crypto', 'AI', 'Bio'] },
  { id: 'org:sequoia',             type: 'Organization', name: 'Sequoia Capital',   subtitle: 'Legendary VC firm',        location: 'Menlo Park, CA',    url: 'https://sequoiacap.com',     tags: ['VC', 'Seed', 'Growth'] },
  { id: 'org:greylock',            type: 'Organization', name: 'Greylock',          subtitle: 'Early stage VC',           location: 'Menlo Park, CA',    url: 'https://greylock.com',       tags: ['VC', 'Enterprise', 'Consumer'] },
  { id: 'org:founders-fund',       type: 'Organization', name: 'Founders Fund',     subtitle: 'Peter Thiel\'s fund',      location: 'San Francisco, CA', url: 'https://foundersfund.com',   tags: ['VC', 'Deep Tech', 'Crypto'] },
  { id: 'org:khosla-ventures',     type: 'Organization', name: 'Khosla Ventures',   subtitle: 'Deep tech & AI VC',        location: 'Menlo Park, CA',    url: 'https://khoslaventures.com', tags: ['VC', 'AI', 'Energy'] },
  { id: 'org:conviction',          type: 'Organization', name: 'Conviction',        subtitle: 'AI-focused VC',            location: 'San Francisco, CA', url: 'https://conviction.com',     tags: ['VC', 'AI'] },
  { id: 'org:floodgate',           type: 'Organization', name: 'Floodgate',         subtitle: 'Pre-seed & seed VC',       location: 'Palo Alto, CA',     url: 'https://floodgate.com',      tags: ['VC', 'Seed', 'Pre-seed'] },
  { id: 'org:nvidia',              type: 'Organization', name: 'NVIDIA',            subtitle: 'AI chips & software',      location: 'Santa Clara, CA',   url: 'https://nvidia.com',         tags: ['AI', 'Semiconductors', 'HPC'] },
  { id: 'org:uber',                type: 'Organization', name: 'Uber',              subtitle: 'Mobility marketplace',     location: 'San Francisco, CA', url: 'https://uber.com',           tags: ['Mobility', 'Marketplace', 'Food'] },
  { id: 'org:angellist',           type: 'Organization', name: 'AngelList',         subtitle: 'Startup fundraising platform', location: 'San Francisco, CA', url: 'https://angel.co',      tags: ['Angel', 'Seed', 'Fundraising'] },
  { id: 'org:sf-tech-week',        type: 'Organization', name: 'SF Tech Week',      subtitle: 'Annual SF tech conference', location: 'San Francisco, CA', url: 'https://sftechweek.com',   tags: ['Events', 'Community', 'Tech'] },

  // ── Events ──
  {
    id: 'event:sf-ai-summit-2025',
    type: 'event',
    name: 'SF AI Summit 2025',
    subtitle: 'The premier AI conference in San Francisco',
    location: 'Moscone Center, San Francisco',
    url: 'https://sfaisummit.com',
    tags: ['AI', 'Conference', 'ML', 'LLM'],
    metadata: {
      date: '2025-03-15',
      endDate: '2025-03-16',
      time: '9:00 AM PST',
      capacity: 2000,
      ticketPrice: '$299',
      format: 'In-person',
      status: 'past',
    },
  },
  {
    id: 'event:yc-demo-day-w25',
    type: 'event',
    name: 'YC Demo Day W25',
    subtitle: 'Y Combinator Winter 2025 batch presentations',
    location: 'Y Combinator HQ, San Francisco',
    url: 'https://ycombinator.com/demo-day',
    tags: ['YC', 'Demo Day', 'Startups', 'Pitch'],
    metadata: {
      date: '2025-04-03',
      endDate: '2025-04-04',
      time: '10:00 AM PST',
      capacity: 500,
      ticketPrice: 'Invite Only',
      format: 'In-person',
      status: 'past',
    },
  },
  {
    id: 'event:sf-founders-dinner-may25',
    type: 'event',
    name: 'SF Founders Dinner',
    subtitle: 'Intimate dinner for ecosystem founders',
    location: 'Bix Restaurant, San Francisco',
    url: null,
    tags: ['Networking', 'Founders', 'Dinner'],
    metadata: {
      date: '2025-05-08',
      time: '7:00 PM PST',
      capacity: 60,
      ticketPrice: 'By invitation',
      format: 'In-person',
      status: 'past',
    },
  },
  {
    id: 'event:fintech-meetup-jun25',
    type: 'event',
    name: 'SF Fintech Builders Meetup',
    subtitle: 'Monthly meetup for fintech founders and builders',
    location: 'Stripe HQ, San Francisco',
    url: 'https://lu.ma/sf-fintech',
    tags: ['Fintech', 'Meetup', 'Payments', 'B2B'],
    metadata: {
      date: '2025-06-12',
      time: '6:30 PM PST',
      capacity: 150,
      ticketPrice: 'Free',
      format: 'In-person',
      status: 'upcoming',
    },
  },
  {
    id: 'event:ai-hackathon-jul25',
    type: 'event',
    name: 'AI Hackathon: Build with Claude',
    subtitle: '48-hour hackathon building AI-native products',
    location: 'Anthropic HQ, San Francisco',
    url: 'https://lu.ma/ai-hackathon-sf',
    tags: ['Hackathon', 'AI', 'Anthropic', 'LLM'],
    metadata: {
      date: '2025-07-19',
      endDate: '2025-07-20',
      time: '10:00 AM PST',
      capacity: 200,
      ticketPrice: 'Free',
      format: 'In-person',
      status: 'upcoming',
    },
  },
  {
    id: 'event:vc-office-hours-aug25',
    type: 'event',
    name: 'Open VC Office Hours',
    subtitle: 'Meet investors from a16z, Sequoia & Greylock',
    location: 'Greylock Partners, Menlo Park',
    url: 'https://lu.ma/vc-office-hours',
    tags: ['VC', 'Fundraising', 'Office Hours'],
    metadata: {
      date: '2025-08-07',
      time: '2:00 PM PST',
      capacity: 40,
      ticketPrice: 'Free (Application required)',
      format: 'In-person',
      status: 'upcoming',
    },
  },
  {
    id: 'event:sf-tech-week-oct25',
    type: 'event',
    name: 'SF Tech Week 2025',
    subtitle: 'Week-long celebration of SF tech culture',
    location: 'Various venues, San Francisco',
    url: 'https://sftechweek.com',
    tags: ['Tech Week', 'Conference', 'Community', 'Networking'],
    metadata: {
      date: '2025-10-13',
      endDate: '2025-10-17',
      time: 'All day',
      capacity: 10000,
      ticketPrice: 'Varies',
      format: 'In-person',
      status: 'upcoming',
    },
  },
  {
    id: 'event:climate-tech-summit-sep25',
    type: 'event',
    name: 'Climate Tech Summit SF',
    subtitle: 'Connecting climate founders with mission-driven capital',
    location: 'Salesforce Tower, San Francisco',
    url: 'https://lu.ma/climate-tech-sf',
    tags: ['Climate', 'Deep Tech', 'Energy', 'Impact'],
    metadata: {
      date: '2025-09-25',
      time: '9:00 AM PST',
      capacity: 300,
      ticketPrice: '$149',
      format: 'In-person',
      status: 'upcoming',
    },
  },
];

// ─── Links ────────────────────────────────────────────────────────────────────

const links = [
  // People → Orgs (leadership)
  { sourceId: 'person:sam-altman',         targetId: 'org:openai',          relationship: 'leads',           since: '2019' },
  { sourceId: 'person:jensen-huang',       targetId: 'org:nvidia',          relationship: 'leads',           since: '1993' },
  { sourceId: 'person:dara-khosrowshahi',  targetId: 'org:uber',            relationship: 'leads',           since: '2017' },
  { sourceId: 'person:patrick-collison',   targetId: 'org:stripe',          relationship: 'co-founded',      since: '2010' },
  { sourceId: 'person:john-collison',      targetId: 'org:stripe',          relationship: 'co-founded',      since: '2010' },
  { sourceId: 'person:marc-andreessen',    targetId: 'org:a16z',            relationship: 'founded',         since: '2009' },
  { sourceId: 'person:peter-thiel',        targetId: 'org:founders-fund',   relationship: 'founded',         since: '2005' },
  { sourceId: 'person:reid-hoffman',       targetId: 'org:greylock',        relationship: 'is partner at',   since: '2009' },
  { sourceId: 'person:vinod-khosla',       targetId: 'org:khosla-ventures', relationship: 'founded',         since: '2004' },
  { sourceId: 'person:sarah-guo',          targetId: 'org:conviction',      relationship: 'founded',         since: '2022' },
  { sourceId: 'person:ann-miura-ko',       targetId: 'org:floodgate',       relationship: 'co-founded',      since: '2006' },
  { sourceId: 'person:naval-ravikant',     targetId: 'org:angellist',       relationship: 'co-founded',      since: '2010' },
  { sourceId: 'person:garry-tan',          targetId: 'org:yc',              relationship: 'leads',           since: '2023' },

  // Founders → YC
  { sourceId: 'founder:brian-chesky',      targetId: 'org:yc',              relationship: 'alumnus of',      since: '2009' },
  { sourceId: 'founder:brian-armstrong',   targetId: 'org:yc',              relationship: 'alumnus of',      since: '2012' },
  { sourceId: 'founder:alexis-ohanian',    targetId: 'org:yc',              relationship: 'alumnus of',      since: '2005' },

  // VC → Portfolio
  { sourceId: 'org:a16z',                  targetId: 'org:openai',          relationship: 'invested in',     since: '2023' },
  { sourceId: 'org:sequoia',               targetId: 'org:openai',          relationship: 'invested in',     since: '2021' },
  { sourceId: 'org:greylock',              targetId: 'org:stripe',          relationship: 'invested in',     since: '2012' },
  { sourceId: 'org:founders-fund',         targetId: 'org:anthropic',       relationship: 'invested in',     since: '2023' },
  { sourceId: 'org:khosla-ventures',       targetId: 'org:anthropic',       relationship: 'invested in',     since: '2022' },

  // Founder co-investor / advisor relationships
  { sourceId: 'person:sam-altman',         targetId: 'person:reid-hoffman', relationship: 'knows',           since: '2014' },
  { sourceId: 'person:sam-altman',         targetId: 'person:garry-tan',    relationship: 'collaborates with', since: '2019' },
  { sourceId: 'person:naval-ravikant',     targetId: 'person:elad-gil',     relationship: 'knows',           since: '2011' },
  { sourceId: 'person:patrick-collison',   targetId: 'person:john-collison',relationship: 'co-founded with', since: '2010' },
  { sourceId: 'person:marc-andreessen',    targetId: 'person:reid-hoffman', relationship: 'co-invested with', since: '2009' },
  { sourceId: 'person:elad-gil',           targetId: 'org:openai',          relationship: 'advised',         since: '2020' },

  // Event speakers / hosts
  { sourceId: 'person:sam-altman',         targetId: 'event:sf-ai-summit-2025',       relationship: 'spoke at',  since: '2025' },
  { sourceId: 'person:jensen-huang',       targetId: 'event:sf-ai-summit-2025',       relationship: 'spoke at',  since: '2025' },
  { sourceId: 'person:sarah-guo',          targetId: 'event:sf-ai-summit-2025',       relationship: 'spoke at',  since: '2025' },
  { sourceId: 'org:yc',                    targetId: 'event:yc-demo-day-w25',         relationship: 'hosted',    since: '2025' },
  { sourceId: 'person:garry-tan',          targetId: 'event:yc-demo-day-w25',         relationship: 'hosted',    since: '2025' },
  { sourceId: 'org:stripe',                targetId: 'event:fintech-meetup-jun25',    relationship: 'hosts',     since: '2025' },
  { sourceId: 'person:patrick-collison',   targetId: 'event:fintech-meetup-jun25',    relationship: 'speaks at', since: '2025' },
  { sourceId: 'org:anthropic',             targetId: 'event:ai-hackathon-jul25',      relationship: 'hosts',     since: '2025' },
  { sourceId: 'org:greylock',              targetId: 'event:vc-office-hours-aug25',   relationship: 'hosts',     since: '2025' },
  { sourceId: 'org:a16z',                  targetId: 'event:vc-office-hours-aug25',   relationship: 'participates in', since: '2025' },
  { sourceId: 'org:sequoia',               targetId: 'event:vc-office-hours-aug25',   relationship: 'participates in', since: '2025' },
  { sourceId: 'org:sf-tech-week',          targetId: 'event:sf-tech-week-oct25',      relationship: 'organizes', since: '2025' },
  { sourceId: 'person:vinod-khosla',       targetId: 'event:climate-tech-summit-sep25', relationship: 'speaks at', since: '2025' },

  // Founders → events
  { sourceId: 'founder:brian-chesky',      targetId: 'event:sf-founders-dinner-may25', relationship: 'attended',  since: '2025' },
  { sourceId: 'founder:aaron-levie',       targetId: 'event:sf-founders-dinner-may25', relationship: 'attended',  since: '2025' },
  { sourceId: 'person:dara-khosrowshahi',  targetId: 'event:sf-founders-dinner-may25', relationship: 'attended',  since: '2025' },
  { sourceId: 'founder:ben-silbermann',    targetId: 'event:sf-ai-summit-2025',        relationship: 'attended',  since: '2025' },
  { sourceId: 'person:tobi-lutke',         targetId: 'event:sf-ai-summit-2025',        relationship: 'attended',  since: '2025' },
];

// ─── Attendees ────────────────────────────────────────────────────────────────

const attendees = [
  // YC Demo Day
  { id: 'att:yc-dd-001', eventId: 'event:yc-demo-day-w25', personId: 'person:sam-altman',       email: 'sam@openai.com',       companyName: 'OpenAI',     roleTitle: 'CEO',             status: 'attended' },
  { id: 'att:yc-dd-002', eventId: 'event:yc-demo-day-w25', personId: 'person:reid-hoffman',     email: 'reid@greylock.com',    companyName: 'Greylock',   roleTitle: 'Partner',         status: 'attended' },
  { id: 'att:yc-dd-003', eventId: 'event:yc-demo-day-w25', personId: 'person:sarah-guo',        email: 'sarah@conviction.com', companyName: 'Conviction', roleTitle: 'Founder',         status: 'attended' },
  { id: 'att:yc-dd-004', eventId: 'event:yc-demo-day-w25', personId: null,                      email: 'alex@startup.com',     companyName: 'Acme AI',    roleTitle: 'Founder',         status: 'attended' },
  { id: 'att:yc-dd-005', eventId: 'event:yc-demo-day-w25', personId: null,                      email: 'maya@finflow.io',      companyName: 'FinFlow',    roleTitle: 'Co-Founder',      status: 'attended' },
  { id: 'att:yc-dd-006', eventId: 'event:yc-demo-day-w25', personId: null,                      email: 'james@healthai.co',    companyName: 'HealthAI',   roleTitle: 'CEO',             status: 'registered' },

  // SF AI Summit
  { id: 'att:ai-s-001', eventId: 'event:sf-ai-summit-2025', personId: 'person:sam-altman',      email: 'sam@openai.com',       companyName: 'OpenAI',     roleTitle: 'CEO',             status: 'attended' },
  { id: 'att:ai-s-002', eventId: 'event:sf-ai-summit-2025', personId: 'person:jensen-huang',    email: 'jensen@nvidia.com',    companyName: 'NVIDIA',     roleTitle: 'CEO',             status: 'attended' },
  { id: 'att:ai-s-003', eventId: 'event:sf-ai-summit-2025', personId: 'person:sarah-guo',       email: 'sarah@conviction.com', companyName: 'Conviction', roleTitle: 'Founder',         status: 'attended' },
  { id: 'att:ai-s-004', eventId: 'event:sf-ai-summit-2025', personId: 'person:elad-gil',        email: 'elad@eladgil.com',     companyName: 'Independent',roleTitle: 'Angel Investor',  status: 'attended' },
  { id: 'att:ai-s-005', eventId: 'event:sf-ai-summit-2025', personId: null,                     email: 'priya@buildai.co',     companyName: 'BuildAI',    roleTitle: 'CTO',             status: 'attended' },
  { id: 'att:ai-s-006', eventId: 'event:sf-ai-summit-2025', personId: null,                     email: 'chen@synthai.com',     companyName: 'SynthAI',    roleTitle: 'Founder',         status: 'attended' },
  { id: 'att:ai-s-007', eventId: 'event:sf-ai-summit-2025', personId: null,                     email: 'nina@agentic.io',      companyName: 'Agentic',    roleTitle: 'CEO',             status: 'attended' },

  // Fintech Meetup
  { id: 'att:fin-001', eventId: 'event:fintech-meetup-jun25', personId: 'person:patrick-collison', email: 'patrick@stripe.com', companyName: 'Stripe',   roleTitle: 'CEO',             status: 'registered' },
  { id: 'att:fin-002', eventId: 'event:fintech-meetup-jun25', personId: 'person:naval-ravikant',   email: 'naval@angel.co',     companyName: 'AngelList',roleTitle: 'Co-Founder',      status: 'registered' },
  { id: 'att:fin-003', eventId: 'event:fintech-meetup-jun25', personId: null,                      email: 'keanu@payflow.com',  companyName: 'PayFlow',  roleTitle: 'Founder',         status: 'registered' },
  { id: 'att:fin-004', eventId: 'event:fintech-meetup-jun25', personId: null,                      email: 'luna@creditscore.io',companyName: 'CreditScore', roleTitle: 'CEO',          status: 'registered' },

  // AI Hackathon
  { id: 'att:hack-001', eventId: 'event:ai-hackathon-jul25', personId: null, email: 'dev1@builders.com',  companyName: 'Independent', roleTitle: 'Engineer',    status: 'registered' },
  { id: 'att:hack-002', eventId: 'event:ai-hackathon-jul25', personId: null, email: 'dev2@builders.com',  companyName: 'Independent', roleTitle: 'Designer',    status: 'registered' },
  { id: 'att:hack-003', eventId: 'event:ai-hackathon-jul25', personId: null, email: 'emma@aitools.dev',   companyName: 'AITools',     roleTitle: 'Founder',     status: 'registered' },
];

// ─── Run ──────────────────────────────────────────────────────────────────────

async function run() {
  const client = await pool.connect();

  try {
    console.log('🌱 Seeding SF Ecosystem...\n');

    // Insert nodes
    let nodeCount = 0;
    for (const node of nodes) {
      await client.query(
        `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, metadata, community_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           subtitle = EXCLUDED.subtitle,
           location = EXCLUDED.location,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          node.id, node.type, node.name,
          node.subtitle ?? null, node.location ?? null, node.url ?? null,
          node.tags ?? [], JSON.stringify(node.metadata ?? {}),
          COMMUNITY,
        ]
      );
      nodeCount++;
    }
    console.log(`✅ Upserted ${nodeCount} nodes`);

    // Insert links (skip if source/target don't exist)
    let linkCount = 0;
    let skipped = 0;
    for (const link of links) {
      const src = await client.query('SELECT id FROM nodes WHERE id=$1', [link.sourceId]);
      const tgt = await client.query('SELECT id FROM nodes WHERE id=$1', [link.targetId]);
      if (src.rows.length === 0 || tgt.rows.length === 0) {
        skipped++;
        console.warn(`  ⚠️  Skipping link ${link.sourceId} → ${link.targetId} (node not found)`);
        continue;
      }
      await client.query(
        `INSERT INTO links (source_id, target_id, relationship, since, community_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [link.sourceId, link.targetId, link.relationship, link.since ?? null, COMMUNITY]
      );
      linkCount++;
    }
    console.log(`✅ Inserted ${linkCount} links (${skipped} skipped)`);

    // Insert attendees
    let attCount = 0;
    for (const att of attendees) {
      await client.query(
        `INSERT INTO attendees (id, event_id, person_id, email, company_name, role_title, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           company_name = EXCLUDED.company_name,
           role_title = EXCLUDED.role_title,
           updated_at = NOW()`,
        [att.id, att.eventId, att.personId ?? null, att.email ?? null, att.companyName ?? null, att.roleTitle ?? null, att.status]
      );
      attCount++;
    }
    console.log(`✅ Inserted ${attCount} attendees`);

    // Summary
    const { rows: [{ count: totalNodes }] } = await client.query(`SELECT count(*) FROM nodes WHERE community_id=$1`, [COMMUNITY]);
    const { rows: [{ count: totalLinks }] } = await client.query(`SELECT count(*) FROM links WHERE community_id=$1`, [COMMUNITY]);
    const { rows: eventRows } = await client.query(`SELECT id, name FROM nodes WHERE community_id=$1 AND type='Event' ORDER BY name`, [COMMUNITY]);

    console.log(`\n📊 SF Ecosystem totals:`);
    console.log(`   Nodes: ${totalNodes}`);
    console.log(`   Links: ${totalLinks}`);
    console.log(`   Events:`);
    eventRows.forEach(e => console.log(`     • ${e.name} (${e.id})`));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
