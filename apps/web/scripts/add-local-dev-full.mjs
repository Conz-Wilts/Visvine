// Fills the "Local Dev Community" (community:local-dev) with rich, realistic
// data across every live feature surface: directory people/orgs/resources,
// CRM columns + values, context notes (shared + personal brains), events with
// attendees + registration forms, the tasks kanban board, the resources file
// library, channels + feed posts + a DM, and extra dev-login users.
//
// Additive & idempotent: never wipes other communities (blackbird, personal
// brains, …) and re-runs converge — explicit ids + ON CONFLICT upserts, or
// delete-by-seed-marker where rows have generated ids.
//
//   pnpm db:dev:full          (runs this, then backfill-context-links)
//
// Directory links are NOT written directly for people/orgs — they derive from
// the shared-brain entity notes (origin 'context') via
// scripts/backfill-context-links.ts, mirroring how the app works. Event
// attended/hosting links ARE written here, matching eventRepo's own writers.
//
// Loads apps/web/.env (cwd-independent, via the guard) and refuses to run
// against any non-local host — same guard the destructive db:* scripts use.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error('add-local-dev-full: no DATABASE_URL or DB_HOST resolved from apps/web/.env');

const pool = new pg.Pool({ connectionString });

const COMM = 'community:local-dev';
const SHARED = 'shared';
const ADMIN = 'user_dev_admin';
const MEMBER = 'user_dev_member';
const TZ = 'Pacific/Auckland';

// ---- community config --------------------------------------------------------

const NODE_TYPES = [
  { icon: '👤', name: 'Person', color: '#2563eb', shape: 'rectangle' },
  { icon: '👥', name: 'Group', color: '#9333ea', shape: 'hexagon' },
  { icon: '📅', name: 'Event', color: '#ef4444', shape: 'rectangle' },
  { icon: '📚', name: 'Resource', color: '#0d9488', shape: 'circle' },
];

const COMMUNITY_ALIASES = [
  { name: 'Founder', color: '#16a34a', nodeType: 'Person' },
  { name: 'Investor', color: '#0ea5e9', nodeType: 'Person' },
  { name: 'Mentor', color: '#d97706', nodeType: 'Person' },
  { name: 'Operator', color: '#db2777', nodeType: 'Person' },
  { name: 'Startup', color: '#0891b2', nodeType: 'Group' },
];

// ---- people ------------------------------------------------------------------
// Users get a /dev/login entry + Person profile; directory-only people don't.

const USERS = [
  { slug: 'maya-patel', name: 'Maya Patel', role: 'admin', title: 'Community Manager, Harbour Lab', location: 'Wellington, NZ', alias: 'Operator', tags: ['Community', 'Events'], bio: 'Runs the day-to-day of the community out of Harbour Lab — programming, intros and keeping the kettle on.', linkedin: 'https://linkedin.com/in/maya-patel-dev', experience: [{ title: 'Community Manager', org: 'Harbour Lab', start: '2024' }, { title: 'Events Lead', org: 'TechWeek', start: '2021', end: '2024' }] },
  { slug: 'ava-chen', name: 'Ava Chen', role: 'member', title: 'Co-founder & CEO, Loopwork', location: 'Wellington, NZ', alias: 'Founder', tags: ['Founder', 'SaaS'], bio: 'Building Loopwork, an async-first teamwork tool. Previously PM at a scale-up; sold her first side-project at 24.', linkedin: 'https://linkedin.com/in/ava-chen-dev', website: 'https://loopwork.example.com', experience: [{ title: 'Co-founder & CEO', org: 'Loopwork', start: '2024' }, { title: 'Product Manager', org: 'Vend', start: '2020', end: '2024' }] },
  { slug: 'jordan-reid', name: 'Jordan Reid', role: 'member', title: 'Co-founder & CTO, Loopwork', location: 'Wellington, NZ', alias: 'Founder', tags: ['Founder', 'Engineering'], bio: 'CTO at Loopwork. Ex-infrastructure engineer; cares about local-first software and very fast websites.', experience: [{ title: 'Co-founder & CTO', org: 'Loopwork', start: '2024' }, { title: 'Staff Engineer', org: 'Xero', start: '2018', end: '2024' }] },
  { slug: 'sofia-marino', name: 'Sofia Marino', role: 'member', title: 'Founder, Pixelforge', location: 'Auckland, NZ', alias: 'Founder', tags: ['Design', 'Founder'], bio: 'Design studio founder helping early-stage teams ship brand + product in weeks, not months.', experience: [{ title: 'Founder', org: 'Pixelforge', start: '2022' }] },
  { slug: 'tom-walker', name: 'Tom Walker', role: 'member', title: 'Senior Engineer, Kite Analytics', location: 'Auckland, NZ', tags: ['Engineering', 'Data'], bio: 'Works on the ingestion pipeline at Kite. Runs the monthly hack night.', experience: [{ title: 'Senior Engineer', org: 'Kite Analytics', start: '2023' }] },
  { slug: 'priya-nair', name: 'Priya Nair', role: 'member', title: 'Associate, Southern Ridge Capital', location: 'Wellington, NZ', alias: 'Investor', tags: ['VC', 'Fintech'], bio: 'Seed-stage investor at Southern Ridge. Office hours most Wednesdays — ask about anything fintech or climate.', linkedin: 'https://linkedin.com/in/priya-nair-dev', experience: [{ title: 'Associate', org: 'Southern Ridge Capital', start: '2023' }, { title: 'Analyst', org: 'Forsyth Barr', start: '2021', end: '2023' }] },
  { slug: 'liam-oconnor', name: "Liam O'Connor", role: 'member', title: 'Operations, Harbour Lab', location: 'Wellington, NZ', alias: 'Operator', tags: ['Operations'], bio: 'Keeps Harbour Lab running — desks, AV, coffee machine firmware.', experience: [{ title: 'Operations', org: 'Harbour Lab', start: '2025' }] },
  { slug: 'grace-kim', name: 'Grace Kim', role: 'member', title: 'Founder & CEO, Fernwave', location: 'Christchurch, NZ', alias: 'Founder', tags: ['Founder', 'Climate'], bio: 'Marine-sensor climate tech. Ex-oceanographer turned founder; raising a seed round.', website: 'https://fernwave.example.com', experience: [{ title: 'Founder & CEO', org: 'Fernwave', start: '2023' }, { title: 'Research Scientist', org: 'NIWA', start: '2018', end: '2023' }] },
  { slug: 'noah-bennett', name: 'Noah Bennett', role: 'member', title: 'Data Scientist, Solace Health', location: 'Auckland, NZ', tags: ['Data', 'Health'], bio: 'ML for mental-health triage at Solace. Happy to chat evaluation and safety.', experience: [{ title: 'Data Scientist', org: 'Solace Health', start: '2024' }] },
  { slug: 'zoe-clark', name: 'Zoe Clark', role: 'member', title: 'Head of Growth, Kite Analytics', location: 'Auckland, NZ', tags: ['Growth', 'Marketing'], bio: 'Growth at Kite Analytics. Writes a fortnightly newsletter on PLG for NZ startups.', experience: [{ title: 'Head of Growth', org: 'Kite Analytics', start: '2024' }, { title: 'Marketing Manager', org: 'Sharesies', start: '2021', end: '2024' }] },
];

