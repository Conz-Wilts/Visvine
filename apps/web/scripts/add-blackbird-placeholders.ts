/**
 * Fill the LAST-MILE tables of the Blackbird Ventures demo space.
 *
 * `db:blackbird:full` builds the space people actually look at — notes, nodes,
 * links, members, channels, resources — and `seed-placeholder-tool.ts` drives one
 * Tool through its real lifecycle. What both leave behind is the machinery that
 * only fills up once a space has been LIVED IN: agent runs and their event
 * mailbox, OAuth connections, retrieval vectors, the access/promotion queues,
 * the projection outbox, rate-limit buckets, message decorations.
 *
 * Those tables being empty is why a local database can look complete and still
 * exercise none of the code that reads them. This script gives every one of
 * them representative rows, keyed to the data the other layers already seeded.
 *
 * TWO HONEST CAVEATS about what this data is NOT:
 *
 *  1. **The vectors are not embeddings.** Real ones need an OPENAI_API_KEY, so
 *     the 768-float rows here are deterministic hash noise. They are written
 *     under the model name PLACEHOLDER_EMBED_MODEL, which is deliberately NOT
 *     the configured model — both vector stages filter on `model = config.model`
 *     (lib/notes/embeddings.ts), so retrieval IGNORES these rows rather than
 *     ranking against nonsense. Run `pnpm db:embed` with a key for real ones.
 *  2. **The tokens are not credentials.** ConnectorConnection/OAuth rows hold
 *     encrypted placeholder strings. They exercise the storage, decrypt and
 *     "acts as …" paths; they authenticate to nothing.
 *
 * Idempotent — every write is an upsert or is guarded by a prior-existence
 * check, so re-running only tops up what is missing. Local-only, guarded like
 * every other destructive db:* script.
 *
 * Usage:
 *   pnpm db:blackbird:placeholders
 *   pnpm --filter @visvine/web exec tsx scripts/add-blackbird-placeholders.ts [spaceId]
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';
import { encryptSecret } from '../lib/crypto/secrets';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const PEER_SPACE = 'visvine';
const SHARED = 'shared';

const ADMIN = 'user_dev_admin';
const MEMBER = 'user_dev_member';

/** Deliberately not the configured embed model — see the header. */
const PLACEHOLDER_EMBED_MODEL = 'placeholder-seed-768';
const EMBED_DIMENSIONS = 768;

