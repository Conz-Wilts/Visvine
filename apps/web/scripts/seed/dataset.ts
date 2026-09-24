/**
 * Everything in the Blackbird space that is not the portfolio (./portfolio.ts)
 * or the team (./team.ts): dealflow, events, channels and the Drive.
 *
 * Two kinds of content, kept apart on purpose:
 *
 *   - PUBLIC facts, as Blackbird has published them: the fund table
 *     (blackbird.vc/investors, 11 August 2026), Sunrise Aotearoa 2026, the
 *     Giants and Foundry programmes, and portfolio news Blackbird itself has
 *     written about. Dates and figures are theirs.
 *   - WORKING state a firm never publishes: live deals, internal meetings,
 *     what the team says in channels. None of it is knowable, so none of it
 *     pretends to be: deals are codenames (`Project Kea`) for companies that
 *     do not exist, and channel messages only discuss what is already public.
 *
 * Adding a company is an edit to ./portfolio.ts; the directory, notes, sector
 * pages and roll-ups all follow. Adding a deal is an entry in DEALS.
 */

import { PORTFOLIO } from './portfolio'
import { SECTORS, type Sector } from './space'

// ---- dealflow ---------------------------------------------------------------

export type DealStage = 'First meeting' | 'Partner meeting' | 'Diligence' | 'Investment committee' | 'Passed'

export const DEAL_STAGES: readonly DealStage[] = [
  'Investment committee',
  'Diligence',
  'Partner meeting',
  'First meeting',
  'Passed',
]

export interface SeedDeal {
  /** The codename is the whole identity — the company stays unnamed. */
  codename: string
  what: string
  sector: Sector
  city: string
  round: string
  stage: DealStage
  /** Team members by name. */
  owners: string[]
  /** How it reached us. */
  source: string
  next: string
  thinking: string
}

export const DEALS: SeedDeal[] = [
  {
    codename: 'Project Banksia',
    what: 'Clinical documentation for allied health, from the session audio',
    sector: 'Healthcare',
    city: 'Melbourne',
    round: 'Seed',
    stage: 'Investment committee',
    owners: ['Michael Tolo', 'Tristan Edwards'],
    source: 'Introduced by a portfolio founder',
    next: 'Committee on Monday; memo circulated Friday.',
    thinking:
      'Two physiotherapists who built the first version for their own clinic, now in forty. The question is whether allied health is a wedge or a ceiling next to the general scribes.',
  },
  {
    codename: 'Project Wattle',
    what: 'Long-duration storage for regional grids',
    sector: 'Deep Tech',
    city: 'Adelaide',
    round: 'Pre-seed',
    stage: 'Diligence',
    owners: ['Silk Kadala'],
    source: 'Foundry alumni',
    next: 'Technical reference call with an independent grid engineer.',
    thinking:
      'The chemistry is the easy part to believe; the first customer is not. Diligence is mostly about who signs the first offtake and when.',
  },
  {
    codename: 'Project Tūī',
    what: 'AI associate for mid-sized accounting firms',
    sector: 'Enterprise',
    city: 'Auckland',
    round: 'Seed',
    stage: 'Partner meeting',
    owners: ['James Palmer', 'Jessica Tulp'],
    source: 'Inbound through Get Investment',
    next: 'Partner meeting Thursday, Auckland.',
    thinking:
      'Crowded category, unusual founders: two ex-practice managers who have lived the month-end close. Worth the hour to hear how they sell to firms that hate changing software.',
  },
  {
    codename: 'Project Kea',
    what: 'Robotic picking for cool-store logistics',
    sector: 'Hardware',
    city: 'Christchurch',
    round: 'Pre-seed',
    stage: 'First meeting',
    owners: ['Georgia Robertson'],
    source: 'Met at a Giants session',
    next: 'Visit the pilot site.',
    thinking: 'A hardware founder who has already shipped once. Too early to have a view beyond wanting a second meeting.',
  },
  {
    codename: 'Project Kōwhai',
    what: 'Engineered microbes that make a dairy protein',
    sector: 'Deep Tech',
    city: 'Brisbane',
    round: 'Pre-seed',
    stage: 'First meeting',
    owners: ['Saron Berhane', 'Maddy Guest'],
    source: 'Foundry cohort 6',
    next: 'Read the titre data they sent.',
    thinking: 'Three PhDs and a supervisor. The science is further along than the company, which is the usual order.',
  },
  {
    codename: 'Project Quokka',
    what: 'Test generation for data pipelines',
    sector: 'Enterprise',
    city: 'Sydney',
    round: 'Seed',
    stage: 'Passed',
    owners: ['Tom Humphrey', 'Max Meyer'],
    source: 'Introduced by an LP',
    next: 'Wrote back with the reasons; offered to meet again at their next round.',
    thinking:
      'Good team, real usage, and a product the warehouses are shipping for free. Passed on the market, not the people.',
  },
]