const DIRECTORY_PEOPLE = [
  { slug: 'daniel-foster', name: 'Daniel Foster', title: 'Angel investor', location: 'Queenstown, NZ', alias: 'Investor', tags: ['Angel', 'SaaS'], bio: 'Angel investor, 20+ early-stage cheques. Ex-founder (exited 2019).' },
  { slug: 'harper-lane', name: 'Harper Lane', title: 'Tech journalist, The Southerly', location: 'Wellington, NZ', tags: ['Media'], bio: 'Covers the NZ startup ecosystem for The Southerly.' },
  { slug: 'felix-wong', name: 'Prof. Felix Wong', title: 'Director, City University AI Lab', location: 'Auckland, NZ', alias: 'Mentor', tags: ['AI', 'Research'], bio: 'Leads the City University AI Lab; supervises industry collaborations.' },
  { slug: 'isla-murray', name: 'Isla Murray', title: 'Founder & CEO, Kite Analytics', location: 'Auckland, NZ', alias: 'Founder', tags: ['Founder', 'Analytics'], bio: 'Founded Kite Analytics in 2021; Series A, ~40 people.' },
  { slug: 'oliver-grant', name: 'Oliver Grant', title: 'Mentor · exited founder', location: 'Nelson, NZ', alias: 'Mentor', tags: ['Mentor', 'Marketplace'], bio: 'Sold his marketplace startup in 2022; now mentors two cohorts a year.' },
  { slug: 'ruby-thompson', name: 'Ruby Thompson', title: 'Founder, Solace Health', location: 'Auckland, NZ', alias: 'Founder', tags: ['Founder', 'Health'], bio: 'Clinical psychologist building Solace Health, a mental-health triage platform.' },
];

// ---- orgs --------------------------------------------------------------------

const ORGS = [
  { slug: 'loopwork', name: 'Loopwork', subtitle: 'Async-first teamwork for distributed teams', location: 'Wellington, NZ', url: 'https://loopwork.example.com', alias: 'Startup', tags: ['SaaS', 'Productivity'], stage: 'Raising' },
  { slug: 'kite-analytics', name: 'Kite Analytics', subtitle: 'Product analytics without the noise', location: 'Auckland, NZ', url: 'https://kite.example.com', alias: 'Startup', tags: ['Analytics', 'SaaS'], stage: 'Scaling' },
  { slug: 'fernwave', name: 'Fernwave', subtitle: 'Marine sensors for a warming ocean', location: 'Christchurch, NZ', url: 'https://fernwave.example.com', alias: 'Startup', tags: ['Climate', 'Hardware'], stage: 'Raising' },
  { slug: 'solace-health', name: 'Solace Health', subtitle: 'Mental-health triage that actually triages', location: 'Auckland, NZ', url: 'https://solace.example.com', alias: 'Startup', tags: ['Health', 'AI'], stage: 'Building' },
  { slug: 'pixelforge', name: 'Pixelforge', subtitle: 'Brand + product design studio for startups', location: 'Auckland, NZ', url: 'https://pixelforge.example.com', tags: ['Design', 'Agency'], stage: 'Scaling' },
  { slug: 'harbour-lab', name: 'Harbour Lab', subtitle: 'Coworking home of the community', location: 'Wellington, NZ', url: 'https://harbourlab.example.com', tags: ['Coworking', 'Community'], stage: null },
  { slug: 'southern-ridge-capital', name: 'Southern Ridge Capital', subtitle: 'Seed-stage fund, NZ & Pacific', location: 'Wellington, NZ', url: 'https://southernridge.example.com', tags: ['VC', 'Seed'], stage: null },
  { slug: 'city-university-ai-lab', name: 'City University AI Lab', subtitle: 'Applied AI research + industry partnerships', location: 'Auckland, NZ', url: 'https://ailab.example.edu', tags: ['Research', 'AI'], stage: null },
];

const RESOURCE_NODES = [
  { slug: 'founder-playbook', name: 'Founder Playbook', subtitle: 'The community-maintained guide to going 0→1 here', url: 'https://handbook.example.com/founder-playbook', tags: ['Guide'] },
  { slug: 'fundraising-toolkit', name: 'NZ Fundraising Toolkit', subtitle: 'Term-sheet templates, investor lists, raise timelines', url: 'https://handbook.example.com/fundraising', tags: ['Fundraising', 'Templates'] },
  { slug: 'community-handbook', name: 'Community Handbook', subtitle: 'How this community runs: channels, events, code of conduct', url: 'https://handbook.example.com/handbook', tags: ['Guide', 'Onboarding'] },
];

// ---- CRM ---------------------------------------------------------------------

const CRM_COLUMNS = [
  { key: 'stage', name: 'Stage', type: 'select', options: ['Exploring', 'Building', 'Raising', 'Scaling', 'Exited'] },
  { key: 'focus', name: 'Focus', type: 'text', options: null },
  { key: 'intro_status', name: 'Intro Status', type: 'select', options: ["Not intro'd", 'Requested', 'Introduced'] },
];

// nodeId → { columnKey: value }
const CRM_VALUES = {
  'person:ava-chen': { stage: 'Raising', focus: 'Async collaboration SaaS', intro_status: 'Introduced' },
  'person:jordan-reid': { stage: 'Raising', focus: 'Local-first infra', intro_status: 'Introduced' },
  'person:grace-kim': { stage: 'Raising', focus: 'Ocean sensing hardware', intro_status: 'Requested' },
  'person:sofia-marino': { stage: 'Scaling', focus: 'Design services', intro_status: "Not intro'd" },
  'person:isla-murray': { stage: 'Scaling', focus: 'Product analytics', intro_status: 'Introduced' },
  'person:ruby-thompson': { stage: 'Building', focus: 'Mental-health triage', intro_status: 'Requested' },
  'person:daniel-foster': { focus: 'Angel · SaaS & marketplaces', intro_status: 'Introduced' },
  'person:priya-nair': { focus: 'Seed cheques, fintech & climate', intro_status: 'Introduced' },
  'person:oliver-grant': { stage: 'Exited', focus: 'Mentoring', intro_status: 'Introduced' },
  'person:felix-wong': { focus: 'Applied AI research', intro_status: 'Requested' },
  'org:loopwork': { stage: 'Raising', focus: 'Async teamwork' },
  'org:kite-analytics': { stage: 'Scaling', focus: 'Product analytics' },
  'org:fernwave': { stage: 'Raising', focus: 'Climate hardware' },
  'org:solace-health': { stage: 'Building', focus: 'Digital health' },
  'org:pixelforge': { stage: 'Scaling', focus: 'Design studio' },
};

// ---- events ------------------------------------------------------------------

const demoDayForm = {
  enabled: true,
  slug: 'demo-day-2026',
  requireApproval: false,
  schema: [
    { id: 'company', label: 'Company / project', type: 'company', required: true, placeholder: 'Who are you building with?' },
    { id: 'stage', label: 'What stage are you at?', type: 'select', required: true, options: ['Idea', 'Prototype', 'Revenue', 'Raising', 'Just curious'] },
    { id: 'pitching', label: "I'd like a 3-minute pitch slot", type: 'checkbox' },
    { id: 'dietary', label: 'Dietary requirements', type: 'text', placeholder: 'Vegetarian, GF, …' },
  ],
};

