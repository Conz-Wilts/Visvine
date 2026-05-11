/**
 * Seed script for Australian Tech Ecosystem community
 * Populates ALL tables in the schema with realistic Australian data
 * Run: node apps/web/prisma/seeds/au.mjs
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

const COMMUNITY = 'au-ecosystem';

// ─── Users ───────────────────────────────────────────────────────────────────

const users = [
  { id: 'au-user-001', name: 'Mike Cannon-Brookes', email: 'mike@atlassian.com',       googleId: 'g-au-001', oauthProvider: 'google' },
  { id: 'au-user-002', name: 'Melanie Perkins',     email: 'mel@canva.com',             googleId: 'g-au-002', oauthProvider: 'google' },
  { id: 'au-user-003', name: 'Scott Farquhar',      email: 'scott@atlassian.com',       googleId: 'g-au-003', oauthProvider: 'google' },
  { id: 'au-user-004', name: 'Luke Anear',          email: 'luke@safetyculture.com',    googleId: 'g-au-004', oauthProvider: 'google' },
  { id: 'au-user-005', name: 'Didier Elzinga',      email: 'didier@cultureamp.com',     googleId: 'g-au-005', oauthProvider: 'google' },
  { id: 'au-user-006', name: 'Jack Zhang',          email: 'jack@airwallex.com',        googleId: 'g-au-006', oauthProvider: 'google' },
  { id: 'au-user-007', name: 'Fiona Pak-Poy',       email: 'fiona@tenacious.vc',        googleId: 'g-au-007', oauthProvider: 'google' },
  { id: 'au-user-008', name: 'Admin User',          email: 'admin@au-ecosystem.com',    googleId: 'g-au-008', oauthProvider: 'google' },
];

// ─── Nodes ───────────────────────────────────────────────────────────────────

const nodes = [
  // ── People: Founders ──
  { id: 'person:mike-cannon-brookes',  type: 'Person', alias: 'Founder',          name: 'Mike Cannon-Brookes',  subtitle: 'Co-founder & Co-CEO, Atlassian',    location: 'Sydney, NSW',      url: 'https://linkedin.com/in/mikecb',          tags: ['Enterprise', 'SaaS', 'Climate'] },
  { id: 'person:scott-farquhar',       type: 'Person', alias: 'Founder',          name: 'Scott Farquhar',       subtitle: 'Co-founder & Co-CEO, Atlassian',    location: 'Sydney, NSW',      url: 'https://linkedin.com/in/scottfarquhar',   tags: ['Enterprise', 'SaaS', 'Philanthropy'] },
  { id: 'person:melanie-perkins',      type: 'Person', alias: 'Founder',          name: 'Melanie Perkins',      subtitle: 'CEO & Co-founder, Canva',           location: 'Sydney, NSW',      url: 'https://linkedin.com/in/melanieperkins',  tags: ['Design', 'SaaS', 'EdTech'] },
  { id: 'person:cliff-obrecht',        type: 'Person', alias: 'Founder',          name: 'Cliff Obrecht',        subtitle: 'COO & Co-founder, Canva',           location: 'Sydney, NSW',      url: 'https://linkedin.com/in/cliffobrecht',    tags: ['Design', 'Operations'] },
  { id: 'person:cameron-adams',        type: 'Person', alias: 'Founder',          name: 'Cameron Adams',        subtitle: 'CPO & Co-founder, Canva',           location: 'Sydney, NSW',      url: 'https://themaninblue.com',                tags: ['Design', 'Product', 'UX'] },
  { id: 'person:luke-anear',           type: 'Person', alias: 'Founder',          name: 'Luke Anear',           subtitle: 'CEO & Founder, SafetyCulture',      location: 'Sydney, NSW',      url: 'https://safetyculture.com',               tags: ['Safety', 'Mobile', 'IoT'] },
  { id: 'person:didier-elzinga',       type: 'Person', alias: 'Founder',          name: 'Didier Elzinga',       subtitle: 'CEO & Co-founder, Culture Amp',     location: 'Melbourne, VIC',   url: 'https://cultureamp.com',                  tags: ['HR Tech', 'People Analytics', 'SaaS'] },
  { id: 'person:jack-zhang',           type: 'Person', alias: 'Founder',          name: 'Jack Zhang',           subtitle: 'CEO & Co-founder, Airwallex',       location: 'Melbourne, VIC',   url: 'https://airwallex.com',                   tags: ['Fintech', 'Payments', 'Global'] },
  { id: 'person:nick-molnar',          type: 'Person', alias: 'Founder',          name: 'Nick Molnar',          subtitle: 'Co-founder, Afterpay',              location: 'Melbourne, VIC',   url: 'https://linkedin.com/in/nickmolnar',      tags: ['Fintech', 'BNPL', 'Retail'] },
  { id: 'person:anthony-eisen',        type: 'Person', alias: 'Founder',          name: 'Anthony Eisen',        subtitle: 'Co-founder, Afterpay',              location: 'Melbourne, VIC',   url: 'https://linkedin.com/in/anthonyeisen',    tags: ['Fintech', 'BNPL', 'Investing'] },
  { id: 'person:jemma-green',          type: 'Person', alias: 'Founder',          name: 'Jemma Green',          subtitle: 'Co-founder, Power Ledger',          location: 'Perth, WA',        url: 'https://powerledger.io',                  tags: ['Energy', 'Blockchain', 'Climate'] },
  { id: 'person:fred-schebesta',       type: 'Person', alias: 'Founder',          name: 'Fred Schebesta',       subtitle: 'Co-founder, Finder',                location: 'Sydney, NSW',      url: 'https://finder.com.au',                   tags: ['Fintech', 'Comparison', 'Media'] },
  { id: 'person:matt-barrie',          type: 'Person', alias: 'Founder',          name: 'Matt Barrie',          subtitle: 'CEO, Freelancer',                   location: 'Sydney, NSW',      url: 'https://freelancer.com',                  tags: ['Marketplace', 'Gig Economy'] },
  { id: 'person:chris-gilmour',        type: 'Person', alias: 'Founder',          name: 'Chris Gilmour',        subtitle: 'Co-founder, Eucalyptus',            location: 'Sydney, NSW',      url: 'https://eucalyptus.vc',                   tags: ['Health Tech', 'Telehealth', 'DTC'] },
  { id: 'person:tim-fung',             type: 'Person', alias: 'Founder',          name: 'Tim Fung',             subtitle: 'CEO & Co-founder, Airtasker',       location: 'Sydney, NSW',      url: 'https://airtasker.com',                   tags: ['Marketplace', 'Gig Economy', 'Services'] },

  // ── People: Investors / VCs ──
  { id: 'person:rick-baker',           type: 'Person', alias: 'Investor',         name: 'Rick Baker',           subtitle: 'Partner, Blackbird Ventures',        location: 'Sydney, NSW',      url: 'https://blackbird.vc',                    tags: ['VC', 'Seed', 'Series A'] },
  { id: 'person:niki-scevak',          type: 'Person', alias: 'Investor',         name: 'Niki Scevak',          subtitle: 'Co-founder, Blackbird Ventures',     location: 'Sydney, NSW',      url: 'https://blackbird.vc',                    tags: ['VC', 'Startups', 'Ambition'] },
  { id: 'person:fiona-pak-poy',        type: 'Person', alias: 'Investor',         name: 'Fiona Pak-Poy',        subtitle: 'Founder, Tenacious Ventures',        location: 'Adelaide, SA',     url: 'https://tenacious.vc',                    tags: ['AgriTech', 'FoodTech', 'Impact'] },
  { id: 'person:daniel-petre',         type: 'Person', alias: 'Investor',         name: 'Daniel Petre',         subtitle: 'Co-founder, AirTree Ventures',       location: 'Sydney, NSW',      url: 'https://airtree.vc',                      tags: ['VC', 'Growth', 'SaaS'] },
  { id: 'person:craig-blair',          type: 'Person', alias: 'Investor',         name: 'Craig Blair',          subtitle: 'Co-founder, AirTree Ventures',       location: 'Sydney, NSW',      url: 'https://airtree.vc',                      tags: ['VC', 'Growth', 'Marketplace'] },
  { id: 'person:paul-bassat',          type: 'Person', alias: 'Investor',         name: 'Paul Bassat',          subtitle: 'Co-founder, Square Peg Capital',     location: 'Melbourne, VIC',   url: 'https://squarepegcap.com',                tags: ['VC', 'Global', 'Fintech'] },
  { id: 'person:bill-bartee',          type: 'Person', alias: 'Investor',         name: 'Bill Bartee',          subtitle: 'Managing Director, Main Sequence',   location: 'Sydney, NSW',      url: 'https://mseq.vc',                         tags: ['Deep Tech', 'CSIRO', 'Science'] },

  // ── People: Ecosystem Leaders ──
  { id: 'person:alan-noble',           type: 'Person', alias: 'Ecosystem Leader', name: 'Alan Noble',           subtitle: 'Former Engineering Director, Google AU', location: 'Sydney, NSW',  url: 'https://linkedin.com/in/alannoble',       tags: ['Engineering', 'Big Tech', 'Education'] },
  { id: 'person:mark-pesce',           type: 'Person', alias: 'Ecosystem Leader', name: 'Mark Pesce',           subtitle: 'Futurist & Author',                  location: 'Sydney, NSW',      url: 'https://markpesce.com',                   tags: ['Futurism', 'VR', 'Media'] },
  { id: 'person:kate-cornick',         type: 'Person', alias: 'Ecosystem Leader', name: 'Kate Cornick',         subtitle: 'CEO, LaunchVic',                     location: 'Melbourne, VIC',   url: 'https://launchvic.org',                   tags: ['Government', 'Startup Policy', 'Ecosystem'] },
  { id: 'person:sally-ann-williams',   type: 'Person', alias: 'Ecosystem Leader', name: 'Sally-Ann Williams',   subtitle: 'CEO, Cicada Innovations',            location: 'Sydney, NSW',      url: 'https://cicadainnovations.com',           tags: ['Deep Tech', 'Incubator', 'Science'] },
  { id: 'person:alex-scandurra',       type: 'Person', alias: 'Ecosystem Leader', name: 'Alex Scandurra',       subtitle: 'CEO, Stone & Chalk',                 location: 'Sydney, NSW',      url: 'https://stoneandchalk.com.au',            tags: ['Fintech', 'Innovation Hub', 'Community'] },
  { id: 'person:jordan-grives',        type: 'Person', alias: 'Ecosystem Leader', name: 'Jordan Grives',        subtitle: 'Community Lead, Fishburners',        location: 'Sydney, NSW',      url: 'https://fishburners.org',                 tags: ['Community', 'Coworking', 'Startups'] },

  // ── Organizations ──
  { id: 'org:atlassian',            type: 'Organization', name: 'Atlassian',            subtitle: 'Enterprise collaboration software',      location: 'Sydney, NSW',      url: 'https://atlassian.com',          tags: ['Enterprise', 'SaaS', 'Collaboration', 'ASX'] },
  { id: 'org:canva',                type: 'Organization', name: 'Canva',                subtitle: 'Visual communication platform',          location: 'Sydney, NSW',      url: 'https://canva.com',              tags: ['Design', 'SaaS', 'EdTech', 'AI'] },
  { id: 'org:safetyculture',        type: 'Organization', name: 'SafetyCulture',        subtitle: 'Workplace operations platform',          location: 'Sydney, NSW',      url: 'https://safetyculture.com',      tags: ['Safety', 'Mobile', 'IoT', 'Inspections'] },
  { id: 'org:culture-amp',          type: 'Organization', name: 'Culture Amp',          subtitle: 'Employee experience platform',           location: 'Melbourne, VIC',   url: 'https://cultureamp.com',         tags: ['HR Tech', 'People Analytics', 'SaaS'] },
  { id: 'org:airwallex',            type: 'Organization', name: 'Airwallex',            subtitle: 'Global payments & financial infrastructure', location: 'Melbourne, VIC', url: 'https://airwallex.com',        tags: ['Fintech', 'Payments', 'B2B', 'Global'] },
  { id: 'org:afterpay',             type: 'Organization', name: 'Afterpay',             subtitle: 'Buy now, pay later platform',            location: 'Melbourne, VIC',   url: 'https://afterpay.com',           tags: ['Fintech', 'BNPL', 'Retail', 'Acquired'] },
  { id: 'org:blackbird',            type: 'Organization', name: 'Blackbird Ventures',   subtitle: 'Australia\'s largest VC firm',           location: 'Sydney, NSW',      url: 'https://blackbird.vc',           tags: ['VC', 'Seed', 'Series A', 'Ambition'] },
  { id: 'org:airtree',              type: 'Organization', name: 'AirTree Ventures',     subtitle: 'Leading Australian VC',                  location: 'Sydney, NSW',      url: 'https://airtree.vc',             tags: ['VC', 'Growth', 'SaaS', 'Marketplace'] },
  { id: 'org:square-peg',           type: 'Organization', name: 'Square Peg Capital',   subtitle: 'Global venture capital firm',            location: 'Melbourne, VIC',   url: 'https://squarepegcap.com',       tags: ['VC', 'Global', 'Fintech', 'AI'] },
  { id: 'org:main-sequence',        type: 'Organization', name: 'Main Sequence',        subtitle: 'CSIRO-backed deep tech VC',             location: 'Sydney, NSW',      url: 'https://mseq.vc',               tags: ['Deep Tech', 'Science', 'VC', 'CSIRO'] },
  { id: 'org:tenacious-ventures',   type: 'Organization', name: 'Tenacious Ventures',   subtitle: 'AgriFood tech venture capital',         location: 'Adelaide, SA',     url: 'https://tenacious.vc',           tags: ['AgriTech', 'FoodTech', 'Impact', 'VC'] },
  { id: 'org:stone-chalk',          type: 'Organization', name: 'Stone & Chalk',        subtitle: 'Australia\'s largest innovation hub',    location: 'Sydney, NSW',      url: 'https://stoneandchalk.com.au',   tags: ['Fintech', 'Innovation', 'Hub', 'Community'] },
  { id: 'org:fishburners',          type: 'Organization', name: 'Fishburners',          subtitle: 'Australia\'s largest startup community', location: 'Sydney, NSW',      url: 'https://fishburners.org',        tags: ['Coworking', 'Community', 'Startups'] },
  { id: 'org:cicada-innovations',   type: 'Organization', name: 'Cicada Innovations',   subtitle: 'Deep tech incubator',                   location: 'Sydney, NSW',      url: 'https://cicadainnovations.com',  tags: ['Deep Tech', 'Incubator', 'Science', 'MedTech'] },
  { id: 'org:launchvic',            type: 'Organization', name: 'LaunchVic',            subtitle: 'Victorian Government startup agency',    location: 'Melbourne, VIC',   url: 'https://launchvic.org',          tags: ['Government', 'Ecosystem', 'Grants', 'Policy'] },

  // ── Events ──
  {
    id: 'event:au-tech-week-2025', type: 'Event', name: 'Australian Tech Week 2025',
    subtitle: 'Australia\'s premier week-long tech festival', location: 'Sydney, NSW',
    url: 'https://australiantechweek.com', tags: ['Conference', 'Tech', 'Networking', 'Innovation'],
    metadata: { date: '2025-10-20', endDate: '2025-10-24', time: '9:00 AM AEST', capacity: 5000, ticketPrice: 'Varies', format: 'In-person', status: 'past' },
  },
  {
    id: 'event:sxsw-sydney-2025', type: 'Event', name: 'SXSW Sydney 2025',
    subtitle: 'Where technology, creativity and culture collide', location: 'ICC Sydney, Darling Harbour',
    url: 'https://sxswsydney.com', tags: ['Conference', 'Culture', 'Music', 'Tech', 'Film'],
    metadata: { date: '2025-10-13', endDate: '2025-10-19', time: '10:00 AM AEST', capacity: 10000, ticketPrice: '$499', format: 'In-person', status: 'past' },
  },
  {
    id: 'event:startup-grind-melb-mar26', type: 'Event', name: 'Startup Grind Melbourne',
    subtitle: 'Fireside chat with Jack Zhang on scaling globally', location: 'RMIT Storey Hall, Melbourne',
    url: 'https://startupgrind.com/melbourne', tags: ['Meetup', 'Fireside Chat', 'Startups'],
    metadata: { date: '2026-03-19', time: '6:00 PM AEST', capacity: 200, ticketPrice: 'Free', format: 'In-person', status: 'past' },
  },
  {
    id: 'event:blackbird-demo-day-w26', type: 'Event', name: 'Blackbird Giants Demo Day W26',
    subtitle: 'Blackbird\'s Winter 2026 cohort pitch event', location: 'Carriageworks, Sydney',
    url: 'https://blackbird.vc/giants', tags: ['Demo Day', 'Startups', 'Pitch', 'VC'],
    metadata: { date: '2026-04-10', time: '10:00 AM AEST', capacity: 400, ticketPrice: 'Invite Only', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:au-founders-dinner-may26', type: 'Event', name: 'Australian Founders Dinner',
    subtitle: 'An intimate dinner for Australia\'s top founders', location: 'Quay Restaurant, Sydney',
    url: null, tags: ['Networking', 'Founders', 'Dinner'],
    metadata: { date: '2026-05-15', time: '7:00 PM AEST', capacity: 50, ticketPrice: 'By invitation', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:fintech-summit-syd-jun26', type: 'Event', name: 'Sydney Fintech Summit 2026',
    subtitle: 'The future of finance and digital payments in APAC', location: 'Stone & Chalk, Sydney',
    url: 'https://lu.ma/syd-fintech-26', tags: ['Fintech', 'Payments', 'Conference', 'APAC'],
    metadata: { date: '2026-06-11', endDate: '2026-06-12', time: '9:00 AM AEST', capacity: 600, ticketPrice: '$199', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:ai-hackathon-melb-jul26', type: 'Event', name: 'Melbourne AI Hackathon',
    subtitle: '48-hour hackathon building with Australian AI models', location: 'Melbourne Connect, Carlton',
    url: 'https://lu.ma/melb-ai-hack', tags: ['Hackathon', 'AI', 'ML', 'Builders'],
    metadata: { date: '2026-07-18', endDate: '2026-07-19', time: '9:00 AM AEST', capacity: 150, ticketPrice: 'Free', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:deep-tech-forum-aug26', type: 'Event', name: 'Deep Tech Forum Sydney',
    subtitle: 'Commercialising Australia\'s world-class research', location: 'Cicada Innovations, Eveleigh',
    url: 'https://lu.ma/deep-tech-syd', tags: ['Deep Tech', 'Science', 'Research', 'Commercialisation'],
    metadata: { date: '2026-08-20', time: '9:00 AM AEST', capacity: 300, ticketPrice: '$149', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:agri-tech-perth-sep26', type: 'Event', name: 'AgriTech Perth Conference',
    subtitle: 'Technology transforming Australian agriculture', location: 'Perth Convention Centre',
    url: 'https://lu.ma/agritech-perth', tags: ['AgriTech', 'FoodTech', 'Farming', 'Climate'],
    metadata: { date: '2026-09-10', endDate: '2026-09-11', time: '8:30 AM AWST', capacity: 250, ticketPrice: '$129', format: 'In-person', status: 'upcoming' },
  },
  {
    id: 'event:climate-tech-adelaide-oct26', type: 'Event', name: 'Climate Tech Adelaide',
    subtitle: 'Accelerating Australia\'s clean energy transition', location: 'Adelaide Convention Centre',
    url: 'https://lu.ma/climate-adelaide', tags: ['Climate', 'Clean Energy', 'Deep Tech', 'Impact'],
    metadata: { date: '2026-10-08', time: '9:00 AM ACST', capacity: 200, ticketPrice: '$99', format: 'In-person', status: 'upcoming' },
  },

  // ── Groups ──
  { id: 'group:au-founders-network',   type: 'Group', name: 'Australian Founders Network',   subtitle: 'Peer support for AU tech founders',           location: 'Australia-wide', url: null, tags: ['Founders', 'Networking', 'Peer Support'] },
  { id: 'group:au-vc-syndicate',       type: 'Group', name: 'Australian VC Syndicate',       subtitle: 'Co-investment group for AU VCs',              location: 'Australia-wide', url: null, tags: ['VC', 'Co-invest', 'Syndicate'] },
  { id: 'group:women-in-tech-au',      type: 'Group', name: 'Women in Tech Australia',       subtitle: 'Supporting women across the AU tech ecosystem', location: 'Australia-wide', url: null, tags: ['Diversity', 'Women', 'Inclusion', 'Tech'] },
  { id: 'group:deep-tech-collective',  type: 'Group', name: 'Deep Tech Collective',          subtitle: 'Bridging research and commercialisation',     location: 'Australia-wide', url: null, tags: ['Deep Tech', 'Science', 'CSIRO', 'Research'] },
];

// ─── Links ───────────────────────────────────────────────────────────────────

const links = [
  // Founders → Orgs
  { sourceId: 'person:mike-cannon-brookes', targetId: 'org:atlassian',          relationship: 'co-founded',      since: '2002' },
  { sourceId: 'person:scott-farquhar',      targetId: 'org:atlassian',          relationship: 'co-founded',      since: '2002' },
  { sourceId: 'person:melanie-perkins',     targetId: 'org:canva',              relationship: 'co-founded',      since: '2012' },
  { sourceId: 'person:cliff-obrecht',       targetId: 'org:canva',              relationship: 'co-founded',      since: '2012' },
  { sourceId: 'person:cameron-adams',       targetId: 'org:canva',              relationship: 'co-founded',      since: '2012' },
  { sourceId: 'person:luke-anear',          targetId: 'org:safetyculture',      relationship: 'founded',         since: '2004' },
  { sourceId: 'person:didier-elzinga',      targetId: 'org:culture-amp',        relationship: 'co-founded',      since: '2009' },
  { sourceId: 'person:jack-zhang',          targetId: 'org:airwallex',          relationship: 'co-founded',      since: '2015' },
  { sourceId: 'person:nick-molnar',         targetId: 'org:afterpay',           relationship: 'co-founded',      since: '2014' },
  { sourceId: 'person:anthony-eisen',       targetId: 'org:afterpay',           relationship: 'co-founded',      since: '2014' },
  { sourceId: 'person:jemma-green',         targetId: 'org:stone-chalk',        relationship: 'member of',       since: '2019' },
  { sourceId: 'person:fred-schebesta',      targetId: 'org:fishburners',        relationship: 'member of',       since: '2016' },
  { sourceId: 'person:matt-barrie',         targetId: 'org:stone-chalk',        relationship: 'advisor to',      since: '2018' },
  { sourceId: 'person:chris-gilmour',       targetId: 'org:fishburners',        relationship: 'alumnus of',      since: '2019' },
  { sourceId: 'person:tim-fung',            targetId: 'org:fishburners',        relationship: 'alumnus of',      since: '2012' },

  // VCs → VC Firms
  { sourceId: 'person:rick-baker',          targetId: 'org:blackbird',          relationship: 'is partner at',   since: '2012' },
  { sourceId: 'person:niki-scevak',         targetId: 'org:blackbird',          relationship: 'co-founded',      since: '2012' },
  { sourceId: 'person:fiona-pak-poy',       targetId: 'org:tenacious-ventures', relationship: 'founded',         since: '2017' },
  { sourceId: 'person:daniel-petre',        targetId: 'org:airtree',           relationship: 'co-founded',      since: '2014' },
  { sourceId: 'person:craig-blair',         targetId: 'org:airtree',           relationship: 'co-founded',      since: '2014' },
  { sourceId: 'person:paul-bassat',         targetId: 'org:square-peg',        relationship: 'co-founded',      since: '2012' },
  { sourceId: 'person:bill-bartee',         targetId: 'org:main-sequence',     relationship: 'leads',           since: '2017' },

  // Ecosystem leaders → Orgs
  { sourceId: 'person:kate-cornick',        targetId: 'org:launchvic',          relationship: 'leads',           since: '2016' },
  { sourceId: 'person:sally-ann-williams',  targetId: 'org:cicada-innovations', relationship: 'leads',           since: '2018' },
  { sourceId: 'person:alex-scandurra',      targetId: 'org:stone-chalk',        relationship: 'leads',           since: '2015' },
  { sourceId: 'person:jordan-grives',       targetId: 'org:fishburners',        relationship: 'leads',           since: '2021' },

  // VC → Portfolio investments
  { sourceId: 'org:blackbird',              targetId: 'org:canva',              relationship: 'invested in',     since: '2013' },
  { sourceId: 'org:blackbird',              targetId: 'org:safetyculture',      relationship: 'invested in',     since: '2016' },
  { sourceId: 'org:blackbird',              targetId: 'org:culture-amp',        relationship: 'invested in',     since: '2015' },
  { sourceId: 'org:airtree',               targetId: 'org:culture-amp',        relationship: 'invested in',     since: '2016' },
  { sourceId: 'org:airtree',               targetId: 'org:safetyculture',      relationship: 'invested in',     since: '2018' },
  { sourceId: 'org:square-peg',            targetId: 'org:airwallex',          relationship: 'invested in',     since: '2016' },
  { sourceId: 'org:square-peg',            targetId: 'org:canva',              relationship: 'invested in',     since: '2015' },
  { sourceId: 'org:main-sequence',         targetId: 'org:cicada-innovations', relationship: 'partners with',   since: '2018' },
  { sourceId: 'org:tenacious-ventures',    targetId: 'org:stone-chalk',        relationship: 'partners with',   since: '2019' },

  // People → Events
  { sourceId: 'person:melanie-perkins',     targetId: 'event:sxsw-sydney-2025',           relationship: 'spoke at',    since: '2025' },
  { sourceId: 'person:mike-cannon-brookes', targetId: 'event:au-tech-week-2025',           relationship: 'spoke at',    since: '2025' },
  { sourceId: 'person:jack-zhang',          targetId: 'event:startup-grind-melb-mar26',    relationship: 'spoke at',    since: '2026' },
  { sourceId: 'person:niki-scevak',         targetId: 'event:blackbird-demo-day-w26',      relationship: 'hosts',       since: '2026' },
  { sourceId: 'org:blackbird',              targetId: 'event:blackbird-demo-day-w26',      relationship: 'organises',   since: '2026' },
  { sourceId: 'person:alex-scandurra',      targetId: 'event:fintech-summit-syd-jun26',    relationship: 'hosts',       since: '2026' },
  { sourceId: 'org:stone-chalk',            targetId: 'event:fintech-summit-syd-jun26',    relationship: 'organises',   since: '2026' },
  { sourceId: 'person:sally-ann-williams',  targetId: 'event:deep-tech-forum-aug26',       relationship: 'hosts',       since: '2026' },
  { sourceId: 'org:cicada-innovations',     targetId: 'event:deep-tech-forum-aug26',       relationship: 'organises',   since: '2026' },
  { sourceId: 'person:fiona-pak-poy',       targetId: 'event:agri-tech-perth-sep26',       relationship: 'spoke at',    since: '2026' },
  { sourceId: 'person:jemma-green',         targetId: 'event:climate-tech-adelaide-oct26', relationship: 'spoke at',    since: '2026' },
  { sourceId: 'person:bill-bartee',         targetId: 'event:deep-tech-forum-aug26',       relationship: 'spoke at',    since: '2026' },

  // People → Groups
  { sourceId: 'person:mike-cannon-brookes', targetId: 'group:au-founders-network',   relationship: 'member of', since: '2020' },
  { sourceId: 'person:melanie-perkins',     targetId: 'group:au-founders-network',   relationship: 'member of', since: '2020' },
  { sourceId: 'person:nick-molnar',         targetId: 'group:au-founders-network',   relationship: 'member of', since: '2020' },
  { sourceId: 'person:didier-elzinga',      targetId: 'group:au-founders-network',   relationship: 'member of', since: '2021' },
  { sourceId: 'person:rick-baker',          targetId: 'group:au-vc-syndicate',       relationship: 'member of', since: '2019' },
  { sourceId: 'person:paul-bassat',         targetId: 'group:au-vc-syndicate',       relationship: 'member of', since: '2019' },
  { sourceId: 'person:daniel-petre',        targetId: 'group:au-vc-syndicate',       relationship: 'member of', since: '2019' },
  { sourceId: 'person:fiona-pak-poy',       targetId: 'group:au-vc-syndicate',       relationship: 'member of', since: '2020' },
  { sourceId: 'person:melanie-perkins',     targetId: 'group:women-in-tech-au',      relationship: 'member of', since: '2018' },
  { sourceId: 'person:fiona-pak-poy',       targetId: 'group:women-in-tech-au',      relationship: 'member of', since: '2019' },
  { sourceId: 'person:kate-cornick',        targetId: 'group:women-in-tech-au',      relationship: 'member of', since: '2018' },
  { sourceId: 'person:sally-ann-williams',  targetId: 'group:women-in-tech-au',      relationship: 'member of', since: '2019' },
  { sourceId: 'person:bill-bartee',         targetId: 'group:deep-tech-collective',  relationship: 'member of', since: '2018' },
  { sourceId: 'person:sally-ann-williams',  targetId: 'group:deep-tech-collective',  relationship: 'member of', since: '2018' },
  { sourceId: 'person:jemma-green',         targetId: 'group:deep-tech-collective',  relationship: 'member of', since: '2020' },

  // Knows / collaborates
  { sourceId: 'person:mike-cannon-brookes', targetId: 'person:scott-farquhar',      relationship: 'co-founded with', since: '2002' },
  { sourceId: 'person:melanie-perkins',     targetId: 'person:cliff-obrecht',       relationship: 'co-founded with', since: '2012' },
  { sourceId: 'person:nick-molnar',         targetId: 'person:anthony-eisen',       relationship: 'co-founded with', since: '2014' },
  { sourceId: 'person:mike-cannon-brookes', targetId: 'person:melanie-perkins',     relationship: 'knows',           since: '2015' },
  { sourceId: 'person:rick-baker',          targetId: 'person:paul-bassat',         relationship: 'co-invested with', since: '2016' },
  { sourceId: 'person:daniel-petre',        targetId: 'person:craig-blair',         relationship: 'co-founded with', since: '2014' },
];

// ─── Attendees ───────────────────────────────────────────────────────────────

const attendees = [
  // SXSW Sydney 2025
  { id: 'att:sxsw-001', eventId: 'event:sxsw-sydney-2025', personId: 'person:melanie-perkins',     email: 'mel@canva.com',           companyName: 'Canva',              roleTitle: 'CEO',               status: 'attended' },
  { id: 'att:sxsw-002', eventId: 'event:sxsw-sydney-2025', personId: 'person:mike-cannon-brookes', email: 'mike@atlassian.com',      companyName: 'Atlassian',          roleTitle: 'Co-CEO',            status: 'attended' },
  { id: 'att:sxsw-003', eventId: 'event:sxsw-sydney-2025', personId: 'person:mark-pesce',          email: 'mark@markpesce.com',      companyName: 'Independent',        roleTitle: 'Futurist',          status: 'attended' },
  { id: 'att:sxsw-004', eventId: 'event:sxsw-sydney-2025', personId: null,                         email: 'sophie@designstudio.com', companyName: 'DesignStudio AU',    roleTitle: 'Creative Director', status: 'attended' },
  { id: 'att:sxsw-005', eventId: 'event:sxsw-sydney-2025', personId: null,                         email: 'liam@synthwave.io',       companyName: 'Synthwave',          roleTitle: 'CTO',               status: 'attended' },

  // AU Tech Week 2025
  { id: 'att:atw-001', eventId: 'event:au-tech-week-2025', personId: 'person:mike-cannon-brookes', email: 'mike@atlassian.com',      companyName: 'Atlassian',          roleTitle: 'Co-CEO',            status: 'attended' },
  { id: 'att:atw-002', eventId: 'event:au-tech-week-2025', personId: 'person:scott-farquhar',      email: 'scott@atlassian.com',     companyName: 'Atlassian',          roleTitle: 'Co-CEO',            status: 'attended' },
  { id: 'att:atw-003', eventId: 'event:au-tech-week-2025', personId: 'person:niki-scevak',         email: 'niki@blackbird.vc',       companyName: 'Blackbird Ventures', roleTitle: 'Co-founder',        status: 'attended' },
  { id: 'att:atw-004', eventId: 'event:au-tech-week-2025', personId: 'person:kate-cornick',        email: 'kate@launchvic.org',      companyName: 'LaunchVic',          roleTitle: 'CEO',               status: 'attended' },
  { id: 'att:atw-005', eventId: 'event:au-tech-week-2025', personId: null,                         email: 'raj@ausaas.com',          companyName: 'AuSaaS',             roleTitle: 'Founder',           status: 'attended' },

  // Startup Grind Melbourne
  { id: 'att:sg-001', eventId: 'event:startup-grind-melb-mar26', personId: 'person:jack-zhang',     email: 'jack@airwallex.com',     companyName: 'Airwallex',          roleTitle: 'CEO',               status: 'attended' },
  { id: 'att:sg-002', eventId: 'event:startup-grind-melb-mar26', personId: 'person:paul-bassat',    email: 'paul@squarepeg.com',     companyName: 'Square Peg Capital', roleTitle: 'Co-founder',        status: 'attended' },
  { id: 'att:sg-003', eventId: 'event:startup-grind-melb-mar26', personId: null,                    email: 'tanya@finapp.com.au',    companyName: 'FinApp',             roleTitle: 'CEO',               status: 'attended' },

  // Blackbird Demo Day
  { id: 'att:bb-001', eventId: 'event:blackbird-demo-day-w26', personId: 'person:rick-baker',       email: 'rick@blackbird.vc',      companyName: 'Blackbird Ventures', roleTitle: 'Partner',           status: 'registered' },
  { id: 'att:bb-002', eventId: 'event:blackbird-demo-day-w26', personId: 'person:niki-scevak',      email: 'niki@blackbird.vc',      companyName: 'Blackbird Ventures', roleTitle: 'Co-founder',        status: 'registered' },
  { id: 'att:bb-003', eventId: 'event:blackbird-demo-day-w26', personId: 'person:craig-blair',      email: 'craig@airtree.vc',       companyName: 'AirTree Ventures',   roleTitle: 'Co-founder',        status: 'registered' },
  { id: 'att:bb-004', eventId: 'event:blackbird-demo-day-w26', personId: null,                      email: 'zara@healthtech.io',     companyName: 'HealthTech AU',      roleTitle: 'Founder',           status: 'registered' },

  // Fintech Summit
  { id: 'att:ft-001', eventId: 'event:fintech-summit-syd-jun26', personId: 'person:alex-scandurra', email: 'alex@stoneandchalk.com', companyName: 'Stone & Chalk',      roleTitle: 'CEO',               status: 'registered' },
  { id: 'att:ft-002', eventId: 'event:fintech-summit-syd-jun26', personId: 'person:fred-schebesta', email: 'fred@finder.com.au',     companyName: 'Finder',             roleTitle: 'Co-founder',        status: 'registered' },
  { id: 'att:ft-003', eventId: 'event:fintech-summit-syd-jun26', personId: null,                    email: 'nina@payright.com.au',   companyName: 'PayRight',           roleTitle: 'CEO',               status: 'registered' },

  // AI Hackathon
  { id: 'att:ai-001', eventId: 'event:ai-hackathon-melb-jul26', personId: null, email: 'dev1@builderscrew.au',  companyName: 'Independent',   roleTitle: 'Software Engineer', status: 'registered' },
  { id: 'att:ai-002', eventId: 'event:ai-hackathon-melb-jul26', personId: null, email: 'dev2@builderscrew.au',  companyName: 'Independent',   roleTitle: 'ML Engineer',       status: 'registered' },
  { id: 'att:ai-003', eventId: 'event:ai-hackathon-melb-jul26', personId: null, email: 'casey@aiapps.com.au',   companyName: 'AI Apps AU',    roleTitle: 'Founder',           status: 'registered' },

  // AgriTech Perth
  { id: 'att:ag-001', eventId: 'event:agri-tech-perth-sep26', personId: 'person:fiona-pak-poy',    email: 'fiona@tenacious.vc',     companyName: 'Tenacious Ventures', roleTitle: 'Founder',           status: 'registered' },
  { id: 'att:ag-002', eventId: 'event:agri-tech-perth-sep26', personId: null,                      email: 'tom@farmtech.com.au',    companyName: 'FarmTech AU',        roleTitle: 'CTO',               status: 'registered' },
];

// ─── Persons (profiles) ─────────────────────────────────────────────────────

const persons = [
  {
    id: 'person:mike-cannon-brookes', userId: 'au-user-001', name: 'Mike Cannon-Brookes',
    subtitle: 'Co-founder & Co-CEO, Atlassian', bio: 'Co-founded Atlassian in 2002 with Scott Farquhar. Passionate about enterprise software, renewable energy, and backing ambitious Australian founders. Active climate tech investor through Grok Ventures.',
    location: 'Sydney, NSW', website: 'https://atlassian.com', linkedinUrl: 'https://linkedin.com/in/mikecb', twitterUrl: 'https://twitter.com/maboroshi',
    phone: '+61 400 000 001', pronouns: 'he/him', openToWork: false, tags: ['Enterprise', 'SaaS', 'Climate', 'Investing'], hasOnboarded: true,
  },
  {
    id: 'person:melanie-perkins', userId: 'au-user-002', name: 'Melanie Perkins',
    subtitle: 'CEO & Co-founder, Canva', bio: 'Started Canva in 2012 with a mission to empower everyone to design. Grew from a Perth startup to a global platform used by over 170 million people. Committed to the Canva Foundation and giving back.',
    location: 'Sydney, NSW', website: 'https://canva.com', linkedinUrl: 'https://linkedin.com/in/melanieperkins', twitterUrl: 'https://twitter.com/melanieperkins',
    phone: '+61 400 000 002', pronouns: 'she/her', openToWork: false, tags: ['Design', 'SaaS', 'EdTech', 'Philanthropy'], hasOnboarded: true,
  },
  {
    id: 'person:scott-farquhar', userId: 'au-user-003', name: 'Scott Farquhar',
    subtitle: 'Co-founder & Co-CEO, Atlassian', bio: 'Built Atlassian from a $10K credit card loan into one of Australia\'s most valuable tech companies. Passionate about teamwork software, philanthropy through the Pledge 1% movement, and supporting the next generation of Australian founders.',
    location: 'Sydney, NSW', website: 'https://atlassian.com', linkedinUrl: 'https://linkedin.com/in/scottfarquhar', twitterUrl: null,
    phone: '+61 400 000 003', pronouns: 'he/him', openToWork: false, tags: ['Enterprise', 'SaaS', 'Philanthropy'], hasOnboarded: true,
  },
  {
    id: 'person:luke-anear', userId: 'au-user-004', name: 'Luke Anear',
    subtitle: 'CEO & Founder, SafetyCulture', bio: 'Founded SafetyCulture in Townsville in 2004 to help frontline workers do their jobs more safely. Our iAuditor platform is now used by over 75,000 organisations worldwide. Regional Australia can build world-class tech.',
    location: 'Sydney, NSW', website: 'https://safetyculture.com', linkedinUrl: 'https://linkedin.com/in/lukeanear', twitterUrl: 'https://twitter.com/lukeanear',
    phone: '+61 400 000 004', pronouns: 'he/him', openToWork: false, tags: ['Safety', 'Mobile', 'IoT', 'Regional'], hasOnboarded: true,
  },
  {
    id: 'person:didier-elzinga', userId: 'au-user-005', name: 'Didier Elzinga',
    subtitle: 'CEO & Co-founder, Culture Amp', bio: 'Former film visual effects artist turned people analytics CEO. Co-founded Culture Amp in 2009 to put culture first in the workplace. We help 6,500+ companies create better employee experiences through data and insights.',
    location: 'Melbourne, VIC', website: 'https://cultureamp.com', linkedinUrl: 'https://linkedin.com/in/didierelzinga', twitterUrl: 'https://twitter.com/didierelzinga',
    phone: '+61 400 000 005', pronouns: 'he/him', openToWork: false, tags: ['HR Tech', 'People Analytics', 'Culture'], hasOnboarded: true,
  },
  {
    id: 'person:jack-zhang', userId: 'au-user-006', name: 'Jack Zhang',
    subtitle: 'CEO & Co-founder, Airwallex', bio: 'Co-founded Airwallex in a Melbourne coffee shop in 2015 to solve the pain of cross-border payments. We now process billions in transactions for businesses across 150+ countries. Melbourne to the world.',
    location: 'Melbourne, VIC', website: 'https://airwallex.com', linkedinUrl: 'https://linkedin.com/in/jackzhang-airwallex', twitterUrl: null,
    phone: '+61 400 000 006', pronouns: 'he/him', openToWork: false, tags: ['Fintech', 'Payments', 'Global', 'B2B'], hasOnboarded: true,
  },
  {
    id: 'person:fiona-pak-poy', userId: 'au-user-007', name: 'Fiona Pak-Poy',
    subtitle: 'Founder, Tenacious Ventures', bio: 'Founded Tenacious Ventures to invest in the future of food and agriculture. Australia feeds 80 million people — with the right technology, we can feed billions more sustainably. Proud South Australian.',
    location: 'Adelaide, SA', website: 'https://tenacious.vc', linkedinUrl: 'https://linkedin.com/in/fionapakpoy', twitterUrl: 'https://twitter.com/fionapakpoy',
    phone: '+61 400 000 007', pronouns: 'she/her', openToWork: false, tags: ['AgriTech', 'FoodTech', 'Impact', 'VC'], hasOnboarded: true,
  },
  {
    id: 'person:admin-user', userId: 'au-user-008', name: 'Admin User',
    subtitle: 'Community Manager, AU Tech Ecosystem', bio: 'Managing the Australian Tech Ecosystem community. Connecting founders, investors, and builders across the country.',
    location: 'Sydney, NSW', website: null, linkedinUrl: null, twitterUrl: null,
    phone: null, pronouns: null, openToWork: false, tags: ['Community', 'Admin'], hasOnboarded: true,
  },
];

// ─── Work Experience ─────────────────────────────────────────────────────────

const workExperience = [
  // MCB
  { id: 'we-001', personId: 'person:mike-cannon-brookes', title: 'Co-founder & Co-CEO', company: 'Atlassian',       location: 'Sydney, NSW',    startDate: '2002-01', endDate: null, current: true,  description: 'Co-founded Atlassian, building collaboration tools used by 300,000+ organisations worldwide. Led growth from bootstrap to ASX/NASDAQ dual listing.', sortOrder: 0 },
  { id: 'we-002', personId: 'person:mike-cannon-brookes', title: 'Founder',             company: 'Grok Ventures',   location: 'Sydney, NSW',    startDate: '2014-01', endDate: null, current: true,  description: 'Private investment vehicle focused on climate tech, renewable energy, and Australian startups.', sortOrder: 1 },

  // Melanie Perkins
  { id: 'we-003', personId: 'person:melanie-perkins', title: 'CEO & Co-founder',       company: 'Canva',          location: 'Sydney, NSW',    startDate: '2012-06', endDate: null, current: true,  description: 'Founded Canva to democratise design. Grew to 170M+ monthly active users and $40B valuation.', sortOrder: 0 },
  { id: 'we-004', personId: 'person:melanie-perkins', title: 'Co-founder',             company: 'Fusion Books',   location: 'Perth, WA',      startDate: '2007-01', endDate: '2012-05', current: false, description: 'Built an online yearbook design tool used by hundreds of Australian schools.', sortOrder: 1 },

  // Scott Farquhar
  { id: 'we-005', personId: 'person:scott-farquhar', title: 'Co-founder & Co-CEO',    company: 'Atlassian',      location: 'Sydney, NSW',    startDate: '2002-01', endDate: null, current: true,  description: 'Co-founded Atlassian. Championed the Pledge 1% movement for corporate philanthropy.', sortOrder: 0 },

  // Luke Anear
  { id: 'we-006', personId: 'person:luke-anear', title: 'CEO & Founder',           company: 'SafetyCulture',  location: 'Sydney, NSW',    startDate: '2004-01', endDate: null, current: true,  description: 'Founded SafetyCulture in Townsville. Built iAuditor into the world\'s #1 inspection platform.', sortOrder: 0 },

  // Didier Elzinga
  { id: 'we-007', personId: 'person:didier-elzinga', title: 'CEO & Co-founder',       company: 'Culture Amp',    location: 'Melbourne, VIC', startDate: '2009-01', endDate: null, current: true,  description: 'Built Culture Amp into the leading employee experience platform, serving 6,500+ companies.', sortOrder: 0 },
  { id: 'we-008', personId: 'person:didier-elzinga', title: 'CEO',                    company: 'Rising Sun Pictures', location: 'Adelaide, SA', startDate: '2001-01', endDate: '2008-12', current: false, description: 'Led a visual effects studio working on films including Harry Potter and Superman Returns.', sortOrder: 1 },

  // Jack Zhang
  { id: 'we-009', personId: 'person:jack-zhang', title: 'CEO & Co-founder',       company: 'Airwallex',      location: 'Melbourne, VIC', startDate: '2015-01', endDate: null, current: true,  description: 'Co-founded Airwallex to simplify global payments. Now processing billions in cross-border transactions.', sortOrder: 0 },
  { id: 'we-010', personId: 'person:jack-zhang', title: 'Associate',              company: 'NAB',            location: 'Melbourne, VIC', startDate: '2012-01', endDate: '2014-12', current: false, description: 'Worked in institutional banking before co-founding Airwallex.', sortOrder: 1 },

  // Fiona Pak-Poy
  { id: 'we-011', personId: 'person:fiona-pak-poy', title: 'Founder & Managing Partner', company: 'Tenacious Ventures', location: 'Adelaide, SA', startDate: '2017-01', endDate: null, current: true, description: 'Founded Australia\'s first dedicated agrifood tech VC fund.', sortOrder: 0 },
  { id: 'we-012', personId: 'person:fiona-pak-poy', title: 'Director',                  company: 'KPMG Australia',      location: 'Adelaide, SA', startDate: '2008-01', endDate: '2016-12', current: false, description: 'Advisory work across agriculture, food, and natural resources sectors.', sortOrder: 1 },

  // Admin
  { id: 'we-013', personId: 'person:admin-user', title: 'Community Manager', company: 'AU Tech Ecosystem', location: 'Sydney, NSW', startDate: '2024-01', endDate: null, current: true, description: 'Managing the Australian Tech Ecosystem community platform.', sortOrder: 0 },
];

// ─── Education ───────────────────────────────────────────────────────────────

const education = [
  { id: 'ed-001', personId: 'person:mike-cannon-brookes', school: 'University of New South Wales',     degree: 'Bachelor of Science',        fieldOfStudy: 'Information Systems', startYear: 1998, endYear: 2002, description: null, sortOrder: 0 },
  { id: 'ed-002', personId: 'person:scott-farquhar',      school: 'University of New South Wales',     degree: 'Bachelor of Business',       fieldOfStudy: 'Information Technology', startYear: 1998, endYear: 2002, description: 'Met Mike Cannon-Brookes here — the rest is history.', sortOrder: 0 },
  { id: 'ed-003', personId: 'person:melanie-perkins',     school: 'University of Western Australia',   degree: 'Bachelor of Arts',           fieldOfStudy: 'Communications & Commerce', startYear: 2007, endYear: 2011, description: 'Dropped out in final year to pursue Canva full-time.', sortOrder: 0 },
  { id: 'ed-004', personId: 'person:didier-elzinga',      school: 'Flinders University',               degree: 'Bachelor of Science',        fieldOfStudy: 'Computer Science', startYear: 1994, endYear: 1997, description: null, sortOrder: 0 },
  { id: 'ed-005', personId: 'person:jack-zhang',          school: 'University of Melbourne',           degree: 'Master of Finance',          fieldOfStudy: 'Finance', startYear: 2010, endYear: 2012, description: null, sortOrder: 0 },
  { id: 'ed-006', personId: 'person:jack-zhang',          school: 'University of Melbourne',           degree: 'Bachelor of Commerce',       fieldOfStudy: 'Accounting', startYear: 2006, endYear: 2010, description: null, sortOrder: 1 },
  { id: 'ed-007', personId: 'person:fiona-pak-poy',       school: 'University of Adelaide',            degree: 'Bachelor of Commerce',       fieldOfStudy: 'Economics', startYear: 1996, endYear: 2000, description: null, sortOrder: 0 },
  { id: 'ed-008', personId: 'person:luke-anear',          school: 'James Cook University',             degree: 'Bachelor of Business',       fieldOfStudy: 'Management', startYear: 1998, endYear: 2002, description: 'Studied in Townsville — founded SafetyCulture here too.', sortOrder: 0 },
  { id: 'ed-009', personId: 'person:admin-user',            school: 'University of Technology Sydney',   degree: 'Bachelor of Communications', fieldOfStudy: 'Digital Media', startYear: 2018, endYear: 2022, description: null, sortOrder: 0 },
];

// ─── Certifications ──────────────────────────────────────────────────────────

const certifications = [
  { id: 'cert-001', personId: 'person:mike-cannon-brookes', name: 'AICD Company Director',    issuingOrg: 'Australian Institute of Company Directors', issueDate: '2018', expiryDate: null, credentialId: null, credentialUrl: null, sortOrder: 0 },
  { id: 'cert-002', personId: 'person:fiona-pak-poy',       name: 'AICD Company Director',    issuingOrg: 'Australian Institute of Company Directors', issueDate: '2015', expiryDate: null, credentialId: null, credentialUrl: null, sortOrder: 0 },
  { id: 'cert-003', personId: 'person:didier-elzinga',      name: 'Certified Scrum Master',   issuingOrg: 'Scrum Alliance',                            issueDate: '2010', expiryDate: null, credentialId: 'CSM-2010-4521', credentialUrl: null, sortOrder: 0 },
  { id: 'cert-004', personId: 'person:jack-zhang',          name: 'CPA Australia',            issuingOrg: 'CPA Australia',                              issueDate: '2013', expiryDate: null, credentialId: null, credentialUrl: null, sortOrder: 0 },
];

// ─── Profile Languages ───────────────────────────────────────────────────────

const profileLanguages = [
  { id: 'lang-001', personId: 'person:mike-cannon-brookes', language: 'English',   proficiency: 'native',         sortOrder: 0 },
  { id: 'lang-002', personId: 'person:melanie-perkins',     language: 'English',   proficiency: 'native',         sortOrder: 0 },
  { id: 'lang-003', personId: 'person:jack-zhang',          language: 'Mandarin',  proficiency: 'native',         sortOrder: 0 },
  { id: 'lang-004', personId: 'person:jack-zhang',          language: 'English',   proficiency: 'fluent',         sortOrder: 1 },
  { id: 'lang-005', personId: 'person:didier-elzinga',      language: 'English',   proficiency: 'native',         sortOrder: 0 },
  { id: 'lang-006', personId: 'person:didier-elzinga',      language: 'French',    proficiency: 'conversational', sortOrder: 1 },
  { id: 'lang-007', personId: 'person:fiona-pak-poy',       language: 'English',   proficiency: 'native',         sortOrder: 0 },
  { id: 'lang-008', personId: 'person:luke-anear',          language: 'English',   proficiency: 'native',         sortOrder: 0 },
];

// ─── Conversations ───────────────────────────────────────────────────────────

const conversations = [
  { id: 'conv-001', type: 'DM',    name: null,                  dmKey: 'au-user-001_au-user-002', createdById: 'au-user-001' },
  { id: 'conv-002', type: 'DM',    name: null,                  dmKey: 'au-user-005_au-user-006', createdById: 'au-user-006' },
  { id: 'conv-003', type: 'GROUP', name: 'AU Founders Chat',    dmKey: null,                      createdById: 'au-user-001' },
  { id: 'conv-004', type: 'GROUP', name: 'VC Syndicate',        dmKey: null,                      createdById: 'au-user-007' },
];

const conversationMembers = [
  // DM: MCB <-> Mel
  { id: 'cm-001', conversationId: 'conv-001', userId: 'au-user-001', role: 'MEMBER' },
  { id: 'cm-002', conversationId: 'conv-001', userId: 'au-user-002', role: 'MEMBER' },
  // DM: Didier <-> Jack
  { id: 'cm-003', conversationId: 'conv-002', userId: 'au-user-005', role: 'MEMBER' },
  { id: 'cm-004', conversationId: 'conv-002', userId: 'au-user-006', role: 'MEMBER' },
  // GROUP: AU Founders Chat
  { id: 'cm-005', conversationId: 'conv-003', userId: 'au-user-001', role: 'ADMIN' },
  { id: 'cm-006', conversationId: 'conv-003', userId: 'au-user-002', role: 'MEMBER' },
  { id: 'cm-007', conversationId: 'conv-003', userId: 'au-user-004', role: 'MEMBER' },
  { id: 'cm-008', conversationId: 'conv-003', userId: 'au-user-005', role: 'MEMBER' },
  // GROUP: VC Syndicate
  { id: 'cm-009', conversationId: 'conv-004', userId: 'au-user-007', role: 'ADMIN' },
  { id: 'cm-010', conversationId: 'conv-004', userId: 'au-user-001', role: 'MEMBER' },
  { id: 'cm-011', conversationId: 'conv-004', userId: 'au-user-006', role: 'MEMBER' },
];

const messages = [
  // DM: MCB <-> Mel
  { id: 'msg-001', conversationId: 'conv-001', senderId: 'au-user-001', text: 'Hey Mel, saw the Canva AI launch — absolutely brilliant. Would love to chat about what you\'re seeing in the enterprise space.' },
  { id: 'msg-002', conversationId: 'conv-001', senderId: 'au-user-002', text: 'Thanks Mike! Yeah it\'s been wild. Enterprise is growing fast for us. Let\'s grab a coffee next week? I\'ll be in Surry Hills.' },
  { id: 'msg-003', conversationId: 'conv-001', senderId: 'au-user-001', text: 'Done. Thursday arvo work? I know a great spot on Crown St.' },
  { id: 'msg-004', conversationId: 'conv-001', senderId: 'au-user-002', text: 'Perfect, see you then!' },

  // DM: Didier <-> Jack
  { id: 'msg-005', conversationId: 'conv-002', senderId: 'au-user-006', text: 'Didier, are you heading to the Melbourne AI Hackathon in July? Would be great to have Culture Amp there as a sponsor.' },
  { id: 'msg-006', conversationId: 'conv-002', senderId: 'au-user-005', text: 'Yeah keen to have a look. We\'ve been doing a lot with AI for people analytics. Let me check with the team and get back to you.' },
  { id: 'msg-007', conversationId: 'conv-002', senderId: 'au-user-006', text: 'Legend. No rush, just ping me when you know. Reckon it\'ll be a good one this year.' },

  // GROUP: AU Founders Chat
  { id: 'msg-008', conversationId: 'conv-003', senderId: 'au-user-001', text: 'Alright founders — who\'s coming to the AU Founders Dinner in May? Quay Restaurant, should be a ripper.' },
  { id: 'msg-009', conversationId: 'conv-003', senderId: 'au-user-002', text: 'Wouldn\'t miss it! Last year was incredible. Is Cliff coming too?' },
  { id: 'msg-010', conversationId: 'conv-003', senderId: 'au-user-004', text: 'Count me in. Flying down from Sydney. Anyone want to share a cab from the airport?' },
  { id: 'msg-011', conversationId: 'conv-003', senderId: 'au-user-005', text: 'I\'ll be there. Also happy to give a quick update on what we\'re seeing in the people analytics space if anyone\'s interested.' },
  { id: 'msg-012', conversationId: 'conv-003', senderId: 'au-user-001', text: 'Always interested, Didier. Let\'s make it happen. I\'ll send the final details next week.' },

  // GROUP: VC Syndicate
  { id: 'msg-013', conversationId: 'conv-004', senderId: 'au-user-007', text: 'Team, just had a great pitch from an agritech startup out of Wagga Wagga. Precision irrigation using satellite data. Seed round, $2M.' },
  { id: 'msg-014', conversationId: 'conv-004', senderId: 'au-user-001', text: 'Sounds interesting. What\'s the tech stack look like? Happy to take a closer look from the Grok side.' },
  { id: 'msg-015', conversationId: 'conv-004', senderId: 'au-user-006', text: 'We\'ve seen a few in this space. The ones with real farmer adoption tend to win. Happy to compare notes.' },
  { id: 'msg-016', conversationId: 'conv-004', senderId: 'au-user-007', text: 'Great, I\'ll share the deck in the resources section. They\'ve got 40 farms onboarded already which is solid for pre-seed.' },
  { id: 'msg-017', conversationId: 'conv-004', senderId: 'au-user-001', text: 'That\'s promising. Regional adoption is always the hardest part. Let\'s set up a call with the founders.' },
  { id: 'msg-018', conversationId: 'conv-004', senderId: 'au-user-007', text: 'On it. Will send calendar invites this arvo.' },
];

// ─── CRM: Private Columns ────────────────────────────────────────────────────

const privateColumns = [
  { id: 'pc-001', userId: 'au-user-008', communityId: COMMUNITY, nodeType: null,           columnKey: 'deal-status',    columnName: 'Deal Status',    columnType: 'select', options: JSON.stringify(["Prospecting", "In Progress", "Closed Won", "Closed Lost"]), position: 0 },
  { id: 'pc-002', userId: 'au-user-008', communityId: COMMUNITY, nodeType: null,           columnKey: 'personal-notes', columnName: 'Personal Notes', columnType: 'text',   options: null, position: 1 },
  { id: 'pc-003', userId: 'au-user-008', communityId: COMMUNITY, nodeType: 'Organization', columnKey: 'priority',       columnName: 'Priority',       columnType: 'select', options: JSON.stringify(["High", "Medium", "Low"]), position: 2 },
];

const privateColumnValues = [
  { id: 'pcv-001', userId: 'au-user-008', nodeId: 'org:canva',           columnId: 'pc-003', value: 'High' },
  { id: 'pcv-002', userId: 'au-user-008', nodeId: 'org:airwallex',       columnId: 'pc-003', value: 'High' },
  { id: 'pcv-003', userId: 'au-user-008', nodeId: 'org:safetyculture',   columnId: 'pc-003', value: 'Medium' },
  { id: 'pcv-004', userId: 'au-user-008', nodeId: 'org:afterpay',        columnId: 'pc-003', value: 'Low' },
  { id: 'pcv-005', userId: 'au-user-008', nodeId: 'person:melanie-perkins', columnId: 'pc-001', value: 'In Progress' },
  { id: 'pcv-006', userId: 'au-user-008', nodeId: 'person:jack-zhang',      columnId: 'pc-001', value: 'Prospecting' },
  { id: 'pcv-007', userId: 'au-user-008', nodeId: 'person:melanie-perkins', columnId: 'pc-002', value: 'Met at SXSW Sydney, very engaged. Follow up re: community partnership.' },
  { id: 'pcv-008', userId: 'au-user-008', nodeId: 'person:rick-baker',      columnId: 'pc-002', value: 'Interested in sponsoring AU Founders Dinner. Circle back in April.' },
];

// ─── CRM: Community Columns ──────────────────────────────────────────────────

const communityColumns = [
  { id: 'cc-001', communityId: COMMUNITY, nodeType: 'Organization', columnKey: 'funding-stage', columnName: 'Funding Stage', columnType: 'select', options: JSON.stringify(["Pre-seed", "Seed", "Series A", "Series B", "Series C+", "Public", "Acquired"]), position: 0 },
  { id: 'cc-002', communityId: COMMUNITY, nodeType: 'Organization', columnKey: 'founded-year',  columnName: 'Founded Year',  columnType: 'text',   options: null, position: 1 },
];

const communityColumnValues = [
  { id: 'ccv-001', communityId: COMMUNITY, nodeId: 'org:atlassian',          columnKey: 'funding-stage', columnId: 'cc-001', value: 'Public',   contributedById: 'au-user-008' },
  { id: 'ccv-002', communityId: COMMUNITY, nodeId: 'org:canva',             columnKey: 'funding-stage', columnId: 'cc-001', value: 'Series C+', contributedById: 'au-user-008' },
  { id: 'ccv-003', communityId: COMMUNITY, nodeId: 'org:safetyculture',     columnKey: 'funding-stage', columnId: 'cc-001', value: 'Series C+', contributedById: 'au-user-008' },
  { id: 'ccv-004', communityId: COMMUNITY, nodeId: 'org:culture-amp',       columnKey: 'funding-stage', columnId: 'cc-001', value: 'Series C+', contributedById: 'au-user-005' },
  { id: 'ccv-005', communityId: COMMUNITY, nodeId: 'org:airwallex',         columnKey: 'funding-stage', columnId: 'cc-001', value: 'Series C+', contributedById: 'au-user-006' },
  { id: 'ccv-006', communityId: COMMUNITY, nodeId: 'org:afterpay',          columnKey: 'funding-stage', columnId: 'cc-001', value: 'Acquired',  contributedById: 'au-user-008' },
  { id: 'ccv-007', communityId: COMMUNITY, nodeId: 'org:atlassian',         columnKey: 'founded-year',  columnId: 'cc-002', value: '2002',      contributedById: 'au-user-001' },
  { id: 'ccv-008', communityId: COMMUNITY, nodeId: 'org:canva',             columnKey: 'founded-year',  columnId: 'cc-002', value: '2012',      contributedById: 'au-user-002' },
  { id: 'ccv-009', communityId: COMMUNITY, nodeId: 'org:safetyculture',     columnKey: 'founded-year',  columnId: 'cc-002', value: '2004',      contributedById: 'au-user-004' },
  { id: 'ccv-010', communityId: COMMUNITY, nodeId: 'org:culture-amp',       columnKey: 'founded-year',  columnId: 'cc-002', value: '2009',      contributedById: 'au-user-005' },
  { id: 'ccv-011', communityId: COMMUNITY, nodeId: 'org:airwallex',         columnKey: 'founded-year',  columnId: 'cc-002', value: '2015',      contributedById: 'au-user-006' },
  { id: 'ccv-012', communityId: COMMUNITY, nodeId: 'org:afterpay',          columnKey: 'founded-year',  columnId: 'cc-002', value: '2014',      contributedById: 'au-user-008' },
];

// ─── Resources ───────────────────────────────────────────────────────────────

const resources = [
  { id: 'res-001', communityId: COMMUNITY, name: 'AU Startup Ecosystem Map 2026',  fileType: 'pdf',  fileUrl: '/uploads/resources/au-ecosystem-map-2026.pdf',  fileSize: 2450000, uploadedBy: 'au-user-008' },
  { id: 'res-002', communityId: COMMUNITY, name: 'Investor Contact List',          fileType: 'csv',  fileUrl: '/uploads/resources/investor-contacts.csv',       fileSize: 84000,   uploadedBy: 'au-user-001' },
  { id: 'res-003', communityId: COMMUNITY, name: 'Event Planning Template',        fileType: 'xlsx', fileUrl: '/uploads/resources/event-planning-template.xlsx', fileSize: 156000,  uploadedBy: 'au-user-007' },
];

const resourceComments = [
  { id: 'rc-001', resourceId: 'res-001', cellRef: null,  author: 'au-user-001', content: 'Great overview. Could we add the Canberra startup scene? It\'s growing fast with government tech.' },
  { id: 'rc-002', resourceId: 'res-001', cellRef: null,  author: 'au-user-002', content: 'Love this! Canva would be happy to help design a visual version of this map.' },
  { id: 'rc-003', resourceId: 'res-002', cellRef: 'B12', author: 'au-user-007', content: 'Tenacious Ventures email should be updated — we moved to hello@tenacious.vc.' },
  { id: 'rc-004', resourceId: 'res-002', cellRef: null,  author: 'au-user-005', content: 'Missing a few Melbourne-based VCs. Happy to add Folklore Ventures and Giant Leap.' },
  { id: 'rc-005', resourceId: 'res-003', cellRef: null,  author: 'au-user-008', content: 'Updated the template with the new venue contacts for 2026 events.' },
];

const resourceChanges = [
  { id: 'rch-001', resourceId: 'res-002', cellRef: 'B12', originalValue: 'info@tenacious.vc', proposedValue: 'hello@tenacious.vc', reason: 'Email address updated',                    proposedBy: 'au-user-007', status: 'approved', reviewedBy: 'au-user-008' },
  { id: 'rch-002', resourceId: 'res-002', cellRef: 'D15', originalValue: null,                proposedValue: 'Folklore Ventures - folklore.vc',   reason: 'Adding missing Melbourne VC',              proposedBy: 'au-user-005', status: 'pending',  reviewedBy: null },
  { id: 'rch-003', resourceId: 'res-002', cellRef: 'D16', originalValue: null,                proposedValue: 'Giant Leap - giantleap.com.au',     reason: 'Adding impact-focused VC based in Melbourne', proposedBy: 'au-user-005', status: 'pending',  reviewedBy: null },
];

// ─── Audit Log ───────────────────────────────────────────────────────────────

const auditLog = [
  { id: 'al-001', actorId: 'au-user-008', communityId: COMMUNITY, targetId: null,                        action: 'csv_import',     diff: JSON.stringify({ imported: 28, type: 'Person' }) },
  { id: 'al-002', actorId: 'au-user-008', communityId: COMMUNITY, targetId: null,                        action: 'csv_import',     diff: JSON.stringify({ imported: 15, type: 'Organization' }) },
  { id: 'al-003', actorId: 'au-user-008', communityId: COMMUNITY, targetId: 'person:mike-cannon-brookes', action: 'create_shadow',  diff: null },
  { id: 'al-004', actorId: 'au-user-001', communityId: COMMUNITY, targetId: 'person:mike-cannon-brookes', action: 'claim_profile',  diff: null },
  { id: 'al-005', actorId: 'au-user-001', communityId: COMMUNITY, targetId: 'person:mike-cannon-brookes', action: 'edit_public',    diff: JSON.stringify({ bio: { from: null, to: 'Co-founded Atlassian in 2002...' } }) },
  { id: 'al-006', actorId: 'au-user-002', communityId: COMMUNITY, targetId: 'person:melanie-perkins',     action: 'claim_profile',  diff: null },
  { id: 'al-007', actorId: 'au-user-002', communityId: COMMUNITY, targetId: 'person:melanie-perkins',     action: 'edit_public',    diff: JSON.stringify({ bio: { from: null, to: 'Started Canva in 2012...' } }) },
  { id: 'al-008', actorId: 'au-user-008', communityId: COMMUNITY, targetId: 'au-user-008',                action: 'change_role',    diff: JSON.stringify({ role: { from: 'member', to: 'admin' } }) },
  { id: 'al-009', actorId: 'au-user-008', communityId: COMMUNITY, targetId: 'person:rick-baker',          action: 'edit_private',   diff: JSON.stringify({ 'personal-notes': { from: null, to: 'Interested in sponsoring...' } }) },
  { id: 'al-010', actorId: 'au-user-005', communityId: COMMUNITY, targetId: 'org:culture-amp',            action: 'edit_public',    diff: JSON.stringify({ 'funding-stage': { from: null, to: 'Series C+' } }) },
];

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  const client = await pool.connect();

  try {
    console.log('🦘 Seeding Australian Tech Ecosystem...\n');

    // 1. Community
    await client.query(
      `INSERT INTO communities (id, name, emoji, description, country, location, tags, member_count, node_types, community_aliases, crm_settings, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, member_count = EXCLUDED.member_count,
         tags = EXCLUDED.tags, crm_settings = EXCLUDED.crm_settings`,
      [
        COMMUNITY, 'Australian Tech Ecosystem', '🦘',
        'Connecting Australia\'s tech founders, investors, and builders — from Sydney to Perth, Melbourne to Darwin.',
        'Australia', 'Australia',
        ['tech', 'startups', 'innovation', 'venture-capital', 'deep-tech', 'fintech', 'agritech'],
        30,
        JSON.stringify([
          { name: 'Person',       color: '#2563eb', shape: 'rectangle', icon: '👤' },
          { name: 'Organization', color: '#9333ea', shape: 'rectangle', icon: '🏢' },
          { name: 'Event',        color: '#ef4444', shape: 'rectangle', icon: '📅' },
          { name: 'Group',        color: '#0ea5e9', shape: 'rectangle', icon: '👥' },
          { name: 'Community',    color: '#10b981', shape: 'hexagon',   icon: '🌐' },
          { name: 'Resource',     color: '#f59e0b', shape: 'rectangle', icon: '📦' },
        ]),
        JSON.stringify([
          { name: 'Founder',          color: '#16a34a', nodeType: 'Person' },
          { name: 'Ecosystem Leader', color: '#7c3aed', nodeType: 'Person' },
          { name: 'Investor',         color: '#f59e0b', nodeType: 'Person' },
          { name: 'Accelerator',      color: '#0ea5e9', nodeType: 'Group'  },
          { name: 'Incubator',        color: '#db2777', nodeType: 'Group'  },
          { name: 'Coworking',        color: '#06b6d4', nodeType: 'Group'  },
          { name: 'Fund',             color: '#f59e0b', nodeType: 'Group'  },
          { name: 'Government',       color: '#4f46e5', nodeType: 'Group'  },
        ]),
        JSON.stringify({ enablePrivateColumns: true, enableCommunityColumns: true }),
      ]
    );
    console.log('✅ Community created');

    // 2. Users
    let userCount = 0;
    for (const u of users) {
      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified, google_id, oauth_provider, is_active, public_meta, updated_at)
         VALUES ($1, $2, $3, true, $4, $5, true, '{}', NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()`,
        [u.id, u.name, u.email, u.googleId, u.oauthProvider]
      );
      userCount++;
    }
    console.log(`✅ Upserted ${userCount} users`);

    // 3. UserCommunity
    let ucCount = 0;
    for (const u of users) {
      const role = u.id === 'au-user-008' ? 'admin' : 'member';
      await client.query(
        `INSERT INTO user_communities (id, user_id, community_id, role, private_meta, added_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3, '{}', NULL)
         ON CONFLICT (user_id, community_id) DO UPDATE SET role = EXCLUDED.role`,
        [u.id, COMMUNITY, role]
      );
      ucCount++;
    }
    console.log(`✅ Linked ${ucCount} users to community`);

    // 4. Nodes
    let nodeCount = 0;
    for (const node of nodes) {
      await client.query(
        `INSERT INTO nodes (id, type, name, alias, subtitle, location, url, tags, metadata, community_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           type = EXCLUDED.type, name = EXCLUDED.name, alias = EXCLUDED.alias, subtitle = EXCLUDED.subtitle,
           location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata, updated_at = NOW()`,
        [
          node.id, node.type, node.name, node.alias ?? null,
          node.subtitle ?? null, node.location ?? null, node.url ?? null,
          node.tags ?? [], JSON.stringify(node.metadata ?? {}), COMMUNITY,
        ]
      );
      nodeCount++;
    }
    console.log(`✅ Upserted ${nodeCount} nodes`);

    // We also need a node for the admin user's person profile
    await client.query(
      `INSERT INTO nodes (id, type, name, alias, subtitle, location, url, tags, metadata, community_id, updated_at)
       VALUES ('person:admin-user', 'Person', 'Admin User', 'Ecosystem Leader', 'Community Manager, AU Tech Ecosystem', 'Sydney, NSW', NULL, $1, '{}', $2, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [['Community', 'Admin'], COMMUNITY]
    );
    nodeCount++;

    // 5. Persons
    let personCount = 0;
    for (const p of persons) {
      await client.query(
        `INSERT INTO persons (id, user_id, name, subtitle, bio, location, website, linkedin_url, twitter_url, phone, pronouns, open_to_work, image_url, tags, metadata, has_onboarded, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13, '{}', $14, NOW())
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
           bio = EXCLUDED.bio, location = EXCLUDED.location, website = EXCLUDED.website,
           linkedin_url = EXCLUDED.linkedin_url, twitter_url = EXCLUDED.twitter_url,
           phone = EXCLUDED.phone, pronouns = EXCLUDED.pronouns, has_onboarded = EXCLUDED.has_onboarded,
           tags = EXCLUDED.tags, updated_at = NOW()`,
        [
          p.id, p.userId, p.name, p.subtitle, p.bio, p.location, p.website,
          p.linkedinUrl, p.twitterUrl, p.phone, p.pronouns, p.openToWork,
          p.tags, p.hasOnboarded,
        ]
      );
      personCount++;
    }
    console.log(`✅ Upserted ${personCount} person profiles`);

    // 6. Links
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

    // 7. Attendees
    let attCount = 0;
    for (const att of attendees) {
      await client.query(
        `INSERT INTO attendees (id, event_id, person_id, email, company_name, role_title, status, answers, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, company_name = EXCLUDED.company_name,
           role_title = EXCLUDED.role_title, updated_at = NOW()`,
        [att.id, att.eventId, att.personId ?? null, att.email ?? null, att.companyName ?? null, att.roleTitle ?? null, att.status]
      );
      attCount++;
    }
    console.log(`✅ Inserted ${attCount} attendees`);

    // 8. Work Experience
    let weCount = 0;
    for (const we of workExperience) {
      await client.query(
        `INSERT INTO work_experience (id, person_id, title, company, location, start_date, end_date, current, description, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, company = EXCLUDED.company, current = EXCLUDED.current, description = EXCLUDED.description`,
        [we.id, we.personId, we.title, we.company, we.location ?? null, we.startDate, we.endDate ?? null, we.current, we.description ?? null, we.sortOrder]
      );
      weCount++;
    }
    console.log(`✅ Inserted ${weCount} work experience records`);

    // 9. Education
    let edCount = 0;
    for (const ed of education) {
      await client.query(
        `INSERT INTO education (id, person_id, school, degree, field_of_study, start_year, end_year, description, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           school = EXCLUDED.school, degree = EXCLUDED.degree, field_of_study = EXCLUDED.field_of_study`,
        [ed.id, ed.personId, ed.school, ed.degree ?? null, ed.fieldOfStudy ?? null, ed.startYear ?? null, ed.endYear ?? null, ed.description ?? null, ed.sortOrder]
      );
      edCount++;
    }
    console.log(`✅ Inserted ${edCount} education records`);

    // 10. Certifications
    let certCount = 0;
    for (const cert of certifications) {
      await client.query(
        `INSERT INTO certifications (id, person_id, name, issuing_org, issue_date, expiry_date, credential_id, credential_url, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, issuing_org = EXCLUDED.issuing_org`,
        [cert.id, cert.personId, cert.name, cert.issuingOrg, cert.issueDate ?? null, cert.expiryDate ?? null, cert.credentialId ?? null, cert.credentialUrl ?? null, cert.sortOrder]
      );
      certCount++;
    }
    console.log(`✅ Inserted ${certCount} certifications`);

    // 11. Profile Languages
    let langCount = 0;
    for (const lang of profileLanguages) {
      await client.query(
        `INSERT INTO profile_languages (id, person_id, language, proficiency, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           language = EXCLUDED.language, proficiency = EXCLUDED.proficiency`,
        [lang.id, lang.personId, lang.language, lang.proficiency, lang.sortOrder]
      );
      langCount++;
    }
    console.log(`✅ Inserted ${langCount} profile languages`);

    // 12. Conversations
    let convCount = 0;
    for (const conv of conversations) {
      await client.query(
        `INSERT INTO conversations (id, type, name, avatar_url, dm_key, created_by_id, updated_at)
         VALUES ($1, $2::\"ConversationType\", $3, NULL, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [conv.id, conv.type, conv.name ?? null, conv.dmKey ?? null, conv.createdById]
      );
      convCount++;
    }
    console.log(`✅ Inserted ${convCount} conversations`);

    // 13. Conversation Members
    let cmCount = 0;
    for (const cm of conversationMembers) {
      await client.query(
        `INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, $4::\"ConversationMemberRole\", NOW())
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [cm.id, cm.conversationId, cm.userId, cm.role]
      );
      cmCount++;
    }
    console.log(`✅ Inserted ${cmCount} conversation members`);

    // 14. Messages
    let msgCount = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Stagger timestamps so messages appear in order
      const offset = i * 300000; // 5 min apart
      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, text, created_at)
         VALUES ($1, $2, $3, $4, NOW() - interval '${messages.length - i} hours')
         ON CONFLICT (id) DO NOTHING`,
        [msg.id, msg.conversationId, msg.senderId, msg.text]
      );
      msgCount++;
    }
    console.log(`✅ Inserted ${msgCount} messages`);

    // 15. Private Columns
    let pcCount = 0;
    for (const pc of privateColumns) {
      await client.query(
        `INSERT INTO private_columns (id, user_id, community_id, node_type, column_key, column_name, column_type, options, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, community_id, column_key) DO UPDATE SET
           column_name = EXCLUDED.column_name, options = EXCLUDED.options`,
        [pc.id, pc.userId, pc.communityId, pc.nodeType ?? null, pc.columnKey, pc.columnName, pc.columnType, pc.options ?? null, pc.position]
      );
      pcCount++;
    }
    console.log(`✅ Inserted ${pcCount} private columns`);

    // 16. Private Column Values
    let pcvCount = 0;
    for (const pcv of privateColumnValues) {
      await client.query(
        `INSERT INTO private_column_values (id, user_id, node_id, column_id, value, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, node_id, column_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [pcv.id, pcv.userId, pcv.nodeId, pcv.columnId, pcv.value]
      );
      pcvCount++;
    }
    console.log(`✅ Inserted ${pcvCount} private column values`);

    // 17. Community Columns
    let ccCount = 0;
    for (const cc of communityColumns) {
      await client.query(
        `INSERT INTO community_columns (id, community_id, node_type, column_key, column_name, column_type, options, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (community_id, column_key) DO UPDATE SET
           column_name = EXCLUDED.column_name, options = EXCLUDED.options`,
        [cc.id, cc.communityId, cc.nodeType ?? null, cc.columnKey, cc.columnName, cc.columnType, cc.options ?? null, cc.position]
      );
      ccCount++;
    }
    console.log(`✅ Inserted ${ccCount} community columns`);

    // 18. Community Column Values
    let ccvCount = 0;
    for (const ccv of communityColumnValues) {
      await client.query(
        `INSERT INTO community_column_values (id, community_id, node_id, column_key, column_id, value, contributed_by_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (community_id, node_id, column_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [ccv.id, ccv.communityId, ccv.nodeId, ccv.columnKey, ccv.columnId, ccv.value, ccv.contributedById ?? null]
      );
      ccvCount++;
    }
    console.log(`✅ Inserted ${ccvCount} community column values`);

    // 19. Resources
    let resCount = 0;
    for (const res of resources) {
      await client.query(
        `INSERT INTO resources (id, community_id, name, file_type, file_url, file_size, uploaded_by, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '{}')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [res.id, res.communityId, res.name, res.fileType, res.fileUrl, res.fileSize ?? null, res.uploadedBy]
      );
      resCount++;
    }
    console.log(`✅ Inserted ${resCount} resources`);

    // 20. Resource Comments
    let rcCount = 0;
    for (const rc of resourceComments) {
      await client.query(
        `INSERT INTO resource_comments (id, resource_id, cell_ref, author, content)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [rc.id, rc.resourceId, rc.cellRef ?? null, rc.author, rc.content]
      );
      rcCount++;
    }
    console.log(`✅ Inserted ${rcCount} resource comments`);

    // 21. Resource Changes
    let rchCount = 0;
    for (const rch of resourceChanges) {
      await client.query(
        `INSERT INTO resource_changes (id, resource_id, cell_ref, original_value, proposed_value, reason, proposed_by, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [rch.id, rch.resourceId, rch.cellRef, rch.originalValue ?? null, rch.proposedValue, rch.reason ?? null, rch.proposedBy, rch.status, rch.reviewedBy ?? null, rch.reviewedBy ? new Date() : null]
      );
      rchCount++;
    }
    console.log(`✅ Inserted ${rchCount} resource changes`);

    // 22. Audit Log
    let alCount = 0;
    for (let i = 0; i < auditLog.length; i++) {
      const al = auditLog[i];
      await client.query(
        `INSERT INTO audit_log (id, actor_id, community_id, target_id, action, diff, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() - interval '${auditLog.length - i} days')
         ON CONFLICT (id) DO NOTHING`,
        [al.id, al.actorId, al.communityId ?? null, al.targetId ?? null, al.action, al.diff ?? null]
      );
      alCount++;
    }
    console.log(`✅ Inserted ${alCount} audit log entries`);

    // ── Summary ──
    const counts = {};
    const tables = [
      'communities', 'user', 'user_communities', 'nodes', 'persons', 'links',
      'attendees', 'work_experience', 'education', 'certifications', 'profile_languages',
      'conversations', 'conversation_members', 'messages',
      'private_columns', 'private_column_values', 'community_columns', 'community_column_values',
      'resources', 'resource_comments', 'resource_changes', 'audit_log',
    ];

    console.log('\n📊 AU Ecosystem totals:');
    for (const table of tables) {
      const { rows: [{ count }] } = await client.query(`SELECT count(*) FROM "${table}"`);
      console.log(`   ${table}: ${count}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