// ---- events -----------------------------------------------------------------

export interface SeedEventAttendee {
  /** Stable suffix for the attendee id, unique within the event. */
  n: number
  /** A person in the directory, by name — resolved to their node. */
  name?: string
  email: string
  /** A person node id, for the anchors. */
  person?: string
  company?: string
  role?: string
  status: 'going' | 'waitlisted' | 'pending' | 'checked_in' | 'no_show' | 'cancelled' | 'invited'
  response?: 'going' | 'maybe' | 'declined'
  plusOnes?: number
  plusOneNames?: string[]
  answers?: Record<string, unknown>
}

export interface SeedEvent {
  /**
   * The space that OWNS the event — a sub-space id for a room's own event,
   * which the house then reads rolled up (lib/events/rollup.ts). Default: the
   * house itself.
   */
  space?: string
  slug: string
  name: string
  description: string
  /** A published date: ISO start and end, each with its own offset. */
  startAt?: string
  endAt?: string
  /** Otherwise relative: days from now (negative is past) at local hours. */
  startInDays?: number
  startHour?: number
  endHour?: number
  timezone?: string
  locationLabel: string
  locationAddress: string
  lat: number
  lon: number
  visibility: 'space' | 'public'
  capacity: number
  views: number
  waitlistEnabled?: boolean
  allowPlusOnes?: number
  guestListVisible?: boolean
  form?: {
    enabled: boolean
    slug: string
    requireApproval?: boolean
    schema: Array<Record<string, unknown>>
  }
  attendees?: SeedEventAttendee[]
}

const teamEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@blackbird.example.com`
const team = (n: number, name: string, status: SeedEventAttendee['status'] = 'going'): SeedEventAttendee => ({
  n,
  name,
  email: teamEmail(name),
  company: 'Blackbird',
  status,
  response: status === 'cancelled' ? 'declined' : 'going',
})

const sunriseForm = {
  enabled: true,
  slug: 'sunrise-aotearoa-2026',
  schema: [
    {
      id: 'ticket',
      label: 'Ticket',
      type: 'select',
      required: true,
      options: ['General', 'Founder', 'Student'],
    },
    { id: 'building', label: 'What are you building?', type: 'text', placeholder: 'One line is plenty' },
    { id: 'matchmaking', label: '1:1 matchmaking', type: 'checkbox' },
    { id: 'dietary', label: 'Dietary requirements', type: 'text', placeholder: 'Vegetarian, GF, …' },
  ],
}

export const EVENTS: SeedEvent[] = [
  {
    space: 'programs',
    slug: 'sunrise-aotearoa-2026',
    name: 'Sunrise Aotearoa 2026',
    description:
      'Blackbird’s love letter to founders and the beautiful things they create. Keynotes on the Visions Stage, hands-on workshops, 1:1 matchmaking and the Sunset afterparty.',
    startAt: '2026-10-29T09:00:00+13:00',
    endAt: '2026-10-29T20:00:00+13:00',
    timezone: 'Pacific/Auckland',
    locationLabel: 'ASB Waterfront Theatre',
    locationAddress: '138 Halsey Street, Wynyard Quarter, Auckland',
    lat: -36.8434,
    lon: 174.7569,
    visibility: 'public',
    capacity: 650,
    views: 4210,
    waitlistEnabled: true,
    guestListVisible: false,
    form: sunriseForm,
    attendees: [
      { n: 1, name: 'Connor Archbold', email: 'connor.archbold@tracksuit.example.com', company: 'Tracksuit', role: 'Speaker', status: 'going', response: 'going' },
      { n: 2, name: 'Tim Doyle', email: 'tim.doyle@eucalyptus.example.com', company: 'Eucalyptus', role: 'Speaker', status: 'going', response: 'going' },
      { n: 3, name: 'Andrew Fraser', email: 'andrew.fraser@halter.example.com', company: 'Halter', role: 'Speaker', status: 'going', response: 'going' },
      { n: 4, name: 'Malindi Maclean', email: 'malindi.maclean@halter.example.com', company: 'Halter', role: 'Speaker', status: 'going', response: 'going' },
      { ...team(5, 'Katie Tholo'), role: 'Producer' },
      { ...team(6, 'Phoebe Harrop'), role: 'Partner' },
      {
        n: 7,
        person: 'person:dev-member',
        email: 'member@local.dev',
        status: 'going',
        response: 'going',
        answers: { ticket: 'Founder', building: 'Something early', matchmaking: true, dietary: '' },
      },
    ],
  },
  {
    space: 'programs',
    slug: 'foundry-cohort-7-kickoff',
    name: 'Foundry Cohort 7 — Kickoff',
    description:
      'Ten research teams, eight weeks. The first seminar: choosing your wedge, and what the next twelve months have to prove.',
    startInDays: -16,
    startHour: 17,
    endHour: 19,
    locationLabel: 'Online and Sydney',
    locationAddress: 'Hybrid',
    lat: -33.8688,
    lon: 151.2093,
    visibility: 'space',
    capacity: 40,
    views: 96,
    attendees: [
      { ...team(1, 'Saron Berhane', 'checked_in'), role: 'Foundry Lead' },
      { ...team(2, 'Tristan Edwards', 'checked_in'), role: 'Investment Associate' },
      { n: 3, person: 'person:dev-admin', email: 'admin@local.dev', status: 'checked_in', response: 'going' },
    ],
  },
  {
    space: 'programs',
    slug: 'foundry-cohort-7-pitch-night',
    name: 'Foundry Cohort 7 — Pitch Night',
    description: 'The end of the program: every team pitches, a panel of judges picks one, and the winner takes the A$5k prize with no strings attached.',
    startInDays: 58,
    startHour: 17,
    endHour: 21,
    locationLabel: 'Blackbird, Sydney',
    locationAddress: 'Sydney NSW',
    lat: -33.8688,
    lon: 151.2093,
    visibility: 'public',
    capacity: 120,
    views: 388,
    guestListVisible: true,
    attendees: [
      { ...team(1, 'Saron Berhane'), role: 'Foundry Lead' },
      { ...team(2, 'Michael Tolo'), role: 'Judge' },
      { n: 3, person: 'person:dev-member', email: 'member@local.dev', status: 'pending', response: 'maybe' },
    ],
  },
  {
    space: 'programs',
    slug: 'giants-sydney-closing-night',
    name: 'Giants Sydney — Closing Night',
    description: 'The last Tuesday of the Sydney cohort. Five weeks of mentoring sessions, and the founders who turned up to every one.',
    startAt: '2026-04-28T17:00:00+10:00',
    endAt: '2026-04-28T20:00:00+10:00',
    timezone: 'Australia/Sydney',
    locationLabel: 'Sydney CBD',
    locationAddress: 'Sydney NSW',
    lat: -33.8688,
    lon: 151.2093,
    visibility: 'space',
    capacity: 80,
    views: 214,
    attendees: [
      { ...team(1, 'Josephine Tay', 'checked_in'), role: 'Giants Program Manager' },
      { n: 2, person: 'person:dev-member', email: 'member@local.dev', status: 'checked_in', response: 'going' },
    ],
  },
  {
    space: 'programs',
    slug: 'giants-melbourne-closing-night',
    name: 'Giants Melbourne — Closing Night',
    description: 'The last Tuesday of the Melbourne cohort, 5pm to 8pm near the CBD.',
    startAt: '2026-05-26T17:00:00+10:00',
    endAt: '2026-05-26T20:00:00+10:00',
    timezone: 'Australia/Melbourne',
    locationLabel: 'Melbourne CBD',
    locationAddress: 'Melbourne VIC',
    lat: -37.8136,
    lon: 144.9631,
    visibility: 'space',
    capacity: 60,
    views: 151,
    attendees: [
      { ...team(1, 'Josephine Tay', 'checked_in'), role: 'Giants Program Manager' },
      { ...team(2, 'Max Meyer', 'checked_in'), role: 'Mentor' },
    ],
  },
  {
    slug: 'monday-investment-meeting',
    name: 'Monday Investment Meeting',
    description: 'The whole investment team, every Monday. New companies first, then anything heading to committee.',
    startInDays: -3,
    startHour: 9,
    endHour: 11,
    locationLabel: 'Sydney, Melbourne, Auckland and online',
    locationAddress: 'Video call',
    lat: -33.8688,
    lon: 151.2093,
    visibility: 'space',
    capacity: 30,
    views: 58,
    attendees: [
      { n: 1, person: 'person:dev-admin', email: 'admin@local.dev', status: 'checked_in', response: 'going' },
      team(2, 'Niki Scevak', 'checked_in'),
      team(3, 'Samantha Wong', 'checked_in'),
      team(4, 'Michael Tolo', 'checked_in'),
      team(5, 'Tom Humphrey', 'checked_in'),
      team(6, 'Silk Kadala', 'checked_in'),
    ],
  },
  {
    slug: 'auckland-founders-dinner',
    name: 'Auckland Founders Dinner',
    description: 'The night before Sunrise: a long table for founders in town for the festival.',
    startAt: '2026-10-28T18:30:00+13:00',
    endAt: '2026-10-28T21:30:00+13:00',
    timezone: 'Pacific/Auckland',
    locationLabel: 'Auckland',
    locationAddress: 'Wynyard Quarter, Auckland',
    lat: -36.8412,
    lon: 174.7575,
    visibility: 'space',
    capacity: 24,
    views: 73,
    attendees: [
      team(1, 'Phoebe Harrop'),
      team(2, 'Samantha Wong'),
      team(3, 'James Palmer'),
      team(4, 'Georgia Robertson'),
      team(5, 'Jessica Tulp'),
      { n: 6, person: 'person:dev-member', email: 'member@local.dev', status: 'going', response: 'going' },
    ],
  },
  {
    space: 'fund-operations',
    slug: 'lp-annual-meeting-2026',
    name: 'LP Annual Meeting 2026',
    description: 'The year for our investors: the fund table, the portfolio, and founders on stage rather than slides.',
    startInDays: 41,
    startHour: 14,
    endHour: 18,
    locationLabel: 'Sydney',
    locationAddress: 'Sydney NSW',
    lat: -33.8688,
    lon: 151.2093,
    visibility: 'space',
    capacity: 200,
    views: 122,
    attendees: [
      team(1, 'Jasmin Jenkins'),
      team(2, 'Tom Harvey'),
      team(3, 'Alex Apoifis'),
      team(4, 'Sean Weston'),
    ],
  },
]

// ---- channels ---------------------------------------------------------------

/** Icons are OWNED icon names (assets/icons), never emoji — see docs/icons.md. */
export const CHANNEL_SECTIONS = [
  { id: 'section_bb_firm', name: 'Firm', icon: 'sparkles', position: 0 },
  { id: 'section_bb_portfolio', name: 'Portfolio', icon: 'trending-up', position: 1 },
]

// `portfolio-news` is posts rather than chat, so the seeded Feed has something in it.
export const CHANNELS: Array<{ id: string; name: string; icon: string; section: string; description: string; viewMode?: 'CHAT' | 'FEED' }> = [
  { id: 'chan_bb_general', name: 'general', icon: 'hash', section: 'section_bb_firm', description: 'Everything that does not have a better home.' },
  { id: 'chan_bb_investments', name: 'investments', icon: 'lightbulb', section: 'section_bb_firm', description: 'Rivers of inquiry, memos and the Monday meeting.' },
  { id: 'chan_bb_sunrise', name: 'sunrise', icon: 'rocket', section: 'section_bb_firm', description: 'Sunrise Aotearoa 2026 — 29 October, ASB Waterfront Theatre.' },
  { id: 'chan_bb_portfolio_news', name: 'portfolio-news', icon: 'handshake', section: 'section_bb_portfolio', description: 'Rounds, launches and exits across the portfolio.', viewMode: 'FEED' as const },
  { id: 'chan_bb_dealflow', name: 'dealflow', icon: 'target', section: 'section_bb_portfolio', description: 'Live deals, by codename. Every stage change gets a line here.' },
  { id: 'chan_bb_platform', name: 'platform', icon: 'bell', section: 'section_bb_portfolio', description: 'Help for founders: intros, hiring, the jobs board.' },
]

export interface SeedMessage {
  id: string
  chan: string
  /** 'admin' | 'member' — resolved to the anchor user ids at write time. */
  from: 'admin' | 'member'
  hoursAgo: number
  text: string
  pinned?: boolean
  replyTo?: string
  reactions?: Array<{ from: 'admin' | 'member'; emoji: string }>
}

/** Hours between a date and today's seed run, for news with a published date. */
const hoursSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))

export const MESSAGES: SeedMessage[] = [
  {
    id: 'msg_bb_001',
    chan: 'chan_bb_general',
    from: 'admin',
    hoursAgo: 400,
    text: 'Sunrise Aotearoa is Thursday 29 October at the ASB Waterfront Theatre. Registration from 8am, program 9am to 8pm, then the Sunset afterparty.',
    pinned: true,
  },
  { id: 'msg_bb_002', chan: 'chan_bb_general', from: 'member', hoursAgo: 190, text: 'Is Foundry still taking applications? A lab team I know has a synbio idea that is much further along than their company.' },
  {
    id: 'msg_bb_003',
    chan: 'chan_bb_general',
    from: 'admin',
    hoursAgo: 188,
    text: 'Cohort 7 closed in August and is under way now. Point them at the Foundry page for the next EOI — Saron reviews applications weekly and gives feedback.',
    replyTo: 'msg_bb_002',
    reactions: [{ from: 'member', emoji: '🙏' }],
  },
  { id: 'msg_bb_004', chan: 'chan_bb_general', from: 'admin', hoursAgo: 30, text: 'Every portfolio record now carries a link to its Blackbird page and to our investment notes on it.' },

  {
    id: 'msg_bb_010',
    chan: 'chan_bb_investments',
    from: 'admin',
    hoursAgo: 72,
    text: 'Monday meeting notes are up. Banksia goes to committee next week; Quokka is a pass on the market, not the people.',
    pinned: true,
  },
  { id: 'msg_bb_011', chan: 'chan_bb_investments', from: 'admin', hoursAgo: 260, text: 'Re-reading "Goodbye, SaaS. Welcome, SaiS." before Tūī — the four stages are a useful frame for anyone selling AI into professional services.' },
  { id: 'msg_bb_012', chan: 'chan_bb_investments', from: 'admin', hoursAgo: 20, text: 'Memo template updated in the Drive: the "why now" section comes before the market, not after it.' },

  {
    id: 'msg_bb_020',
    chan: 'chan_bb_portfolio_news',
    from: 'admin',
    hoursAgo: hoursSince('2026-09-22T09:00:00+10:00'),
    text: 'Heidi has announced US$340M: a US$100M Series C led by Blackbird at a US$900M valuation, and US$240M led by General Catalyst.',
    pinned: true,
    reactions: [{ from: 'member', emoji: '🚀' }],
  },
  { id: 'msg_bb_021', chan: 'chan_bb_portfolio_news', from: 'admin', hoursAgo: hoursSince('2026-08-11T09:00:00+10:00'), text: 'SafetyCulture is now Mitti. Same company, same founder as Executive Chairman, new name.' },
  { id: 'msg_bb_022', chan: 'chan_bb_portfolio_news', from: 'member', hoursAgo: hoursSince('2026-07-29T09:00:00+10:00'), text: 'Our note on Superstat is up — Maddy and Niki on the founders building sport’s data layer.', reactions: [{ from: 'admin', emoji: '⚽' }] },
  { id: 'msg_bb_023', chan: 'chan_bb_portfolio_news', from: 'admin', hoursAgo: hoursSince('2026-07-21T09:00:00+10:00'), text: 'Two portfolio companies join forces: Tracksuit has acquired Hall, adding AI visibility to its brand tracking.' },
  { id: 'msg_bb_024', chan: 'chan_bb_portfolio_news', from: 'admin', hoursAgo: hoursSince('2026-06-02T09:00:00+10:00'), text: 'Eucalyptus has completed its sale to Hims & Hers and becomes its International division.' },
  { id: 'msg_bb_025', chan: 'chan_bb_portfolio_news', from: 'member', hoursAgo: hoursSince('2026-04-29T09:00:00+10:00'), text: 'Marloo raised a US$10M seed, led by Blackbird again. A year ago there was no product.' },
  { id: 'msg_bb_026', chan: 'chan_bb_portfolio_news', from: 'admin', hoursAgo: hoursSince('2026-03-25T09:00:00+11:00'), text: 'Halter’s Series E: US$220M at a US$2B valuation, led by Founders Fund.', reactions: [{ from: 'member', emoji: '🐄' }] },

  { id: 'msg_bb_030', chan: 'chan_bb_sunrise', from: 'admin', hoursAgo: 340, text: 'Speakers so far: Tim Doyle (Eucalyptus), Connor Archbold (Tracksuit), Andrew Fraser and Malindi Maclean (Halter), Ben Shewry, Michelle Walshe. Full program drops in early October.', pinned: true },
  { id: 'msg_bb_031', chan: 'chan_bb_sunrise', from: 'member', hoursAgo: 120, text: 'Are student tickets still available?' },
  { id: 'msg_bb_032', chan: 'chan_bb_sunrise', from: 'admin', hoursAgo: 118, text: 'A limited number — email sunrise@blackbird.vc from a student address.', replyTo: 'msg_bb_031' },

  { id: 'msg_bb_040', chan: 'chan_bb_dealflow', from: 'admin', hoursAgo: 300, text: 'Wattle moved to diligence. Silk is lining up an independent grid engineer for the technical reference.' },
  { id: 'msg_bb_041', chan: 'chan_bb_dealflow', from: 'admin', hoursAgo: 170, text: 'Tūī: partner meeting Thursday in Auckland. James and Jess own it.' },
  { id: 'msg_bb_042', chan: 'chan_bb_dealflow', from: 'admin', hoursAgo: 75, text: 'Quokka is a pass. Tom wrote back with the reasons and offered to meet at their next round.', reactions: [{ from: 'admin', emoji: '🫡' }] },
  { id: 'msg_bb_043', chan: 'chan_bb_dealflow', from: 'admin', hoursAgo: 26, text: 'Banksia to committee Monday. Memo out Friday.' },

  { id: 'msg_bb_050', chan: 'chan_bb_platform', from: 'member', hoursAgo: 210, text: 'Where is the best place to post a founding-engineer role so the portfolio sees it?' },
  { id: 'msg_bb_051', chan: 'chan_bb_platform', from: 'admin', hoursAgo: 208, text: 'The Startup Jobs board — it is in the Directory under Resources.', replyTo: 'msg_bb_050' },
]

// ---- files ------------------------------------------------------------------

export interface SeedFile {
  file: string
  name: string
  fileType: string
  daysAgo: number
  body: string
}

/** The portfolio cut by Blackbird's categories — computed, so it never drifts. */
function portfolioBySector(): string {
  const rows = SECTORS.map((sector) => {
    const list = PORTFOLIO.filter((c) => c.sector === sector)
    const years = list.map((c) => c.invested).filter((y): y is number => typeof y === 'number')
    const count = (s: string) => list.filter((c) => c.status === s).length
    return [
      sector,
      list.length,
      count('Active'),
      count('Acquired') + count('IPO'),
      count('Closed'),
      years.length ? Math.min(...years) : '',
      years.length ? Math.max(...years) : '',
    ].join(',')
  })
  return ['sector,companies,active,exited,closed,first_invested,latest_invested', ...rows].join('\n')
}

/** blackbird.vc/investors, data at 11 August 2026, AUD, discretionary funds only. */
export const FUND_TABLE = [
  { vintage: 2013, committed: '$29M', investments: 20, called: '96.0%', tvpi: '43.32x', irr: '47.55%' },
  { vintage: 2015, committed: '$193M', investments: 31, called: '97.3%', tvpi: '15.13x', irr: '35.86%' },
  { vintage: 2018, committed: '$261M', investments: 35, called: '96.3%', tvpi: '5.30x', irr: '27.86%' },
  { vintage: 2020, committed: '$647M', investments: 58, called: '95.4%', tvpi: '2.20x', irr: '16.78%' },
  { vintage: 2022, committed: '$1,032M', investments: 85, called: '87.7%', tvpi: '1.38x', irr: '14.75%' },
] as const

export const FILE_RESOURCES: SeedFile[] = [
  {
    file: 'portfolio-by-sector.csv',
    name: 'Portfolio by sector',
    fileType: 'csv',
    daysAgo: 6,
    body: portfolioBySector(),
  },
  {
    file: 'fund-performance.csv',
    name: 'Fund performance (Aug 2026)',
    fileType: 'csv',
    daysAgo: 44,
    body: [
      'vintage,committed_aud,core_investments,called_pct,net_tvpi,net_irr_pct',
      ...FUND_TABLE.map((f) =>
        [f.vintage, f.committed.replace(/[$,M]/g, ''), f.investments, f.called.replace('%', ''), f.tvpi.replace('x', ''), f.irr.replace('%', '')].join(','),
      ),
    ].join('\n'),
  },
  {
    file: 'sunrise-aotearoa-run-sheet.md',
    name: 'Sunrise Aotearoa run sheet',
    fileType: 'md',
    daysAgo: 9,
    body: [
      '# Sunrise Aotearoa 2026 — run sheet',
      '',
      'Thursday 29 October 2026, ASB Waterfront Theatre, Auckland.',
      '',
      '| Time | What |',
      '| --- | --- |',
      '| 8.00am | Registration opens |',
      '| 9.00am | Visions Stage opens |',
      '| All day | Hands-on workshops · 1:1 matchmaking through the festival app |',
      '| Midday | Lunch (fully catered) |',
      '| Close | Sunset afterparty, until 8.00pm |',
      '',
      '## Speakers announced',
      '- Tim Doyle — Co-founder & CEO, Eucalyptus',
      '- Connor Archbold — CEO & Co-founder, Tracksuit',
      '- Andrew Fraser — President, Halter',
      '- Malindi Maclean — VP Customer, Halter',
      '- Ben Shewry — Owner & Chef, Attica',
      '- Michelle Walshe — Co-founder & CEO, CoachMate',
      '',
      '## Sponsors',
      'Airwallex · HSBC Innovation Banking · OpenAI · Stripe',
      '',
      'Full program and schedule are released in early October.',
    ].join('\n'),
  },
  {
    file: 'investment-memo-template.md',
    name: 'Investment memo template',
    fileType: 'md',
    daysAgo: 1,
    body: [
      '# <Codename> — investment memo',
      '',
      '## The founders',
      'Who they are, what they have done, and why they are the people for this.',
      '',
      '## Why now',
      'What changed in the world that makes this possible, or necessary, today.',
      '',
      '## The idea at its most ambitious',
      'Not the first product. What it is if everything works.',
      '',
      '## What we have to believe',
      'Three or four statements. Each one we could be wrong about.',
      '',
      '## The round',
      'Size, lead, our cheque, what it buys them.',
      '',
      '## Why we might be wrong',
      'The strongest case against, written by whoever is least convinced.',
    ].join('\n'),
  },
  {
    file: 'giants-mentor-guide.md',
    name: 'Giants mentor guide',
    fileType: 'md',
    daysAgo: 150,
    body: [
      '# Mentoring in Giants',
      '',
      'Giants is free and takes no equity. Founders book 30-minute 1:1 sessions from the mentor directory.',
      '',
      '## Who you will meet',
      '- **Idea stage** — a rough idea, working out how to validate it. Next steps: customer interviews and an MVP.',
      '- **Build stage** — building the MVP or product. Next steps: go-to-market, pricing and fundraising.',
      '',
      '## Making a session count',
      '- Ask what they want from the thirty minutes before offering anything.',
      '- One concrete next step beats five good ideas.',
      '- If you are the wrong mentor for the question, say so and suggest who is.',
      '',
      'In-person events run every Tuesday, 5pm to 8pm, for the length of the cohort.',
    ].join('\n'),
  },
]

/** A standalone Resource node so the Resource type appears in the directory. */
export const RESOURCE_NODE = {
  id: 'resource:blackbird-startup-jobs',
  name: 'Blackbird Startup Jobs',
  subtitle: 'Open roles across the Blackbird portfolio',
  url: 'https://jobs.blackbird.vc/jobs',
  tags: ['Jobs', 'Portfolio', 'Hiring'],
}