const EVENTS = [
  {
    slug: 'founders-breakfast-june', name: "Founders' Breakfast", hosts: ['person:maya-patel'],
    start: '2026-06-18T07:30:00+12:00', end: '2026-06-18T09:00:00+12:00',
    location: { label: 'Harbour Lab', address: '12 Customhouse Quay, Wellington', lat: -41.284, lon: 174.7772 },
    visibility: 'community', status: 'published', capacity: 25, views: 214,
    description: 'Monthly no-agenda breakfast for founders. Coffee and pastries on the community — bring one problem you are stuck on.',
  },
  {
    slug: 'launch-night-july', name: 'Loopwork 2.0 Launch Night', hosts: ['person:ava-chen', 'person:jordan-reid'],
    start: '2026-07-09T17:30:00+12:00', end: '2026-07-09T21:00:00+12:00',
    location: { label: 'Harbour Lab — Event Space', address: '12 Customhouse Quay, Wellington', lat: -41.284, lon: 174.7772 },
    visibility: 'public', status: 'published', capacity: 80, views: 642, allowPlusOnes: 2,
    description: 'Ava and Jordan ship Loopwork 2.0 live on stage. Demos, drinks, and the traditional launch-night quiz.',
  },
  {
    slug: 'ai-workshop-august', name: 'Hands-on AI Workshop', hosts: ['person:felix-wong'],
    start: '2026-08-05T13:00:00+12:00', end: '2026-08-05T17:00:00+12:00',
    location: { label: 'City University AI Lab', address: '303 Princes St, Auckland', lat: -36.8509, lon: 174.7699 },
    visibility: 'community', status: 'published', capacity: 30, views: 388, waitlistEnabled: true,
    description: 'Prof. Felix Wong walks through building an evaluation harness for LLM features. Laptops required; starter repo sent the day before.',
  },
  {
    slug: 'investor-office-hours', name: 'Investor Office Hours', hosts: ['person:priya-nair', 'person:daniel-foster'],
    start: '2026-08-12T10:00:00+12:00', end: '2026-08-12T12:00:00+12:00',
    location: { label: 'Harbour Lab — Meeting Room 2', address: '12 Customhouse Quay, Wellington', lat: -41.284, lon: 174.7772 },
    visibility: 'community', status: 'published', capacity: 12, views: 175,
    description: '15-minute slots with Priya (Southern Ridge) and Daniel (angel). Come with your deck or just your questions.',
  },
  {
    slug: 'demo-day-2026', name: 'Spring Demo Day 2026', hosts: ['person:maya-patel', 'person:priya-nair'],
    start: '2026-08-21T16:00:00+12:00', end: '2026-08-21T20:00:00+12:00',
    location: { label: 'Te Papa — Rangimarie Room', address: '55 Cable St, Wellington', lat: -41.2905, lon: 174.7821 },
    visibility: 'public', status: 'published', capacity: 120, views: 951, waitlistEnabled: true, allowPlusOnes: 1,
    guestListVisible: true, form: demoDayForm,
    description: 'The big one: eight community startups pitch to a room of investors, media and friends. Applications for pitch slots via the registration form.',
  },
  {
    slug: 'founder-retreat-2026', name: 'Founder Retreat (planning)', hosts: ['person:maya-patel'],
    start: '2026-09-11T09:00:00+12:00', end: '2026-09-13T15:00:00+12:00',
    location: { label: 'TBC — somewhere with no cell coverage' },
    visibility: 'community', status: 'draft', capacity: 20, views: 8,
    description: 'Draft: two nights, deep work, zero panels. Dates and venue being locked in.',
  },
];

// eventSlug → attendees. Members reference person nodes + @local.dev emails;
// guests are loginless (name/email only). Demo-day answers use the form ids.
const ATTENDEES = {
  'founders-breakfast-june': [
    { n: 1, person: 'person:ava-chen', email: 'ava-chen@local.dev', status: 'checked_in', response: 'going' },
    { n: 2, person: 'person:grace-kim', email: 'grace-kim@local.dev', status: 'checked_in', response: 'going' },
    { n: 3, person: 'person:sofia-marino', email: 'sofia-marino@local.dev', status: 'no_show', response: 'going' },
    { n: 4, name: 'Isla Murray', email: 'isla@kite.example.com', person: 'person:isla-murray', status: 'checked_in', response: 'going', company: 'Kite Analytics' },
  ],
  'launch-night-july': [
    { n: 1, person: 'person:maya-patel', email: 'maya-patel@local.dev', status: 'checked_in', response: 'going' },
    { n: 2, person: 'person:tom-walker', email: 'tom-walker@local.dev', status: 'checked_in', response: 'going', plusOnes: 1, plusOneNames: ['Sam Walker'] },
    { n: 3, person: 'person:zoe-clark', email: 'zoe-clark@local.dev', status: 'checked_in', response: 'going' },
    { n: 4, person: 'person:priya-nair', email: 'priya-nair@local.dev', status: 'checked_in', response: 'going' },
    { n: 5, name: 'Harper Lane', email: 'harper@thesoutherly.example.com', person: 'person:harper-lane', status: 'checked_in', response: 'going', company: 'The Southerly', role: 'Journalist' },
    { n: 6, name: 'Casey Morgan', email: 'casey.morgan@gmail.example.com', status: 'no_show', response: 'going' },
    { n: 7, person: 'person:noah-bennett', email: 'noah-bennett@local.dev', status: 'cancelled', response: 'declined' },
  ],
  'ai-workshop-august': [
    { n: 1, person: 'person:noah-bennett', email: 'noah-bennett@local.dev', status: 'going', response: 'going' },
    { n: 2, person: 'person:tom-walker', email: 'tom-walker@local.dev', status: 'going', response: 'going' },
    { n: 3, person: 'person:jordan-reid', email: 'jordan-reid@local.dev', status: 'going', response: 'going' },
    { n: 4, name: 'Ruby Thompson', email: 'ruby@solace.example.com', person: 'person:ruby-thompson', status: 'going', response: 'going', company: 'Solace Health' },
    { n: 5, name: 'Ben Carter', email: 'ben.carter@gmail.example.com', status: 'waitlisted', response: 'going' },
    { n: 6, name: 'Amelia Ford', email: 'amelia.ford@gmail.example.com', status: 'waitlisted', response: 'going' },
  ],
  'investor-office-hours': [
    { n: 1, person: 'person:grace-kim', email: 'grace-kim@local.dev', status: 'going', response: 'going' },
    { n: 2, person: 'person:ava-chen', email: 'ava-chen@local.dev', status: 'going', response: 'going' },
    { n: 3, name: 'Ruby Thompson', email: 'ruby@solace.example.com', person: 'person:ruby-thompson', status: 'pending', response: 'going', company: 'Solace Health' },
  ],
  'demo-day-2026': [
    { n: 1, person: 'person:ava-chen', email: 'ava-chen@local.dev', status: 'going', response: 'going', answers: { company: 'Loopwork', stage: 'Raising', pitching: true, dietary: '' } },
    { n: 2, person: 'person:grace-kim', email: 'grace-kim@local.dev', status: 'going', response: 'going', answers: { company: 'Fernwave', stage: 'Raising', pitching: true, dietary: 'Vegetarian' } },
    { n: 3, person: 'person:sofia-marino', email: 'sofia-marino@local.dev', status: 'going', response: 'going', answers: { company: 'Pixelforge', stage: 'Revenue', pitching: false, dietary: '' } },
    { n: 4, person: 'person:zoe-clark', email: 'zoe-clark@local.dev', status: 'going', response: 'going', answers: { company: 'Kite Analytics', stage: 'Revenue', pitching: false, dietary: 'GF' }, plusOnes: 1, plusOneNames: ['Alex Clark'] },
    { n: 5, name: 'Daniel Foster', email: 'daniel@foster.example.com', person: 'person:daniel-foster', status: 'going', response: 'going', role: 'Angel investor', answers: { company: 'Foster Angel', stage: 'Just curious', pitching: false, dietary: '' } },
    { n: 6, name: 'Harper Lane', email: 'harper@thesoutherly.example.com', person: 'person:harper-lane', status: 'invited', company: 'The Southerly' },
    { n: 7, name: 'Olivia Shaw', email: 'olivia.shaw@gmail.example.com', status: 'going', response: 'going', answers: { company: 'Stealth', stage: 'Prototype', pitching: true, dietary: '' } },
    { n: 8, name: 'Jack Nguyen', email: 'jack.nguyen@gmail.example.com', status: 'waitlisted', response: 'going', answers: { company: '—', stage: 'Idea', pitching: false, dietary: '' } },
  ],
};

// ---- tasks -------------------------------------------------------------------

const TASK_COLUMNS = [
  { name: 'Backlog', color: '#94a3b8' },
  { name: 'To do', color: '#f59e0b' },
  { name: 'In progress', color: '#3b82f6' },
  { name: 'Done', color: '#22c55e' },
];