/** Wall-clock anchor. Fixed so re-runs don't walk the data forward. */
const NOW = new Date('2026-08-23T04:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const tally: Record<string, number> = {};
const count = (table: string, n: number) => {
  tally[table] = (tally[table] ?? 0) + n;
};

/**
 * A stable pseudo-embedding: SHA-256 the key, expand the digest into 768
 * floats, L2-normalize. Same key always yields the same unit vector, so a
 * re-run rewrites identical rows and cosine distances stay in [0, 2].
 */
function placeholderVector(key: string): string {
  const values: number[] = [];
  let counter = 0;
  while (values.length < EMBED_DIMENSIONS) {
    const digest = createHash('sha256').update(`${key}#${counter++}`).digest();
    for (const byte of digest) {
      if (values.length >= EMBED_DIMENSIONS) break;
      values.push((byte - 127.5) / 127.5);
    }
  }
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
  return `[${values.map((v) => (v / norm).toFixed(6)).join(',')}]`;
}

/** How lib/rateLimit.ts stores a caller-derived key: hashed and fixed-width. */
const bucketKey = (raw: string) => createHash('sha256').update(raw).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Agents — the scheduler's liveness, a second agent, runs, and the mailbox
// ─────────────────────────────────────────────────────────────────────────────

async function seedAgents() {
  // The tick's single-row heartbeat. Without it the panel reports the watcher
  // itself as down, which is the one agent state that isn't about an agent.
  await prisma.agentHeartbeat.upsert({
    where: { id: 1 },
    create: { id: 1, lastTickAt: ago(1) },
    update: { lastTickAt: ago(1) },
  });
  count('agent_heartbeat', 1);

  // The space's scheduled agent. Its sibling below is deactivated for a reason
  // the UI has copy for — an active-only table never exercises that branch.
  const digest = await prisma.agentState.upsert({
    where: { agent_identity: { spaceId: SPACE, name: 'dealflow-digest' } },
    create: {
      spaceId: SPACE,
      name: 'dealflow-digest',
      runAsUserId: ADMIN,
      active: true,
      status: 'idle',
      nextRunAt: ahead(55),
      lastRunAt: ago(65),
      scheduleHash: createHash('sha256').update('0 9 * * 1-5|Pacific/Auckland').digest('hex').slice(0, 32),
      budgetMonthlyCents: 2500,
      consecutiveFailures: 0,
      triggersJson: { context: ['deals/**/*.md', 'communities/*.md'], webhook: 'dealflow-inbound' },
      debounceMs: 120_000,
    },
    update: {},
  });

  const weekly = await prisma.agentState.upsert({
    where: { agent_identity: { spaceId: SPACE, name: 'lp-report-drafter' } },
    create: {
      spaceId: SPACE,
      name: 'lp-report-drafter',
      runAsUserId: ADMIN,
      active: false,
      status: 'idle',
      lastRunAt: ago(4_320),
      scheduleHash: createHash('sha256').update('0 7 1 * *|Pacific/Auckland').digest('hex').slice(0, 32),
      budgetMonthlyCents: 10_000,
      deactivatedReason: 'brief_changed',
      deactivatedDetail: 'Dev Admin edited the brief on 2026-08-20',
      consecutiveFailures: 1,
      triggersJson: { context: ['data/fund-metrics.md'] },
      debounceMs: 60_000,
    },
    update: {},
  });
  count('agent_state', 2);

  // Runs: one clean scheduled run, one event-triggered run, one webhook run, one
  // failure with a terminal reason, and one still holding the `running` claim.
  const runs: Array<{
    id: string;
    state: { id: string; name: string };
    trigger: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    terminalReason: string | null;
    summary: string | null;
    errorMessage: string | null;
    promptTokens: number;
    completionTokens: number;
    costMicros: bigint | null;
    turns: number;
    startedBy: string | null;
    input: unknown;
    events: unknown;
  }> = [
    {
      id: 'run_bb_digest_001',
      state: digest,
      trigger: 'scheduled',
      status: 'succeeded',
      startedAt: ago(65),
      endedAt: ago(63),
      terminalReason: 'finished',
      summary:
        'Six new deals reached the pipeline this week. Three are ANZ climate-hardware, which continues the cluster flagged on 2026-08-11. Azonic is the only one at term-sheet stage; the rest are first meetings.',
      errorMessage: null,
      promptTokens: 18_442,
      completionTokens: 1_205,
      costMicros: BigInt(74_300),
      turns: 4,
      startedBy: null,
      input: { events: [] },
      events: [
        { kind: 'tool_call', name: 'search_context', at: ago(65).toISOString(), summary: 'query: deals stage:new' },
        { kind: 'tool_result', name: 'search_context', at: ago(64).toISOString(), summary: '6 notes' },
        { kind: 'tool_call', name: 'write_note', at: ago(64).toISOString(), summary: 'data/weekly-digest.md' },
        { kind: 'message', at: ago(63).toISOString(), summary: 'Digest written.' },
      ],
    },
    {
      id: 'run_bb_digest_002',
      state: digest,
      trigger: 'event',
      status: 'succeeded',
      startedAt: ago(190),
      endedAt: ago(188),
      terminalReason: 'finished',
      summary: 'Azonic moved to term sheet; the deal note and the pipeline index now agree.',
      errorMessage: null,
      promptTokens: 9_871,
      completionTokens: 640,
      costMicros: BigInt(39_800),
      turns: 3,
      startedBy: null,
      input: {
        events: [
          {
            kind: 'note_written',
            source: 'deals/azonic.md',
            summary: 'stage: diligence → term-sheet',
            at: ago(192).toISOString(),
          },
        ],
      },
      events: [
        { kind: 'tool_call', name: 'read_note', at: ago(190).toISOString(), summary: 'deals/azonic.md' },
        { kind: 'tool_call', name: 'write_note', at: ago(189).toISOString(), summary: 'deals/index.md' },
        { kind: 'message', at: ago(188).toISOString(), summary: 'Pipeline index updated.' },
      ],
    },
    {
      id: 'run_bb_weekly_001',
      state: weekly,
      trigger: 'scheduled',
      status: 'failed',
      startedAt: ago(4_320),
      endedAt: ago(4_318),
      terminalReason: 'auth',
      summary: null,
      errorMessage: 'Model key rejected by provider (401). Set MODEL_KEY_ANTHROPIC for this space.',
      promptTokens: 0,
      completionTokens: 0,
      costMicros: null,
      turns: 0,
      startedBy: null,
      input: { events: [] },
      events: [{ kind: 'error', at: ago(4_318).toISOString(), summary: 'auth: provider rejected the key' }],
    },
    {
      id: 'run_bb_digest_003',
      state: digest,
      trigger: 'manual',
      status: 'running',
      startedAt: ago(2),
      endedAt: null,
      terminalReason: null,
      summary: null,
      errorMessage: null,
      promptTokens: 3_100,
      completionTokens: 0,
      costMicros: null,
      turns: 1,
      startedBy: ADMIN,
      input: { events: [] },
      events: [{ kind: 'tool_call', name: 'search_context', at: ago(2).toISOString(), summary: 'query: portfolio' }],
    },
  ];

  // The fifth RunTrigger value. Worth its own row: a webhook run is the only
  // one whose input arrives from outside the space entirely.
  runs.push({
    id: 'run_bb_digest_004',
    state: digest,
    trigger: 'webhook',
    status: 'succeeded',
    startedAt: ago(700),
    endedAt: ago(698),
    terminalReason: 'finished',
    summary: 'Two inbound Affinity opportunities reconciled against the pipeline index.',
    errorMessage: null,
    promptTokens: 12_004,
    completionTokens: 812,
    costMicros: BigInt(51_200),
    turns: 3,
    startedBy: null,
    input: {
      events: [
        { kind: 'webhook', source: 'dealflow-inbound', summary: 'Affinity sync', at: ago(701).toISOString() },
      ],
    },
    events: [{ kind: 'message', at: ago(698).toISOString(), summary: 'Pipeline reconciled.' }],
  });

  for (const run of runs) {
    await prisma.agentRun.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        stateId: run.state.id,
        spaceId: SPACE,
        name: run.state.name,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        startedBy: run.startedBy,
        model: 'claude-sonnet-5',
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        costMicros: run.costMicros,
        turns: run.turns,
        terminalReason: run.terminalReason,
        summary: run.summary,
        errorMessage: run.errorMessage,
        events: run.events as never,
        eventCount: Array.isArray(run.events) ? run.events.length : 0,
        input: run.input as never,
      },
      update: {},
    });
  }
  count('agent_runs', runs.length);

  // The `running` row must agree with the claim its AgentState holds, or
  // overlap suppression is reading a state no tick could have produced.
  await prisma.agentState.update({
    where: { id: digest.id },
    data: { status: 'running', runningSince: ago(2), currentRunId: 'run_bb_digest_003' },
  });

  // The mailbox: two rows already consumed by the runs above, two still pending
  // (one of them carrying a dedupe key, which is the partial-unique case).
  const events = [
    {
      id: 'agev_bb_001',
      agentName: 'dealflow-digest',
      kind: 'note_written',
      source: 'deals/azonic.md',
      summary: 'stage: diligence → term-sheet',
      payload: { path: 'deals/azonic.md', actor: 'Dev Admin', changed: true },
      dedupeKey: null,
      createdAt: ago(192),
      consumedBy: 'run_bb_digest_002',
    },
    {
      id: 'agev_bb_002',
      agentName: 'dealflow-digest',
      kind: 'webhook',
      source: 'dealflow-inbound',
      summary: 'Affinity: 2 new opportunities',
      payload: { provider: 'affinity', opportunities: 2 },
      dedupeKey: null,
      createdAt: ago(200),
      consumedBy: 'run_bb_digest_002',
    },
    {
      id: 'agev_bb_003',
      agentName: 'dealflow-digest',
      kind: 'note_written',
      source: 'communities/halter/index.md',
      summary: 'Series D close added to the company note',
      payload: { path: 'communities/halter/index.md', actor: 'Dev Admin', changed: true },
      dedupeKey: 'note_written:communities/halter/index.md',
      createdAt: ago(9),
      consumedBy: null,
    },
    {
      id: 'agev_bb_004',
      agentName: 'dealflow-digest',
      kind: 'reply',
      source: 'Dev Admin',
      summary: 'Yes — include the ANZ climate cluster in next week’s digest.',
      payload: { userId: ADMIN, text: 'Yes — include the ANZ climate cluster in next week’s digest.' },
      dedupeKey: null,
      createdAt: ago(6),
      consumedBy: null,
    },
  ];

  for (const event of events) {
    await prisma.agentEvent.upsert({
      where: { id: event.id },
      create: { ...event, spaceId: SPACE, payload: event.payload as never },
      update: {},
    });
  }
  count('agent_events', events.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Connectors — a registered OAuth client, live connections, run state
// ─────────────────────────────────────────────────────────────────────────────

async function seedConnectors() {
  const clients = [
    {
      provider: 'notion',
      issuer: 'https://api.notion.com',
      clientId: 'bb-notion-dev-client',
      clientSecret: encryptSecret('placeholder-notion-client-secret'),
    },
    {
      provider: 'linear',
      issuer: 'https://linear.app',
      clientId: 'bb-linear-dev-client',
      // A public client (PKCE, no secret) — the other half of the branch.
      clientSecret: null,
    },
  ];

  for (const client of clients) {
    await prisma.connectorOAuthClient.upsert({
      where: { oauth_client_identity: { spaceId: SPACE, provider: client.provider, issuer: client.issuer } },
      create: { ...client, spaceId: SPACE, createdAt: ago(20_000) },
      update: {},
    });
  }
  count('connector_oauth_clients', clients.length);

  const connections = [
    {
      provider: 'notion',
      // '' is the space-mode sentinel — NULL would let two space connections coexist.
      userId: '',
      mode: 'space',
      accountLabel: 'Blackbird Ventures (workspace)',
      scopes: ['read_content', 'update_content'],
      expiresAt: ahead(50),
      brokenAt: null as Date | null,
      brokenReason: null as string | null,
      connectedBy: ADMIN,
    },
    {
      // Kept rather than deleted, so the UI can say WHICH connection broke and why.
      provider: 'atlassian',
      userId: ADMIN,
      mode: 'user',
      accountLabel: 'admin@local.dev',
      scopes: ['read:jira-work'],
      expiresAt: ago(2_880),
      brokenAt: ago(2_875),
      brokenReason: 'refresh_token_expired: the provider rejected the refresh grant (invalid_grant)',
      connectedBy: ADMIN,
    },
  ];

  for (const connection of connections) {
    await prisma.connectorConnection.upsert({
      where: {
        connection_identity: { spaceId: SPACE, provider: connection.provider, userId: connection.userId },
      },
      create: {
        ...connection,
        spaceId: SPACE,
        accessToken: encryptSecret(`placeholder-access-token-${connection.provider}`),
        refreshToken: encryptSecret(`placeholder-refresh-token-${connection.provider}`),
        createdAt: ago(20_000),
      },
      update: {},
    });
  }
  count('connector_connections', connections.length);

  // A connector's memory between runs, keyed by the NOTE path the demo layer wrote.
  const state = [
    { path: 'connectors/sandbox.md', key: 'lastCursor', value: { cursor: 'evt_00291', at: ago(30).toISOString() } },
    { path: 'connectors/sandbox.md', key: 'seenIds', value: { ids: ['evt_00288', 'evt_00289', 'evt_00291'] } },
    { path: 'connectors/appdb.md', key: 'lastRowCount', value: { nodes: 634, at: ago(120).toISOString() } },
  ];

  for (const row of state) {
    await prisma.connectorState.upsert({
      where: { connector_state_identity: { spaceId: SPACE, path: row.path, key: row.key } },
      create: { ...row, spaceId: SPACE, value: row.value as never },
      update: {},
    });
  }
  count('connector_state', state.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Context governance — folders, the two queues, publications
// ─────────────────────────────────────────────────────────────────────────────

async function seedGovernance() {
  // `restricted` cuts grant inheritance at the boundary; `locked` freezes a
  // folder for AI maintenance. Both flags need a row to hang off, so flagging a
  // folder that only existed implicitly upserts it first.
  const folders = [
    { ownerKey: SHARED, path: 'deals', restricted: true, locked: false },
    { ownerKey: SHARED, path: 'data', restricted: false, locked: true },
    { ownerKey: SHARED, path: 'team', restricted: true, locked: false },
    { ownerKey: SHARED, path: 'communities', restricted: false, locked: false },
    { ownerKey: SHARED, path: 'sectors', restricted: false, locked: false },
    { ownerKey: ADMIN, path: 'diligence', restricted: false, locked: false },
    { ownerKey: ADMIN, path: 'journal', restricted: false, locked: true },
  ];

  for (const folder of folders) {
    await prisma.contextFolder.upsert({
      where: { folder_identity: { spaceId: SPACE, ownerKey: folder.ownerKey, path: folder.path } },
      create: { ...folder, spaceId: SPACE, createdAt: ago(30_000) },
      update: { restricted: folder.restricted, locked: folder.locked },
    });
  }
  count('context_folders', folders.length);

  // Access requests: the pending queue plus both resolutions, since the
  // resolved rows are the audit trail behind Console → People → Waiting.
  const requests = [
    {
      id: 'car_bb_001',
      userId: MEMBER,
      resourcePath: 'deals',
      level: 10,
      message: 'Working on the Azonic diligence pack — I need to read the deal notes.',
      status: 'pending',
      createdAt: ago(180),
      resolvedBy: null as string | null,
      resolvedAt: null as Date | null,
      grantedLevel: null as number | null,
    },
    {
      // '' = the context root gate. The path is recorded even when it doesn't
      // exist, so the denial copy never admits whether it does.
      id: 'car_bb_004',
      userId: MEMBER,
      resourcePath: '',
      level: 10,
      message: null,
      status: 'pending',
      createdAt: ago(45),
      resolvedBy: null,
      resolvedAt: null,
      grantedLevel: null,
    },
  ];

  for (const request of requests) {
    await prisma.contextAccessRequest.upsert({
      where: { id: request.id },
      create: { ...request, spaceId: SPACE },
      update: {},
    });
  }
  count('context_access_requests', requests.length);

  // Promotion proposals: a note in someone's PERSONAL context they want to
  // land in a shared folder they cannot write to.
  const proposals = [
    {
      id: 'cmp_bb_001',
      fromPath: 'diligence/azonic.md',
      toPath: 'deals/azonic-diligence.md',
      folderId: 'deals',
      kind: 'copy',
      status: 'pending',
      proposedBy: ADMIN,
      proposerName: 'Dev Admin',
      proposedAt: ago(150),
      resolvedBy: null as string | null,
      resolvedAt: null as Date | null,
      content:
        '---\ntitle: Azonic — diligence\ntype: Deal\n---\n\nSecond meeting notes, reference calls pending. Hardware margin is the open question.\n',
    },
    {
      id: 'cmp_bb_002',
      fromPath: 'journal/2026-06-26.md',
      toPath: 'team/partner-notes-june.md',
      folderId: 'team',
      // A 'publish' proposal's content is only the PREVIEW: approval reads the
      // proposer's current note and creates a live publication instead.
      kind: 'publish',
      status: 'approved',
      proposedBy: ADMIN,
      proposerName: 'Dev Admin',
      proposedAt: ago(9_000),
      resolvedBy: ADMIN,
      resolvedAt: ago(8_940),
      content: '---\ntitle: Partner notes — June\n---\n\nPreview snapshot taken at proposal time.\n',
    },
    {
      id: 'cmp_bb_003',
      fromPath: 'journal/2026-06-19.md',
      toPath: 'data/june-scratch.md',
      folderId: 'data',
      kind: 'copy',
      status: 'denied',
      proposedBy: ADMIN,
      proposerName: 'Dev Admin',
      proposedAt: ago(10_000),
      resolvedBy: ADMIN,
      resolvedAt: ago(9_800),
      content: '---\ntitle: June scratch\n---\n\nSuperseded by the Q3 roll-up.\n',
    },
  ];

  for (const proposal of proposals) {
    await prisma.contextMoveProposal.upsert({
      where: { id: proposal.id },
      create: { ...proposal, spaceId: SPACE },
      update: {},
    });
  }
  count('context_move_proposals', proposals.length);

  // A publication is a live link plus a REAL replica note in the target space.
  // Seeding the link without the replica would describe a sync that never ran.
  const publications = [
    { sourcePath: 'communities/halter/index.md', targetPath: 'partners/blackbird/halter.md', active: true },
    { sourcePath: 'communities/canva/index.md', targetPath: 'partners/blackbird/canva.md', active: true },
    // Unlinked: the replica stays behind as a plain editable copy.
    { sourcePath: 'sectors/climate-energy.md', targetPath: 'partners/blackbird/climate-energy.md', active: false },
  ];

  for (const publication of publications) {
    const source = await prisma.contextNote.findUnique({
      where: { note_identity: { spaceId: SPACE, ownerKey: SHARED, path: publication.sourcePath } },
    });
    if (!source) {
      // Loud, because a silent skip here looks identical to a publication that
      // seeded fine — which is exactly how a wrong path went unnoticed once.
      console.warn(`  ! publication skipped: no note at ${SPACE} [shared] ${publication.sourcePath}`);
      continue;
    }

    await prisma.contextNote.upsert({
      where: { note_identity: { spaceId: PEER_SPACE, ownerKey: SHARED, path: publication.targetPath } },
      create: {
        spaceId: PEER_SPACE,
        ownerKey: SHARED,
        path: publication.targetPath,
        content: source.content,
        createdBy: ADMIN,
        createdAt: ago(3_000),
      },
      update: {},
    });

    await prisma.contextPublication.upsert({
      where: {
        publication_identity: {
          sourceSpaceId: SPACE,
          sourcePath: publication.sourcePath,
          targetSpaceId: PEER_SPACE,
        },
      },
      create: {
        sourceSpaceId: SPACE,
        sourcePath: publication.sourcePath,
        targetSpaceId: PEER_SPACE,
        targetPath: publication.targetPath,
        active: publication.active,
        lastSyncedAt: publication.active ? ago(120) : ago(7_000),
        createdBy: ADMIN,
        createdAt: ago(3_000),
      },
      update: {},
    });
    count('context_publications', 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Retrieval — sources, their chunks, and note embeddings
// ─────────────────────────────────────────────────────────────────────────────

/** `path` must NOT end in .md: the note namespace and the source one stay disjoint. */
const SOURCES = [
  {
    path: 'data/fund-roll-up-q3.csv',
    name: 'Fund roll-up (Q3).csv',
    kind: 'csv',
    mimeType: 'text/csv',
    status: 'ready',
    resourceName: 'Fund roll-up (Q3)',
    chunks: [
      'fund,vintage,committed_musd,called_musd,dpi,tvpi,irr_pct\nBlackbird Ventures I,2013,30,30,3.41,11.80,42.1',
      'Blackbird Ventures II,2015,200,196,1.12,4.60,31.4\nBlackbird Ventures III,2018,284,270,0.35,2.90,24.8',
      'Blackbird Ventures IV,2020,640,489,0.06,1.85,17.2\nBlackbird Ventures V,2022,1000,410,0.00,1.24,9.6',
    ],
  },
  {
    path: 'deals/ic-memo-template.md.txt',
    name: 'IC memo template.txt',
    kind: 'text',
    mimeType: 'text/plain',
    status: 'ready',
    resourceName: 'IC memo template',
    chunks: [
      'INVESTMENT COMMITTEE MEMO\n\n1. The company in one line\n2. Why now\n3. Market and the wedge\n4. Team',
      '5. Traction and the numbers that matter\n6. Round, terms, ownership\n7. What would have to be true\n8. Risks and the kill criteria',
    ],
  },
  {
    // A failure, so the "why can't the AI see my file" path has a row.
    path: 'data/lp-side-letters.docx',
    name: 'LP side letters.docx',
    kind: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    status: 'failed',
    resourceName: null,
    chunks: [] as string[],
  },
  {
    path: 'data/ingest-queue.json',
    name: 'ingest-queue.json',
    kind: 'json',
    mimeType: 'application/json',
    status: 'pending',
    resourceName: null,
    chunks: [] as string[],
  },
];

async function seedRetrieval() {
  for (const source of SOURCES) {
    const text = source.chunks.join('\n');
    const row = await prisma.contextSource.upsert({
      where: { source_identity: { spaceId: SPACE, ownerKey: SHARED, path: source.path } },
      create: {
        spaceId: SPACE,
        ownerKey: SHARED,
        path: source.path,
        name: source.name,
        kind: source.kind,
        mimeType: source.mimeType,
        sizeBytes: Math.max(text.length, 2_048),
        gcsPath: `spaces/${SPACE}/sources/${source.path}`,
        status: source.status,
        error:
          source.status === 'failed'
            ? 'Extraction failed: the document is password-protected (no text could be read).'
            : null,
        truncated: false,
        textChars: source.status === 'ready' ? text.length : null,
        chunkCount: source.chunks.length,
        createdBy: ADMIN,
        createdAt: ago(4_000),
      },
      update: {},
    });
    count('context_sources', 1);

    for (const [seq, chunkText] of source.chunks.entries()) {
      const existing = await prisma.contextSourceChunk.findUnique({
        where: { sourceId_seq: { sourceId: row.id, seq } },
      });
      if (existing) continue;

      // The vector column is Unsupported() — Prisma can't type it, so the row
      // goes in through raw SQL exactly as lib/notes does it.
      await prisma.$executeRaw`
        INSERT INTO context_source_chunks (id, source_id, space_id, owner_key, path, seq, text, model, embedding)
        VALUES (
          (gen_random_uuid())::text, ${row.id}, ${SPACE}, ${SHARED}, ${source.path},
          ${seq}, ${chunkText}, ${PLACEHOLDER_EMBED_MODEL},
          ${placeholderVector(`${source.path}#${seq}`)}::vector
        )`;
      count('context_source_chunks', 1);
    }

    // Close the loop the Drive draws: the Resource row points at the
    // ContextSource holding its chunks, and its index_state stops lying.
    if (source.resourceName) {
      await prisma.resource.updateMany({
        where: { spaceId: SPACE, name: source.resourceName },
        data: {
          sourcePath: source.path,
          indexState: 'indexed',
          gcsPath: `spaces/${SPACE}/resources/${source.name}`,
        },
      });
    }
  }

  // Note embeddings for a readable slice of the shared context. Placeholder
  // vectors under a non-configured model name — see the header.
  const notes = await prisma.contextNote.findMany({
    where: { spaceId: SPACE, deletedAt: null },
    select: { ownerKey: true, path: true, updatedAt: true },
    orderBy: { path: 'asc' },
    take: 120,
  });

  for (const note of notes) {
    const existing = await prisma.contextNoteEmbedding.findUnique({
      where: { embedding_identity: { spaceId: SPACE, ownerKey: note.ownerKey, path: note.path } },
    });
    if (existing) continue;

    await prisma.$executeRaw`
      INSERT INTO context_note_embeddings (id, space_id, owner_key, path, model, mtime, embedding, updated_at)
      VALUES (
        (gen_random_uuid())::text, ${SPACE}, ${note.ownerKey}, ${note.path},
        ${PLACEHOLDER_EMBED_MODEL}, ${BigInt(note.updatedAt.getTime())},
        ${placeholderVector(`${note.ownerKey}:${note.path}`)}::vector, ${NOW}
      )`;
    count('context_note_embeddings', 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The Drive — folders, and the change-proposal queue over a table
// ─────────────────────────────────────────────────────────────────────────────

async function seedDrive() {
  const roots = [
    { id: 'rfold_bb_fund', name: 'Fund admin', parentId: null as string | null },
    { id: 'rfold_bb_deals', name: 'Deal room', parentId: null },
    { id: 'rfold_bb_lp', name: 'LP reporting', parentId: null },
  ];
  const children = [
    { id: 'rfold_bb_fund_q3', name: 'Q3 2026', parentId: 'rfold_bb_fund' },
    { id: 'rfold_bb_deals_azonic', name: 'Azonic', parentId: 'rfold_bb_deals' },
  ];

  for (const folder of [...roots, ...children]) {
    await prisma.resourceFolder.upsert({
      where: { id: folder.id },
      create: { ...folder, spaceId: SPACE, createdBy: ADMIN, createdAt: ago(20_000) },
      update: {},
    });
  }
  count('resource_folders', roots.length + children.length);

  // File the seeded files, so the root isn't the only folder state represented.
  const filing: Array<[string, string]> = [
    ['Fund roll-up (Q3)', 'rfold_bb_fund_q3'],
    ['Portfolio review template', 'rfold_bb_lp'],
    ['IC memo template', 'rfold_bb_deals'],
  ];
  for (const [name, folderId] of filing) {
    await prisma.resource.updateMany({ where: { spaceId: SPACE, name }, data: { folderId } });
  }

  const rollUp = await prisma.resource.findFirst({ where: { spaceId: SPACE, name: 'Fund roll-up (Q3)' } });
  if (!rollUp) return;

  const changes = [
    {
      id: 'rch_bb_002',
      cellRef: 'G3',
      originalValue: '30.9',
      proposedValue: '31.4',
      reason: 'IRR restated after the Q2 audit adjustment.',
      proposedBy: ADMIN,
      status: 'approved',
      reviewedBy: ADMIN,
      reviewedAt: ago(4_000),
      createdAt: ago(4_200),
    },
    {
      id: 'rch_bb_003',
      cellRef: 'C6',
      originalValue: '410',
      proposedValue: '480',
      reason: 'Thought a capital call had settled — it had not.',
      proposedBy: MEMBER,
      status: 'rejected',
      reviewedBy: ADMIN,
      reviewedAt: ago(5_000),
      createdAt: ago(5_100),
    },
  ];

  for (const change of changes) {
    await prisma.resourceChange.upsert({
      where: { id: change.id },
      create: { ...change, resourceId: rollUp.id },
      update: {},
    });
  }
  count('resource_changes', changes.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Messaging decorations — images, mentions, stars, link previews
// ─────────────────────────────────────────────────────────────────────────────

async function seedMessaging() {
  const message = async (id: string) => prisma.message.findUnique({ where: { id } });

  const portfolioNews = await message('msg_bb_020');
  const general = await message('msg_bb_001');
  const dealflow = await message('msg_bb_013');

  if (portfolioNews) {
    for (const [position, imageUrl] of [
      'https://images.placeholders.dev/?width=1200&height=630&text=Halter+Series+D',
      'https://images.placeholders.dev/?width=1200&height=630&text=ARR+curve',
    ].entries()) {
      await prisma.messageImage.upsert({
        where: { id: `mimg_bb_${position + 1}` },
        create: { id: `mimg_bb_${position + 1}`, messageId: portfolioNews.id, imageUrl, position },
        update: {},
      });
      count('message_images', 1);
    }
  }

  // Mentions come in two shapes: a USER and a graph NODE.
  const halter = await prisma.node.findFirst({ where: { spaceId: SPACE, name: 'Halter' } });
  const mentions = [
    { id: 'ment_bb_002', message: general, mentionedUserId: MEMBER, mentionedNodeId: null, mentionType: 'user' },
    {
      id: 'ment_bb_003',
      message: portfolioNews,
      mentionedUserId: null,
      mentionedNodeId: halter?.id ?? null,
      mentionType: 'node',
    },
  ];

  for (const mention of mentions) {
    if (!mention.message) continue;
    if (mention.mentionType === 'node' && !mention.mentionedNodeId) continue;
    await prisma.messageMention.upsert({
      where: { id: mention.id },
      create: {
        id: mention.id,
        messageId: mention.message.id,
        mentionedUserId: mention.mentionedUserId,
        mentionedNodeId: mention.mentionedNodeId,
        mentionType: mention.mentionType,
      },
      update: {},
    });
    count('message_mentions', 1);
  }

  const stars: Array<[typeof portfolioNews, string]> = [
    [portfolioNews, ADMIN],
    [dealflow, ADMIN],
  ];
  for (const [target, userId] of stars) {
    if (!target) continue;
    await prisma.messageStar.upsert({
      where: { messageId_userId: { messageId: target.id, userId } },
      create: { messageId: target.id, userId, createdAt: ago(500) },
      update: {},
    });
    count('message_stars', 1);
  }

  const previews = [
    {
      url: 'https://www.halterhq.com/news/series-d',
      title: 'Halter raises Series D',
      description: 'Virtual fencing for pasture-based farming closes a new round led by existing investors.',
      imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Halter',
      siteName: 'Halter',
      message: portfolioNews,
    },
    {
      url: 'https://www.blackbird.vc/portfolio',
      title: 'Blackbird — Portfolio',
      description: 'The companies Blackbird has backed across Australia and New Zealand.',
      imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Blackbird',
      siteName: 'Blackbird',
      message: dealflow,
    },
  ];

  for (const [index, preview] of previews.entries()) {
    const row = await prisma.linkPreview.upsert({
      where: { url: preview.url },
      create: {
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        siteName: preview.siteName,
        fetchedAt: ago(600),
      },
      update: {},
    });
    count('link_previews', 1);

    if (!preview.message) continue;
    await prisma.messageLinkPreview.upsert({
      where: { id: `mlp_bb_${index + 1}` },
      create: { id: `mlp_bb_${index + 1}`, messageId: preview.message.id, linkPreviewId: row.id },
      update: {},
    });
    count('message_link_previews', 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Machinery — the projection outbox, Tool state, MCP OAuth, rate limits
// ─────────────────────────────────────────────────────────────────────────────

async function seedMachinery() {
  // The outbox is SELF-PRUNING — settled rows are deleted — so a realistic
  // table holds only what is still owed plus one parked, poisoned row.
  const jobs = [
    {
      id: 'npj_bb_001',
      ownerKey: SHARED,
      path: 'communities/halter/index.md',
      kind: 'write',
      fromPath: null as string | null,
      origin: 'edit',
      actorId: ADMIN,
      actorName: 'Dev Admin',
      actorEmail: 'admin@local.dev',
      model: null as string | null,
      changed: true,
      attempts: 0,
      lastError: null as string | null,
      createdAt: ago(4),
      runAfter: ago(4),
      doneAt: null as Date | null,
    },
    {
      id: 'npj_bb_002',
      ownerKey: SHARED,
      path: 'deals/azonic.md',
      kind: 'rename',
      fromPath: 'deals/azonic-draft.md',
      origin: 'edit',
      actorId: ADMIN,
      actorName: 'Dev Admin',
      actorEmail: 'admin@local.dev',
      model: null,
      changed: true,
      attempts: 1,
      lastError: null,
      createdAt: ago(9),
      runAfter: ago(3),
      doneAt: null,
    },
    {
      id: 'npj_bb_003',
      ownerKey: ADMIN,
      path: 'journal/2026-06-19.md',
      kind: 'delete',
      fromPath: null,
      origin: 'maintenance',
      actorId: 'system',
      actorName: 'Index maintenance',
      actorEmail: null,
      model: null,
      changed: true,
      attempts: 0,
      lastError: null,
      createdAt: ago(2),
      runAfter: ago(2),
      doneAt: null,
    },
    {
      // Parked rather than retried forever: attempts exhausted, doneAt stamped.
      id: 'npj_bb_004',
      ownerKey: SHARED,
      path: 'data/fund-metrics.md',
      kind: 'write',
      fromPath: null,
      origin: 'agent',
      actorId: 'agent:dealflow-digest',
      actorName: 'dealflow-digest',
      actorEmail: null,
      model: 'claude-sonnet-5',
      changed: true,
      attempts: 8,
      lastError: 'publication sync failed: target space replica is locked',
      createdAt: ago(3_000),
      runAfter: ago(2_400),
      doneAt: ago(2_390),
    },
  ];

  for (const job of jobs) {
    await prisma.noteProjectionJob.upsert({
      where: { id: job.id },
      create: { ...job, spaceId: SPACE },
      update: {},
    });
  }
  count('note_projection_jobs', jobs.length);

  // A Tool's iframe runs sandboxed without allow-same-origin, so it has no
  // localStorage — this table IS its persistence.
  const install = await prisma.appToolInstall.findFirst({ where: { spaceId: SPACE } });
  if (install) {
    const state = [
      { key: 'board:filter', value: { wave: 5, assignee: null, showDone: false } },
      { key: 'board:columnOrder', value: { order: ['todo', 'doing', 'review', 'done'] } },
      { key: 'ui:lastOpenedAt', value: { at: ago(30).toISOString() } },
    ];
    for (const row of state) {
      await prisma.appToolState.upsert({
        where: { app_tool_state_identity: { installId: install.id, key: row.key } },
        create: { installId: install.id, key: row.key, value: row.value as never },
        update: {},
      });
    }
    count('app_tool_state', state.length);
  }

  // The self-hosted MCP OAuth 2.1 server: dynamically-registered public
  // clients, a live authorization code and an expired one. No refresh tokens —
  // that grant type does not exist (lib/mcp/oauth.ts).
  const clients = [
    {
      clientId: 'mcp_claude_desktop_local',
      clientName: 'Claude Desktop',
      redirectUris: ['http://localhost:33418/callback', 'claude://oauth/callback'],
      scope: 'context:read context:write',
    },
    {
      clientId: 'mcp_claude_code_local',
      clientName: 'Claude Code',
      redirectUris: ['http://127.0.0.1:41293/callback'],
      scope: 'context:read creator:write',
    },
  ];
  for (const client of clients) {
    await prisma.oAuthClient.upsert({
      where: { clientId: client.clientId },
      create: { ...client, createdAt: ago(30_000) },
      update: {},
    });
  }
  count('oauth_clients', clients.length);

  const codes = [
    {
      id: 'oac_bb_001',
      code: 'ac_live_placeholder_0001',
      clientId: 'mcp_claude_desktop_local',
      userId: ADMIN,
      redirectUri: 'http://localhost:33418/callback',
      scope: 'context:read context:write',
      resource: 'context',
      expiresAt: ahead(9),
      consumedAt: null as Date | null,
      createdAt: ago(1),
    },
    {
      id: 'oac_bb_003',
      code: 'ac_expired_placeholder_0003',
      clientId: 'mcp_claude_desktop_local',
      userId: MEMBER,
      redirectUri: 'http://localhost:33418/callback',
      scope: 'context:read',
      resource: 'context',
      expiresAt: ago(2_870),
      consumedAt: null,
      createdAt: ago(2_880),
    },
  ];
  for (const code of codes) {
    await prisma.oAuthAuthCode.upsert({
      where: { code: code.code },
      create: { ...code, codeChallenge: createHash('sha256').update(`verifier-${code.id}`).digest('base64url') },
      update: {},
    });
  }
  count('oauth_auth_codes', codes.length);

  // The row IS the bucket. A partly-spent bucket, a nearly-exhausted one, and a
  // full+idle one that the nightly sweep is meant to reclaim.
  const buckets = [
    { raw: 'login:admin@local.dev', tokens: 4.5, updatedAt: ago(3) },
    { raw: 'login:198.51.100.24', tokens: 0.25, updatedAt: ago(1) },
    { raw: `connector-runs:${SPACE}`, tokens: 112.0, updatedAt: ago(8) },
    { raw: `agent-tick:${SPACE}`, tokens: 30.0, updatedAt: ago(4_000) },
    { raw: 'webhook:dealflow-inbound', tokens: 19.75, updatedAt: ago(200) },
  ];
  for (const bucket of buckets) {
    await prisma.rateLimitBucket.upsert({
      where: { key: bucketKey(bucket.raw) },
      create: { key: bucketKey(bucket.raw), tokens: bucket.tokens, updatedAt: bucket.updatedAt },
      update: {},
    });
  }
  count('rate_limit_buckets', buckets.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Inbox + the audit ledger — top up what the other layers only started
// ─────────────────────────────────────────────────────────────────────────────

async function seedInboxAndAudit() {
  const notifications = [
    {
      id: 'ntf_bb_001',
      userId: ADMIN,
      kind: 'access_request',
      title: 'Dev Member asked for access',
      body: 'comment on deals',
      href: '/console/people',
      dedupeKey: 'access_request:car_bb_001',
      createdAt: ago(180),
      readAt: null as Date | null,
    },
    {
      id: 'ntf_bb_002',
      userId: ADMIN,
      kind: 'connection_broken',
      title: 'Atlassian connection needs reconnecting',
      body: 'The provider rejected the refresh grant.',
      href: '/console/connectors',
      dedupeKey: 'connection_broken:atlassian',
      createdAt: ago(2_875),
      readAt: null,
    },
    {
      id: 'ntf_bb_003',
      userId: ADMIN,
      kind: 'agent_deactivated',
      title: 'lp-report-drafter was deactivated',
      body: 'Its brief changed, so it will not run until an admin re-activates it.',
      href: '/console/agents',
      dedupeKey: 'agent_deactivated:lp-report-drafter',
      createdAt: ago(4_320),
      readAt: ago(4_000),
    },
    {
      id: 'ntf_bb_004',
      userId: MEMBER,
      kind: 'mention',
      title: 'Dev Admin mentioned you in #general',
      body: 'Q3 close is the 30th.',
      href: '/channels/chan_bb_general',
      dedupeKey: null,
      createdAt: ago(1_200),
      readAt: ago(1_100),
    },
    {
      id: 'ntf_bb_006',
      userId: MEMBER,
      kind: 'tool_review',
      title: 'Portfolio Board was approved',
      body: 'Your Tool is live in the marketplace.',
      href: '/tools/portfolio-board',
      dedupeKey: null,
      createdAt: ago(700),
      readAt: null,
    },
  ];

  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      create: { ...notification, spaceId: SPACE },
      update: {},
    });
  }
  count('notifications', notifications.length);

  // Governance mutations and gated reads — the events the ledger exists for.
  const entries = [
    { id: 'cae_bb_001', userId: ADMIN, name: 'Dev Admin', action: 'grant.create', path: 'deals', detail: 'alias Partner → edit', at: ago(20_000) },
    { id: 'cae_bb_002', userId: ADMIN, name: 'Dev Admin', action: 'folder.restrict', path: 'deals', detail: 'restricted: true', at: ago(19_900) },
    { id: 'cae_bb_003', userId: MEMBER, name: 'Dev Member', action: 'note.read', path: 'data/fund-metrics.md', detail: 'restricted boundary: data', at: ago(5_800) },
    { id: 'cae_bb_006', userId: ADMIN, name: 'Dev Admin', action: 'connector.run', path: 'connectors/sandbox.md', detail: '200 in 412ms', at: ago(30) },
    { id: 'cae_bb_007', userId: ADMIN, name: 'Dev Admin', action: 'secret.update', path: 'SANDBOX_KEY', detail: 'rotated', at: ago(9_000) },
    { id: 'cae_bb_008', userId: ADMIN, name: 'Dev Admin', action: 'agent.deactivate', path: 'agents/lp-report-drafter/index.md', detail: 'brief_changed', at: ago(4_320) },
    { id: 'cae_bb_009', userId: ADMIN, name: 'Dev Admin', action: 'proposal.approve', path: 'team/partner-notes-june.md', detail: 'publish from Dev Admin', at: ago(8_940) },
    { id: 'cae_bb_010', userId: ADMIN, name: 'Dev Admin', action: 'publication.unlink', path: 'sectors/climate-energy.md', detail: 'target visvine', at: ago(7_000) },
  ];

  for (const entry of entries) {
    await prisma.contextAuditEntry.upsert({
      where: { id: entry.id },
      create: { ...entry, spaceId: SPACE },
      update: {},
    });
  }
  count('context_audit_entries', entries.length);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const space = await prisma.space.findUnique({ where: { id: SPACE } });
  if (!space) throw new Error(`Space ${SPACE} not found — run \`pnpm db:blackbird:full\` first.`);

  await seedAgents();
  await seedConnectors();
  await seedGovernance();
  await seedRetrieval();
  await seedDrive();
  await seedMessaging();
  await seedMachinery();
  await seedInboxAndAudit();

  console.log(`\nplaceholder layer seeded into ${SPACE}:`);
  for (const table of Object.keys(tally).sort()) {
    console.log(`  ${table.padEnd(26)} ${tally[table]}`);
  }
  console.log(
    `\nnote: the ${EMBED_DIMENSIONS}-dim vectors are deterministic placeholders written under` +
      `\n      model "${PLACEHOLDER_EMBED_MODEL}", which retrieval filters OUT. Run` +
      `\n      \`pnpm db:embed\` with an OPENAI_API_KEY for real ones.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