const TASKS = [
  { col: 'Backlog', title: 'Scope a mentorship matching round', description: 'Pair the new founders with mentors — Oliver and Felix have both offered slots.', assignee: 'user_dev_maya-patel', labels: ['programme'] },
  { col: 'Backlog', title: 'Refresh the community handbook', description: 'The channels section still describes the old Slack setup.', labels: ['docs'] },
  { col: 'Backlog', title: 'Sponsor outreach for Demo Day', description: 'Need two more sponsors to cover Te Papa venue hire.', assignee: ADMIN, labels: ['demo-day', 'money'], due: '2026-08-01' },
  { col: 'To do', title: 'Book catering for Demo Day', description: 'Quote from Little Penang pending; fallback is the usual pizza order.', assignee: 'user_dev_maya-patel', labels: ['demo-day'], due: '2026-08-10' },
  { col: 'To do', title: 'Send AI workshop starter repo', description: 'Felix wants it out 24h before the session with setup instructions tested on Windows.', assignee: 'user_dev_tom-walker', labels: ['events'], due: '2026-08-04' },
  { col: 'To do', title: 'Chase RSVPs for investor office hours', description: '3 of 12 slots filled — nudge in #general and the newsletter.', assignee: 'user_dev_maya-patel', labels: ['events'], due: '2026-08-06' },
  { col: 'To do', title: 'Write July community update', description: 'Launch night recap, demo day announce, two new member spotlights.', assignee: 'user_dev_zoe-clark', labels: ['comms'], due: '2026-07-25' },
  { col: 'In progress', title: 'Demo Day pitch selection', description: '11 applications for 8 slots. Priya + Maya reviewing; decisions by Friday.', assignee: 'user_dev_priya-nair', labels: ['demo-day'], due: '2026-07-24' },
  { col: 'In progress', title: 'New member onboarding flow', description: 'Draft welcome DM + buddy assignment. Testing with the three July joiners.', assignee: 'user_dev_maya-patel', labels: ['programme'] },
  { col: 'In progress', title: 'Directory data cleanup', description: 'Dedupe orgs, fill missing CRM stages, archive departed members.', assignee: ADMIN, labels: ['directory'], due: '2026-07-18' },
  { col: 'Done', title: 'Launch night AV + livestream', description: 'Went off without a hitch. Recording linked in #events.', assignee: 'user_dev_liam-oconnor', labels: ['events'] },
  { col: 'Done', title: 'June founders breakfast', description: '18 attended. Pastry budget was, again, insufficient.', assignee: 'user_dev_maya-patel', labels: ['events'] },
  { col: 'Done', title: 'Q3 events calendar published', description: 'Workshop, office hours, demo day, retreat — all live on /events.', assignee: 'user_dev_maya-patel', labels: ['events', 'comms'] },
  { col: 'Done', title: 'Move resource library to shared drive', description: 'Everything now uploaded to /resources with owners assigned.', assignee: 'user_dev_liam-oconnor', labels: ['docs'] },
];

// ---- resources (file library) ------------------------------------------------
// Files live in apps/web/public/uploads/seed/ (checked in). fileUrl uses the
// legacy /uploads/... form the resource routes already tolerate (no GCS).

const FILE_RESOURCES = [
  { file: 'member-directory.csv', name: 'Member directory export', fileType: 'csv', uploadedBy: ADMIN, daysAgo: 21 },
  { file: 'demo-day-budget.csv', name: 'Demo Day 2026 budget', fileType: 'csv', uploadedBy: 'user_dev_maya-patel', daysAgo: 9 },
  { file: 'community-map.svg', name: 'Ecosystem map (July 2026)', fileType: 'image', uploadedBy: 'user_dev_sofia-marino', daysAgo: 6 },
  { file: 'demo-day-poster.svg', name: 'Demo Day poster', fileType: 'image', uploadedBy: 'user_dev_sofia-marino', daysAgo: 4 },
  { file: 'welcome-pack.md', name: 'New member welcome pack', fileType: 'md', uploadedBy: 'user_dev_maya-patel', daysAgo: 30 },
];

// ---- channels / posts / DM ---------------------------------------------------

const SPACES = [
  { id: 'space_localdev_community', name: 'Community', emoji: '🏡', position: 0 },
  { id: 'space_localdev_programmes', name: 'Programmes', emoji: '🚀', position: 1 },
];

const CHANNELS = [
  { id: 'chan_localdev_general', name: 'general', icon: '👋', space: 'space_localdev_community', description: 'Community-wide chat — say hi.' },
  { id: 'chan_localdev_intros', name: 'intros', icon: '🎤', space: 'space_localdev_community', description: 'Introduce yourself when you join.' },
  { id: 'chan_localdev_events', name: 'events', icon: '📅', space: 'space_localdev_community', description: 'Event announcements and recaps.' },
  { id: 'chan_localdev_show', name: 'show-and-tell', icon: '🛠️', space: 'space_localdev_programmes', description: 'Ship something? Show it off.' },
];

// hoursAgo counts back from now; keeps ordering stable across runs.
const MESSAGES = [
  { id: 'msg_ld_001', chan: 'chan_localdev_intros', from: 'user_dev_ava-chen', hoursAgo: 500, text: "Kia ora everyone! Ava here — co-founder of Loopwork with Jordan. We're building async-first teamwork tools out of Harbour Lab. Come say hi at the launch night!" },
  { id: 'msg_ld_002', chan: 'chan_localdev_intros', from: 'user_dev_grace-kim', hoursAgo: 460, text: "Hi all 👋 Grace, founder of Fernwave (marine climate sensors, Christchurch). Ex-NIWA. Currently deep in seed-raise land — happy to swap notes with anyone else raising." },
  { id: 'msg_ld_003', chan: 'chan_localdev_intros', from: 'user_dev_noah-bennett', hoursAgo: 430, text: "Hello! Noah, data scientist at Solace Health. Interested in eval + safety for clinical ML. Also I bake." },
  { id: 'msg_ld_004', chan: 'chan_localdev_intros', from: 'user_dev_maya-patel', hoursAgo: 428, text: "Welcome Ava, Grace and Noah! 🎉 Grab a buddy in #general and check the events page — breakfast is on the 18th.", reactions: [{ from: 'user_dev_ava-chen', emoji: '❤️' }, { from: 'user_dev_grace-kim', emoji: '👋' }] },
  { id: 'msg_ld_010', chan: 'chan_localdev_general', from: 'user_dev_maya-patel', hoursAgo: 380, text: "Reminder: Founders' Breakfast this Thursday 7:30am at Harbour Lab. Bring one problem you're stuck on — that's the whole format.", pinned: true, reactions: [{ from: 'user_dev_ava-chen', emoji: '🥐' }, { from: 'user_dev_grace-kim', emoji: '👍' }, { from: 'user_dev_tom-walker', emoji: '👍' }] },
  { id: 'msg_ld_011', chan: 'chan_localdev_general', from: 'user_dev_tom-walker', hoursAgo: 300, text: "Anyone got a recommendation for a good NZ-based accountant who actually understands SaFE notes?" },
  { id: 'msg_ld_012', chan: 'chan_localdev_general', from: 'user_dev_priya-nair', hoursAgo: 298, text: "We send founders to Bellingham & Co — ask for Rachel. Happy to intro.", replyTo: 'msg_ld_011', reactions: [{ from: 'user_dev_tom-walker', emoji: '🙏' }] },
  { id: 'msg_ld_013', chan: 'chan_localdev_general', from: 'user_dev_zoe-clark', hoursAgo: 250, text: "July newsletter is out! Launch night recap + demo day announcement. Forward it to one person who should join us 🙏" },
  { id: 'msg_ld_014', chan: 'chan_localdev_general', from: 'user_dev_liam-oconnor', hoursAgo: 180, text: "Heads up: the level-2 meeting rooms are getting new AV gear Friday morning. Book level 1 if you have calls before noon." },
  { id: 'msg_ld_015', chan: 'chan_localdev_general', from: 'user_dev_jordan-reid', hoursAgo: 96, text: "PSA: if your CI has been slow this week it's not you, GitHub's Sydney runners are degraded. We moved Loopwork's to Auckland self-hosted and it's night and day." },
  { id: 'msg_ld_016', chan: 'chan_localdev_general', from: 'user_dev_ava-chen', hoursAgo: 95, text: "night and day as in… faster? or as in it works at night and breaks during the day", replyTo: 'msg_ld_015', reactions: [{ from: 'user_dev_jordan-reid', emoji: '😂' }, { from: 'user_dev_tom-walker', emoji: '😂' }] },
  { id: 'msg_ld_020', chan: 'chan_localdev_events', from: 'user_dev_maya-patel', hoursAgo: 340, text: "🚀 Spring Demo Day 2026 is locked in: Aug 21, Te Papa. Eight pitch slots, apply via the registration form on the event page. Investors + media confirmed.", pinned: true, reactions: [{ from: 'user_dev_ava-chen', emoji: '🚀' }, { from: 'user_dev_grace-kim', emoji: '🚀' }, { from: 'user_dev_priya-nair', emoji: '🔥' }, { from: 'user_dev_zoe-clark', emoji: '🎉' }] },
  { id: 'msg_ld_021', chan: 'chan_localdev_events', from: 'user_dev_maya-patel', hoursAgo: 260, text: "Launch night recap: ~70 people, zero AV disasters (thanks Liam), and Loopwork 2.0 is live. Photos in the drive, recording coming this week." },
  { id: 'msg_ld_022', chan: 'chan_localdev_events', from: 'user_dev_priya-nair', hoursAgo: 200, text: "Office hours Aug 12 — Daniel Foster is joining me this time. 15-min slots, first come first served on the event page." },
  { id: 'msg_ld_023', chan: 'chan_localdev_events', from: 'user_dev_noah-bennett', hoursAgo: 150, text: "The AI workshop is exactly what I wished existed six months ago. If you're on the waitlist, Felix said he may run a second session in September." },
  { id: 'msg_ld_030', chan: 'chan_localdev_show', from: 'user_dev_jordan-reid', hoursAgo: 220, text: "Shipped: Loopwork 2.0's offline mode. Full CRDT sync, works on a plane, survives the Wellington bus wifi. Blog post with the gory details next week." , reactions: [{ from: 'user_dev_tom-walker', emoji: '🤯' }, { from: 'user_dev_ava-chen', emoji: '❤️' }, { from: 'user_dev_noah-bennett', emoji: '👏' }] },
  { id: 'msg_ld_031', chan: 'chan_localdev_show', from: 'user_dev_sofia-marino', hoursAgo: 130, text: "Pixelforge side project: a free Figma kit of NZ-flavoured illustrations for startup landing pages. Link in the resources library. Use them, remix them, tag us." , reactions: [{ from: 'user_dev_zoe-clark', emoji: '😍' }, { from: 'user_dev_maya-patel', emoji: '🇳🇿' }] },
  { id: 'msg_ld_032', chan: 'chan_localdev_show', from: 'user_dev_grace-kim', hoursAgo: 40, text: "First Fernwave buoy survived 3 weeks in Cook Strait 🌊 Data quality better than the commercial unit we benchmarked against, at a tenth of the cost. Seed deck finally writes itself." , reactions: [{ from: 'user_dev_priya-nair', emoji: '👀' }, { from: 'user_dev_ava-chen', emoji: '🎉' }, { from: 'user_dev_maya-patel', emoji: '🌊' }] },
];

const POSTS = [
  { id: 'post_ld_1', from: 'user_dev_maya-patel', hoursAgo: 350, content: "Welcome to the three newest members of the community — Ava & Jordan (Loopwork) and Grace (Fernwave). Say hi in #intros, and if you've been here a while, offer them a coffee ☕", reactions: [{ from: 'user_dev_ava-chen', emoji: '❤️' }, { from: 'user_dev_grace-kim', emoji: '❤️' }], comments: [{ id: 'pc_ld_1a', from: 'user_dev_ava-chen', text: 'Thanks Maya! The welcome pack is genuinely great.' }] },
  { id: 'post_ld_2', from: 'user_dev_zoe-clark', hoursAgo: 240, content: "Wrote up how we cut Kite's onboarding drop-off by 30% — mostly by deleting steps, honestly. Happy to share the internal doc with anyone wrestling with activation.", reactions: [{ from: 'user_dev_ava-chen', emoji: '👍' }, { from: 'user_dev_sofia-marino', emoji: '👍' }, { from: 'user_dev_noah-bennett', emoji: '💡' }], comments: [{ id: 'pc_ld_2a', from: 'user_dev_ava-chen', text: 'Yes please — DM incoming.' }, { id: 'pc_ld_2b', from: 'user_dev_zoe-clark', text: 'Sent! Also works as a newsletter piece if Maya wants it.', parent: 'pc_ld_2a' }] },
  { id: 'post_ld_3', from: 'user_dev_priya-nair', hoursAgo: 190, content: "Hot take from this morning's partner meeting: NZ pre-seed valuations have stopped being 'a discount on Sydney'. Three of our last four term sheets had competing offers. Founders — leverage is back, use it politely.", reactions: [{ from: 'user_dev_grace-kim', emoji: '👀' }, { from: 'user_dev_ava-chen', emoji: '🔥' }] },
  { id: 'post_ld_4', from: 'user_dev_maya-patel', hoursAgo: 100, content: "Demo Day pitch applications close Friday! 11 in so far. If you're on the fence: the 3 minutes are terrifying and absolutely worth it. Ask anyone who pitched last spring.", reactions: [{ from: 'user_dev_maya-patel', emoji: '⏰' }], comments: [{ id: 'pc_ld_4a', from: 'user_dev_grace-kim', text: 'Submitted 😅 see you all on stage.' }] },
];

const DM_MESSAGES = [
  { id: 'msg_ld_dm1', from: ADMIN, hoursAgo: 120, text: 'Hey — got a sec to sanity-check the demo day pitch shortlist before I send it to Priya?' },
  { id: 'msg_ld_dm2', from: MEMBER, hoursAgo: 119, text: 'Sure, send it over.' },
  { id: 'msg_ld_dm3', from: ADMIN, hoursAgo: 118, text: 'Loopwork, Fernwave, Solace, plus the five from the open applications. Stealth-mode one from Olivia looked surprisingly strong.' },
  { id: 'msg_ld_dm4', from: MEMBER, hoursAgo: 117, text: "Agree on Olivia. Maybe swap one of the open slots for a first-timer though — last time the room loved the rough ones." },
  { id: 'msg_ld_dm5', from: ADMIN, hoursAgo: 116, text: 'Good call. Locking it in tomorrow morning.' },
  { id: 'msg_ld_dm6', from: MEMBER, hoursAgo: 20, text: 'Saw the RSVP numbers — 60 already. Might need the bigger room after all 👀' },
];

// ---- notes (context brains) --------------------------------------------------

function fm(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      const arr = v.filter((x) => x !== null && x !== undefined && x !== '');
      if (!arr.length) continue;
      lines.push(`${k}: [${arr.map((x) => JSON.stringify(String(x))).join(', ')}]`);
    } else {
      lines.push(`${k}: ${JSON.stringify(String(v))}`);
    }
  }
  return lines.join('\n');
}

function stripLeadingHeading(body) {
  const t = body.trim();
  const m = t.match(/^#{1,6}[ \t]+.*(?:\r?\n|$)/);
  return m ? t.slice(m[0].length).replace(/^\s*\r?\n/, '') : t;
}

function note(notes, path, frontmatter, body, pinned = false) {
  notes.push({ path, content: `---\n${fm(frontmatter)}\n---\n\n${stripLeadingHeading(body)}\n`, pinned });
}

// Internal link → graph edge (absolute brain-root href, must include `.md`).
const link = (label, absPath) => `[${label}](${absPath})`;
const person = (slug, label) => link(label, `/people/${slug}.md`);
const company = (slug, label) => link(label, `/companies/${slug}.md`);

function buildSharedNotes() {
  const notes = [];

  note(notes, 'index.md', { type: 'index', title: 'Local Dev Community — Hub', tags: ['index'] }, `
Welcome to the shared brain. Start here.

## The regulars

- ${person('maya-patel', 'Maya Patel')} runs the community from ${company('harbour-lab', 'Harbour Lab')}.
- ${person('ava-chen', 'Ava Chen')} and ${person('jordan-reid', 'Jordan Reid')} are building ${company('loopwork', 'Loopwork')}.
- ${person('priya-nair', 'Priya Nair')} (${company('southern-ridge-capital', 'Southern Ridge Capital')}) and ${person('daniel-foster', 'Daniel Foster')} are our investor contacts.

## Working notes

- [Fundraising landscape](/topics/fundraising-landscape.md)
- [Mentor programme](/programme/mentor-programme.md)
- [Community sync — 14 Jul](/meetings/2026-07-14-community-sync.md)
`);

  note(notes, 'topics/fundraising-landscape.md', { type: 'topic', title: 'Fundraising landscape — winter 2026', tags: ['fundraising'] }, `
Who's raising and who's writing cheques, as of July 2026.

## Raising now

- ${company('loopwork', 'Loopwork')} — seed, led conversations with ${company('southern-ridge-capital', 'Southern Ridge')}; ${person('ava-chen', 'Ava')} is running the round.
- ${company('fernwave', 'Fernwave')} — seed; ${person('grace-kim', 'Grace Kim')} has strong buoy data from Cook Strait now.

## Cheque writers in the room

- ${person('priya-nair', 'Priya Nair')} — seed, fintech + climate.
- ${person('daniel-foster', 'Daniel Foster')} — angel, SaaS + marketplaces; likes rough-stage founders.

Valuations note: per Priya, competing term sheets are back at pre-seed. Leverage exists again.
`);

  note(notes, 'programme/mentor-programme.md', { type: 'topic', title: 'Mentor programme', tags: ['programme', 'mentoring'] }, `
Two cohorts a year. Current mentor bench:

- ${person('oliver-grant', 'Oliver Grant')} — exited marketplace founder, product + hiring.
- ${person('felix-wong', 'Prof. Felix Wong')} (${company('city-university-ai-lab', 'City University AI Lab')}) — anything ML.

Next round: pair ${person('grace-kim', 'Grace')} with Oliver (fundraising narrative), ${person('noah-bennett', 'Noah')} with Felix (eval rigour).
`);

  note(notes, 'meetings/2026-07-14-community-sync.md', { type: 'meeting', title: 'Community sync — 14 Jul 2026', tags: ['meeting'] }, `
Present: ${person('maya-patel', 'Maya')}, ${person('liam-oconnor', 'Liam')}, ${person('zoe-clark', 'Zoe')} (guest).

- Demo Day: 11 pitch applications, shortlist with ${person('priya-nair', 'Priya')} this week.
- AV upgrade at ${company('harbour-lab', 'Harbour Lab')} Friday — level-2 rooms offline in the morning.
- Newsletter: Zoe to fold in ${company('kite-analytics', 'Kite')}'s onboarding write-up.
- Retreat: venue shortlist to two; dates 11–13 Sep pencilled.
`);

  // --- entity notes: people ---
  const p = (slug, title, tags, body) =>
    note(notes, `people/${slug}.md`, { type: 'person', title, tags, node: `person:${slug}` }, body);

  p('maya-patel', 'Maya Patel', ['community'], `
Community manager at ${company('harbour-lab', 'Harbour Lab')} and the reason anything here happens on time. Runs the breakfast series, Demo Day and the mentor programme with ${person('oliver-grant', 'Oliver Grant')}.`);
  p('ava-chen', 'Ava Chen', ['founder', 'saas'], `
Co-founder & CEO of ${company('loopwork', 'Loopwork')} with ${person('jordan-reid', 'Jordan Reid')}. Ex-PM. Running their seed raise — warm with ${company('southern-ridge-capital', 'Southern Ridge')} via ${person('priya-nair', 'Priya Nair')}. Pitched at launch night; pitching again at Demo Day.`);
  p('jordan-reid', 'Jordan Reid', ['founder', 'engineering'], `
Co-founder & CTO of ${company('loopwork', 'Loopwork')}. Ex-Xero staff engineer; built 2.0's offline CRDT sync solo. Good person to ask about infra cost control.`);
  p('sofia-marino', 'Sofia Marino', ['design'], `
Founder of ${company('pixelforge', 'Pixelforge')}. Did the Demo Day poster and the ecosystem map in the resource library. Fast, opinionated, worth the day rate.`);
  p('tom-walker', 'Tom Walker', ['engineering'], `
Senior engineer at ${company('kite-analytics', 'Kite Analytics')} under ${person('isla-murray', 'Isla Murray')}. Runs the monthly hack night at ${company('harbour-lab', 'Harbour Lab')}.`);
  p('priya-nair', 'Priya Nair', ['investor'], `
Associate at ${company('southern-ridge-capital', 'Southern Ridge Capital')}. Most reachable investor in the community — Wednesday office hours, co-hosting the August session with ${person('daniel-foster', 'Daniel Foster')}. Tracking ${company('loopwork', 'Loopwork')} and ${company('fernwave', 'Fernwave')} closely.`);
  p('liam-oconnor', "Liam O'Connor", ['operations'], `
Operations at ${company('harbour-lab', 'Harbour Lab')}. Owns the space, the AV and the coffee machine. Book him early for event logistics.`);
  p('grace-kim', 'Grace Kim', ['founder', 'climate'], `
Founder & CEO of ${company('fernwave', 'Fernwave')}. Ex-NIWA oceanographer. First buoy survived 3 weeks in Cook Strait with better data than the commercial benchmark. Raising seed; mentored by ${person('oliver-grant', 'Oliver Grant')}.`);
  p('noah-bennett', 'Noah Bennett', ['data', 'health'], `
Data scientist at ${company('solace-health', 'Solace Health')} with ${person('ruby-thompson', 'Ruby Thompson')}. Deep on clinical ML evaluation; being paired with ${person('felix-wong', 'Felix Wong')} in the mentor programme.`);
  p('zoe-clark', 'Zoe Clark', ['growth'], `
Head of growth at ${company('kite-analytics', 'Kite Analytics')}. Writes the community newsletter's best sections; cut Kite's onboarding drop-off 30% mostly by deleting steps.`);
  p('daniel-foster', 'Daniel Foster', ['investor', 'angel'], `
Angel, 20+ cheques, exited founder (2019). Likes rough-stage founders and quick decisions. Co-hosting office hours with ${person('priya-nair', 'Priya Nair')} in August.`);
  p('harper-lane', 'Harper Lane', ['media'], `
Covers the NZ startup ecosystem for The Southerly. Came to the ${company('loopwork', 'Loopwork')} launch night; invited to Demo Day. Prefers embargoed briefs a week out.`);
  p('felix-wong', 'Prof. Felix Wong', ['ai', 'research'], `
Directs the ${company('city-university-ai-lab', 'City University AI Lab')}. Running the August AI workshop; may repeat in September given the waitlist. Mentor to ${person('noah-bennett', 'Noah Bennett')}.`);
  p('isla-murray', 'Isla Murray', ['founder', 'analytics'], `
Founded ${company('kite-analytics', 'Kite Analytics')} in 2021 — Series A, ~40 people, the community's scale-up success story. Employs ${person('tom-walker', 'Tom Walker')} and ${person('zoe-clark', 'Zoe Clark')}.`);
  p('oliver-grant', 'Oliver Grant', ['mentor'], `
Exited marketplace founder (2022), now the backbone of the mentor programme. Currently mentoring ${person('grace-kim', 'Grace Kim')} on fundraising narrative.`);
  p('ruby-thompson', 'Ruby Thompson', ['founder', 'health'], `
Clinical psychologist, founder of ${company('solace-health', 'Solace Health')}. Building triage tooling with ${person('noah-bennett', 'Noah Bennett')}. Attending investor office hours in August.`);

  // --- entity notes: companies ---
  const c = (slug, title, tags, body) =>
    note(notes, `companies/${slug}.md`, { type: 'company', title, tags, node: `org:${slug}` }, body);

  c('loopwork', 'Loopwork', ['saas', 'portfolio-watch'], `
Async-first teamwork tool by ${person('ava-chen', 'Ava Chen')} and ${person('jordan-reid', 'Jordan Reid')}. Shipped 2.0 (offline CRDT sync) at July launch night. Raising seed — ${company('southern-ridge-capital', 'Southern Ridge')} in diligence.`);
  c('kite-analytics', 'Kite Analytics', ['analytics', 'scale-up'], `
Product analytics, founded by ${person('isla-murray', 'Isla Murray')} (2021). Series A, ~40 staff. Community members there: ${person('tom-walker', 'Tom Walker')}, ${person('zoe-clark', 'Zoe Clark')}.`);
  c('fernwave', 'Fernwave', ['climate', 'hardware'], `
Marine climate sensors, founded by ${person('grace-kim', 'Grace Kim')}. Cook Strait pilot exceeded the commercial benchmark at a tenth of the cost. Raising seed; on ${person('priya-nair', "Priya's")} watchlist.`);
  c('solace-health', 'Solace Health', ['health', 'ai'], `
Mental-health triage platform, founded by ${person('ruby-thompson', 'Ruby Thompson')}; ${person('noah-bennett', 'Noah Bennett')} leads data science. Careful, eval-heavy ML culture.`);
  c('pixelforge', 'Pixelforge', ['design'], `
${person('sofia-marino', 'Sofia Marino')}'s design studio. House style for half the community's decks; made the Demo Day poster and the free NZ illustration kit.`);
  c('harbour-lab', 'Harbour Lab', ['coworking'], `
The community's physical home on Customhouse Quay. ${person('maya-patel', 'Maya Patel')} runs the community from here; ${person('liam-oconnor', "Liam O'Connor")} runs the building. Hosts breakfasts, launch nights and office hours.`);
  c('southern-ridge-capital', 'Southern Ridge Capital', ['vc'], `
Seed fund covering NZ & the Pacific. ${person('priya-nair', 'Priya Nair')} is the community's contact. Active interest: ${company('loopwork', 'Loopwork')}, ${company('fernwave', 'Fernwave')}.`);
  c('city-university-ai-lab', 'City University AI Lab', ['research', 'ai'], `
Applied AI research lab directed by ${person('felix-wong', 'Felix Wong')}. Runs workshops for the community and takes industry collaborations.`);

  return notes;
}

function buildPersonalNotes() {
  const notes = [];
  note(notes, 'journal.md', { type: 'journal', title: 'Journal' }, `
**Jul 18** — Demo day shortlist nearly done. Olivia's stealth thing is the wildcard.

**Jul 12** — Launch night went great. Note to self: Liam gets a proper thank-you, he saved the livestream twice.

**Jul 02** — Directory cleanup is overdue. CRM stages missing on half the orgs.`, true);
  note(notes, 'follow-ups.md', { type: 'todo', title: 'Follow-ups' }, `
- [ ] Intro Tom → Rachel at Bellingham & Co (accounting)
- [ ] Chase two more Demo Day sponsors
- [ ] Ask Felix about a September workshop rerun
- [x] Send Grace the seed-deck template`);
  note(notes, 'ideas.md', { type: 'note', title: 'Ideas parking lot' }, `
- Founder peer groups of 4, rotating monthly
- "First cheque" panel: Daniel + Priya + one founder who just closed
- Community API keys for the directory so Kite can build a dashboard`);
  return notes;
}

// ---- utilities ---------------------------------------------------------------

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
const daysAgo = (d) => hoursAgo(d * 24);

async function upsertNode(client, { id, type, name, subtitle = null, location = null, url = null, tags = [], imageUrl = null, metadata = {}, alias = null, createdDaysAgo = 60 }) {
  await client.query(
    `INSERT INTO nodes (id, type, name, subtitle, location, url, tags, image_url, metadata, community_id, alias, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, NOW())
     ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
       location = EXCLUDED.location, url = EXCLUDED.url, tags = EXCLUDED.tags, image_url = EXCLUDED.image_url,
       metadata = EXCLUDED.metadata, community_id = EXCLUDED.community_id, alias = EXCLUDED.alias, updated_at = NOW()`,
    [id, type, name, subtitle, location, url, tags, imageUrl, JSON.stringify(metadata), COMM, alias, daysAgo(createdDaysAgo)],
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

// ---- main --------------------------------------------------------------------

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const commCheck = await client.query('SELECT id FROM communities WHERE id = $1', [COMM]);
  if (!commCheck.rowCount) throw new Error(`${COMM} not found — run \`pnpm db:seed\` first`);

  // 1. Community config: node types + aliases (dev community; safe to overwrite)
  console.log('--- Community config ---');
  await client.query(
    `UPDATE communities SET node_types = $2::jsonb, community_aliases = $3::jsonb,
       description = $4, tags = $5, emoji = COALESCE(emoji, '🌱')
     WHERE id = $1`,
    [COMM, JSON.stringify(NODE_TYPES), JSON.stringify(COMMUNITY_ALIASES),
     'A local startup community: founders, operators, investors and friends, headquartered at Harbour Lab.',
     ['dev', 'local', 'startups']],
  );
  console.log(`  ✓ node types + aliases`);

  // 2. Users + memberships + person nodes + Person profiles
  console.log('\n--- Users & people ---');
  for (const u of USERS) {
    const userId = `user_dev_${u.slug}`;
    const nodeId = `person:${u.slug}`;
    const email = `${u.slug}@local.dev`;
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, TRUE, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [userId, u.name, email],
    );
    await client.query(
      `INSERT INTO user_communities (user_id, community_id, role, joined_at, private_meta)
       VALUES ($1, $2, $3, NOW(), '{}'::jsonb)
       ON CONFLICT (user_id, community_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, COMM, u.role],
    );
    await upsertNode(client, {
      id: nodeId, type: 'person', name: u.name, subtitle: u.title, location: u.location,
      tags: u.tags ?? [], alias: u.alias ?? null,
      metadata: { seeded: true, bio: u.bio, experience: u.experience ?? [] },
    });
    await client.query(
      `INSERT INTO persons (id, user_id, name, subtitle, bio, location, website, linkedin_url, tags, metadata, has_onboarded, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle, bio = EXCLUDED.bio,
         location = EXCLUDED.location, website = EXCLUDED.website, linkedin_url = EXCLUDED.linkedin_url,
         tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, has_onboarded = TRUE, updated_at = NOW()`,
      [nodeId, userId, u.name, u.title, u.bio ?? null, u.location ?? null, u.website ?? null, u.linkedin ?? null, u.tags ?? [],
       JSON.stringify({ seeded: true, experience: u.experience ?? [] })],
    );
  }
  console.log(`  ✓ ${USERS.length} users (dev-login) + person profiles`);

  for (const d of DIRECTORY_PEOPLE) {
    await upsertNode(client, {
      id: `person:${d.slug}`, type: 'person', name: d.name, subtitle: d.title, location: d.location,
      tags: d.tags ?? [], alias: d.alias ?? null, metadata: { seeded: true, bio: d.bio },
    });
  }
  console.log(`  ✓ ${DIRECTORY_PEOPLE.length} directory-only people`);

  // 3. Orgs + resource nodes
  for (const o of ORGS) {
    await upsertNode(client, {
      id: `org:${o.slug}`, type: 'Group', name: o.name, subtitle: o.subtitle, location: o.location,
      url: o.url, tags: o.tags ?? [], alias: o.alias ?? null, metadata: { seeded: true },
    });
  }
  for (const r of RESOURCE_NODES) {
    await upsertNode(client, {
      id: `resource:${r.slug}`, type: 'resource', name: r.name, subtitle: r.subtitle, url: r.url,
      tags: r.tags ?? [], metadata: { seeded: true },
    });
  }
  console.log(`  ✓ ${ORGS.length} orgs, ${RESOURCE_NODES.length} resource nodes`);

  // 4. CRM columns + values
  console.log('\n--- CRM ---');
  const columnIdByKey = new Map();
  for (let i = 0; i < CRM_COLUMNS.length; i++) {
    const col = CRM_COLUMNS[i];
    const r = await client.query(
      `INSERT INTO community_columns (community_id, column_key, column_name, column_type, options, position, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
       ON CONFLICT (community_id, column_key) DO UPDATE SET column_name = EXCLUDED.column_name,
         column_type = EXCLUDED.column_type, options = EXCLUDED.options, position = EXCLUDED.position
       RETURNING id`,
      [COMM, col.key, col.name, col.type, col.options ? JSON.stringify(col.options) : null, i],
    );
    columnIdByKey.set(col.key, r.rows[0].id);
  }
  let crmCount = 0;
  for (const [nodeId, values] of Object.entries(CRM_VALUES)) {
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      await client.query(
        `INSERT INTO community_column_values (community_id, node_id, column_key, column_id, value, contributed_by_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (community_id, node_id, column_key) DO UPDATE SET value = EXCLUDED.value,
           column_id = EXCLUDED.column_id, updated_at = NOW()`,
        [COMM, nodeId, key, columnIdByKey.get(key), String(value), ADMIN],
      );
      crmCount++;
    }
  }
  console.log(`  ✓ ${CRM_COLUMNS.length} columns, ${crmCount} values`);

  // 5. Events + attendees + attended/hosting links
  console.log('\n--- Events ---');
  let attendeeCount = 0;
  for (const e of EVENTS) {
    const eventId = `event:${e.slug}`;
    const rows = ATTENDEES[e.slug] ?? [];
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

  // 6. Tasks — columns upserted by name; seed tasks replaced wholesale (marker
  // = created_by is a seeded user), so re-runs converge without duplicating.
  console.log('\n--- Tasks ---');
  const taskColIds = new Map();
  for (let i = 0; i < TASK_COLUMNS.length; i++) {
    const tc = TASK_COLUMNS[i];
    const existing = await client.query(
      'SELECT id FROM task_columns WHERE community_id = $1 AND name = $2 LIMIT 1', [COMM, tc.name],
    );
    if (existing.rowCount) {
      await client.query('UPDATE task_columns SET color = $2, position = $3 WHERE id = $1', [existing.rows[0].id, tc.color, i]);
      taskColIds.set(tc.name, existing.rows[0].id);
    } else {
      const r = await client.query(
        'INSERT INTO task_columns (community_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id',
        [COMM, tc.name, tc.color, i],
      );
      taskColIds.set(tc.name, r.rows[0].id);
    }
  }
  await client.query(`DELETE FROM tasks WHERE community_id = $1 AND created_by = $2`, [COMM, ADMIN]);
  let pos = 0;
  for (const t of TASKS) {
    pos += 1000;
    await client.query(
      `INSERT INTO tasks (community_id, column_id, title, description, assignee_id, due_date, labels, position, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - interval '14 days', NOW())`,
      [COMM, taskColIds.get(t.col), t.title, t.description ?? '', t.assignee ?? null,
       t.due ? new Date(`${t.due}T17:00:00+12:00`) : null, t.labels ?? [], pos, ADMIN],
    );
  }
  console.log(`  ✓ ${TASK_COLUMNS.length} columns, ${TASKS.length} tasks`);

  // 7. Resource library (files under /uploads/seed, marker = metadata.seeded)
  console.log('\n--- Resource library ---');
  await client.query(`DELETE FROM resources WHERE community_id = $1 AND metadata->>'seeded' = 'true'`, [COMM]);
  const resourceIdByFile = new Map();
  for (const r of FILE_RESOURCES) {
    const row = await client.query(
      `INSERT INTO resources (community_id, name, file_type, file_url, file_size, uploaded_by, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{"seeded": "true"}'::jsonb, $7) RETURNING id`,
      [COMM, r.name, r.fileType, `/uploads/seed/${r.file}`, r.size ?? 4096, r.uploadedBy, daysAgo(r.daysAgo)],
    );
    resourceIdByFile.set(r.file, row.rows[0].id);
  }
  await client.query(
    `INSERT INTO resource_comments (resource_id, cell_ref, author, content, created_at)
     VALUES ($1, 'C4', 'Maya Patel', 'Venue quote came in $400 under — updated.', NOW() - interval '5 days'),
            ($1, NULL, 'Dev Admin', 'Nice work keeping this current.', NOW() - interval '3 days')`,
    [resourceIdByFile.get('demo-day-budget.csv')],
  );
  console.log(`  ✓ ${FILE_RESOURCES.length} files + 2 comments`);

  // 8. Channels + messages
  console.log('\n--- Channels & messages ---');
  for (const s of SPACES) {
    await client.query(
      `INSERT INTO channel_spaces (id, community_id, name, emoji, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, position = EXCLUDED.position`,
      [s.id, COMM, s.name, s.emoji, s.position],
    );
  }
  const allUserIds = [ADMIN, MEMBER, ...USERS.map((u) => `user_dev_${u.slug}`)];
  for (const ch of CHANNELS) {
    await client.query(
      `INSERT INTO conversations (id, type, name, description, icon, community_id, space_id, created_by_id, created_at, updated_at)
       VALUES ($1, 'CHANNEL', $2, $3, $4, $5, $6, $7, NOW() - interval '30 days', NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         icon = EXCLUDED.icon, space_id = EXCLUDED.space_id, updated_at = NOW()`,
      [ch.id, ch.name, ch.description, ch.icon, COMM, ch.space, ADMIN],
    );
    for (const uid of allUserIds) {
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, $3::"ConversationMemberRole", NOW() - interval '30 days')
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

  // 9. Feed posts
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

  // 10. Anchor DM
  const dmKey = [ADMIN, MEMBER].sort().join(':');
  const dm = await client.query(
    `INSERT INTO conversations (id, type, dm_key, created_by_id, created_at, updated_at)
     VALUES ('conv_localdev_dm_anchors', 'DM', $1, $2, NOW() - interval '10 days', NOW())
     ON CONFLICT (dm_key) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [dmKey, ADMIN],
  );
  const dmId = dm.rows[0].id;
  for (const uid of [ADMIN, MEMBER]) {
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, joined_at)
       VALUES ($1, $2, NOW() - interval '10 days') ON CONFLICT (conversation_id, user_id) DO NOTHING`,
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
  console.log(`  ✓ anchor DM (${DM_MESSAGES.length} messages)`);

  // 11. Notes (shared + admin personal brains)
  console.log('\n--- Context notes ---');
  const withStar = (content, starred) =>
    starred ? content.replace(/^---\n/, '---\nstarred: true\n') : content;
  const shared = buildSharedNotes();
  const personal = buildPersonalNotes();
  for (const { ownerKey, notes } of [{ ownerKey: SHARED, notes: shared }, { ownerKey: ADMIN, notes: personal }]) {
    for (const n of notes) {
      await client.query(
        `INSERT INTO community_notes (community_id, owner_key, path, content, created_by, starred, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (community_id, owner_key, path)
         DO UPDATE SET content = EXCLUDED.content, starred = EXCLUDED.starred, deleted_at = NULL, deleted_path = NULL, updated_at = now()`,
        [COMM, ownerKey, n.path, withStar(n.content, n.pinned), ADMIN, !!n.pinned],
      );
    }
  }
  console.log(`  ✓ ${shared.length} shared + ${personal.length} personal notes`);

  // 12. member_count
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
  console.log('--- Link breakdown ---');
  console.table((await client.query(
    'SELECT relationship, origin, COUNT(*)::int AS count FROM links WHERE community_id = $1 GROUP BY 1, 2 ORDER BY 1', [COMM],
  )).rows);

  console.log('\nNext: materialize context-note links with');
  console.log('  pnpm db:context-links:backfill community:local-dev');
  console.log('(pnpm db:dev:full runs both steps automatically)');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
