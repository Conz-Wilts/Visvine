/**
 * Fill the LAST-MILE tables of the demo space (Visvine HQ by default; pass a
 * space id to fill another one).
 *
 * `db:hq:full` builds the space people actually look at — notes, nodes,
 * links, members, channels, resources. What it leaves behind is the machinery that
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
 *  1. **The vectors are not embeddings.** Real ones need an OPENROUTER_API_KEY, so
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
 *   pnpm db:hq:placeholders
 *   pnpm --filter @visvine/web exec tsx scripts/add-placeholders.ts [spaceId]
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';
import { encryptSecret } from '../lib/crypto/secrets';
import { SPACE_ID } from './seed/space';

const SPACE = process.argv[2] ?? SPACE_ID;
/** The platform's global space — a real space, and the publication target below. */
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
      triggersJson: { context: ['deals/**/*.md', 'communities/**/*.md'], webhook: 'dealflow-inbound' },
      debounceMs: 120_000,
    },
    update: {},
  });

  const weekly = await prisma.agentState.upsert({
    where: { agent_identity: { spaceId: SPACE, name: 'investor-update-drafter' } },
    create: {
      spaceId: SPACE,
      name: 'investor-update-drafter',
      runAsUserId: ADMIN,
      active: false,
      status: 'idle',
      lastRunAt: ago(4_320),
      scheduleHash: createHash('sha256').update('0 7 1 * *|Pacific/Auckland').digest('hex').slice(0, 32),
      budgetMonthlyCents: 10_000,
      deactivatedReason: 'brief_changed',
      deactivatedDetail: 'Dev Admin edited the brief on 2026-08-20',
      consecutiveFailures: 1,
      triggersJson: { context: ['data/revenue-roll-up.md'] },
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
      id: 'run_hq_digest_001',
      state: digest,
      trigger: 'scheduled',
      status: 'succeeded',
      startedAt: ago(65),
      endedAt: ago(63),
      terminalReason: 'finished',
      summary:
        'Six spaces asked about pricing this week. Four are accelerators, which continues the cluster flagged on 2026-08-11. Quarterdeck Partners is the only one at proposal stage; the rest are first conversations.',
      errorMessage: null,
      promptTokens: 18_442,
      completionTokens: 1_205,
      costMicros: BigInt(74_300),
      turns: 4,
      startedBy: null,
      input: { events: [] },
      events: [
        { type: 'assistant', at: ago(65).getTime(), text: 'Finding what moved this week.' },
        { type: 'tool', tool: 'search_context', at: ago(65).getTime(), detail: 'deals stage:new' },
        { type: 'tool_result', tool: 'search_context', at: ago(64).getTime(), text: '6 notes' },
        { type: 'tool', tool: 'write_context', at: ago(64).getTime(), detail: 'data/weekly-digest.md' },
        { type: 'tool_result', tool: 'write_context', at: ago(63).getTime(), text: 'written data/weekly-digest.md' },
        { type: 'assistant', at: ago(63).getTime(), text: 'Digest written.' },
      ],
    },
    {
      id: 'run_hq_digest_002',
      state: digest,
      trigger: 'event',
      status: 'succeeded',
      startedAt: ago(190),
      endedAt: ago(188),
      terminalReason: 'finished',
      summary: 'Quarterdeck moved to proposal; the deal note and the pipeline index now agree.',
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
            source: 'deals/quarterdeck-partners.md',
            summary: 'stage: diligence → term-sheet',
            at: ago(192).toISOString(),
          },
        ],
      },
      events: [
        { type: 'tool', tool: 'read_context', at: ago(190).getTime(), detail: 'deals/quarterdeck-partners.md' },
        { type: 'tool_result', tool: 'read_context', at: ago(190).getTime(), text: '# Quarterdeck Partners\\nStage: proposal' },
        { type: 'tool', tool: 'write_context', at: ago(189).getTime(), detail: 'deals/index.md' },
        { type: 'tool_result', tool: 'write_context', at: ago(188).getTime(), text: 'written deals/index.md' },
        { type: 'assistant', at: ago(188).getTime(), text: 'Pipeline index updated.' },
      ],
    },
    {
      id: 'run_hq_weekly_001',
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
      events: [{ type: 'system', at: ago(4_318).getTime(), text: 'auth: provider rejected the key' }],
    },
    {
      id: 'run_hq_digest_003',
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
      events: [{ type: 'tool', tool: 'search_context', at: ago(2).getTime(), detail: 'portfolio' }],
    },
  ];

  // The fifth RunTrigger value. Worth its own row: a webhook run is the only
  // one whose input arrives from outside the space entirely.
  runs.push({
    id: 'run_hq_digest_004',
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
    events: [{ type: 'assistant', at: ago(698).getTime(), text: 'Pipeline reconciled.' }],
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
      // The trace is placeholder data this script owns, so a re-run brings an
      // older row up to the shape the executor writes today.
      update: { events: run.events as never },
    });
  }
  count('agent_runs', runs.length);

  // The `running` row must agree with the claim its AgentState holds, or
  // overlap suppression is reading a state no tick could have produced.
  await prisma.agentState.update({
    where: { id: digest.id },
    data: { status: 'running', runningSince: ago(2), currentRunId: 'run_hq_digest_003' },
  });

  // The mailbox: two rows already consumed by the runs above, two still pending
  // (one of them carrying a dedupe key, which is the partial-unique case).
  const events = [
    {
      id: 'agev_hq_001',
      agentName: 'dealflow-digest',
      kind: 'note_written',
      source: 'deals/quarterdeck-partners.md',
      summary: 'stage: diligence → term-sheet',
      payload: { path: 'deals/quarterdeck-partners.md', actor: 'Dev Admin', changed: true },
      dedupeKey: null,
      createdAt: ago(192),
      consumedBy: 'run_hq_digest_002',
    },
    {
      id: 'agev_hq_002',
      agentName: 'dealflow-digest',
      kind: 'webhook',
      source: 'dealflow-inbound',
      summary: 'Affinity: 2 new opportunities',
      payload: { provider: 'affinity', opportunities: 2 },
      dedupeKey: null,
      createdAt: ago(200),
      consumedBy: 'run_hq_digest_002',
    },
    {
      id: 'agev_hq_003',
      agentName: 'dealflow-digest',
      kind: 'note_written',
      source: 'communities/kowhai-labs/index.md',
      summary: 'Series D close added to the company note',
      payload: { path: 'communities/kowhai-labs/index.md', actor: 'Dev Admin', changed: true },
      dedupeKey: 'note_written:communities/kowhai-labs/index.md',
      createdAt: ago(9),
      consumedBy: null,
    },
    {
      id: 'agev_hq_004',
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
      accountLabel: 'Visvine HQ (workspace)',
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
    { ownerKey: SHARED, path: 'segments', restricted: false, locked: false },
    { ownerKey: ADMIN, path: 'discovery', restricted: false, locked: false },
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
      id: 'car_hq_001',
      userId: MEMBER,
      resourcePath: 'deals',
      level: 10,
      message: 'Working on the Quarterdeck proposal — I need to read the deal notes.',
      status: 'pending',
      createdAt: ago(180),
      resolvedBy: null as string | null,
      resolvedAt: null as Date | null,
      grantedLevel: null as number | null,
    },
    {
      // '' = the context root gate. The path is recorded even when it doesn't
      // exist, so the denial copy never admits whether it does.
      id: 'car_hq_004',
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
      id: 'cmp_hq_001',
      fromPath: 'discovery/quarterdeck.md',
      toPath: 'deals/quarterdeck-notes.md',
      folderId: 'deals',
      kind: 'copy',
      status: 'pending',
      proposedBy: ADMIN,
      proposerName: 'Dev Admin',
      proposedAt: ago(150),
      resolvedBy: null as string | null,
      resolvedAt: null as Date | null,
      content:
        '---\ntitle: Quarterdeck Partners — discovery\ntype: Deal\n---\n\nSecond meeting notes. Procurement timing is the open question, not the product.\n',
    },
    {
      id: 'cmp_hq_002',
      fromPath: 'journal/2026-09-11.md',
      toPath: 'team/onboarding-notes-september.md',
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
      content: '---\ntitle: Onboarding notes — September\n---\n\nPreview snapshot taken at proposal time.\n',
    },
    {
      id: 'cmp_hq_003',
      fromPath: 'journal/2026-09-04.md',
      toPath: 'data/september-scratch.md',
      folderId: 'data',
      kind: 'copy',
      status: 'denied',
      proposedBy: ADMIN,
      proposerName: 'Dev Admin',
      proposedAt: ago(10_000),
      resolvedBy: ADMIN,
      resolvedAt: ago(9_800),
      content: '---\ntitle: September scratch\n---\n\nSuperseded by the Q3 revenue roll-up.\n',
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
    { sourcePath: 'communities/kowhai-labs/index.md', targetPath: 'spaces/visvine-hq/kowhai-labs.md', active: true },
    { sourcePath: 'communities/harbourline-capital/index.md', targetPath: 'spaces/visvine-hq/harbourline-capital.md', active: true },
    // Unlinked: the replica stays behind as a plain editable copy.
    { sourcePath: 'segments/venture-capital.md', targetPath: 'spaces/visvine-hq/venture-capital.md', active: false },
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
    path: 'data/revenue-roll-up-q3.csv',
    name: 'Revenue roll-up (Q3).csv',
    kind: 'csv',
    mimeType: 'text/csv',
    status: 'ready',
    resourceName: 'Revenue roll-up (Q3)',
    chunks: [
      'segment,accounts,seats,mrr_nzd,net_retention_pct\nAccelerators & Incubators,7,251,6620,104',
      'Venture Capital,5,119,7850,97\nUniversities & Research,5,228,5660,112',
      'Industry Bodies,5,225,7390,108\nCorporate Innovation,4,151,7760,84',
    ],
  },
  {
    path: 'deals/onboarding-checklist.md.txt',
    name: 'Onboarding checklist.txt',
    kind: 'text',
    mimeType: 'text/plain',
    status: 'ready',
    resourceName: 'Onboarding checklist',
    chunks: [
      'ONBOARDING A NEW SPACE\n\n1. Their member list, any format\n2. Who administers it, by name\n3. One question they cannot answer today',
      '4. Import the list without tidying it\n5. Write one note together, open the graph\n6. Hand over the keyboard\n7. A second admin, always',
    ],
  },
  {
    // A failure, so the "why can't the AI see my file" path has a row.
    path: 'data/board-side-letters.docx',
    name: 'Board side letters.docx',
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
    { id: 'rfold_hq_revenue', name: 'Revenue', parentId: null as string | null },
    { id: 'rfold_hq_deals', name: 'Deal room', parentId: null },
    { id: 'rfold_hq_board', name: 'Board reporting', parentId: null },
  ];
  const children = [
    { id: 'rfold_hq_revenue_q3', name: 'Q3 2026', parentId: 'rfold_hq_revenue' },
    { id: 'rfold_hq_deals_quarterdeck', name: 'Quarterdeck', parentId: 'rfold_hq_deals' },
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
    ['Revenue roll-up (Q3)', 'rfold_hq_revenue_q3'],
    ['Segment pricing (working)', 'rfold_hq_board'],
    ['Onboarding checklist', 'rfold_hq_deals'],
  ];
  for (const [name, folderId] of filing) {
    await prisma.resource.updateMany({ where: { spaceId: SPACE, name }, data: { folderId } });
  }

  const rollUp = await prisma.resource.findFirst({ where: { spaceId: SPACE, name: 'Revenue roll-up (Q3)' } });
  if (!rollUp) return;

  const changes = [
    {
      id: 'rch_hq_002',
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
      id: 'rch_hq_003',
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

  const portfolioNews = await message('msg_hq_020');
  const general = await message('msg_hq_001');
  const dealflow = await message('msg_hq_013');

  if (portfolioNews) {
    for (const [position, imageUrl] of [
      'https://images.placeholders.dev/?width=1200&height=630&text=Cohort+five',
      'https://images.placeholders.dev/?width=1200&height=630&text=MRR+curve',
    ].entries()) {
      await prisma.messageImage.upsert({
        where: { id: `mimg_hq_${position + 1}` },
        create: { id: `mimg_hq_${position + 1}`, messageId: portfolioNews.id, imageUrl, position },
        update: {},
      });
      count('message_images', 1);
    }
  }

  // Mentions come in two shapes: a USER and a graph NODE.
  const mentionedOrg = await prisma.node.findFirst({ where: { spaceId: SPACE, name: 'Kowhai Labs' } });
  const mentions = [
    { id: 'ment_hq_002', message: general, mentionedUserId: MEMBER, mentionedNodeId: null, mentionType: 'user' },
    {
      id: 'ment_hq_003',
      message: portfolioNews,
      mentionedUserId: null,
      mentionedNodeId: mentionedOrg?.id ?? null,
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
      url: 'https://kowhai-labs.example.com/news/cohort-five',
      title: 'Kowhai Labs opens cohort five',
      description: 'Twelve teams, twelve weeks, and an alumni network four cohorts deep.',
      imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Kowhai+Labs',
      siteName: 'Kowhai Labs',
      message: portfolioNews,
    },
    {
      url: 'https://docs.visvine.example.com/playbook',
      title: 'The Space Playbook',
      description: 'How to run a community space that people actually open twice.',
      imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Visvine',
      siteName: 'Visvine',
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
      where: { id: `mlp_hq_${index + 1}` },
      create: { id: `mlp_hq_${index + 1}`, messageId: preview.message.id, linkPreviewId: row.id },
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
      id: 'npj_hq_001',
      ownerKey: SHARED,
      path: 'communities/kowhai-labs/index.md',
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
      id: 'npj_hq_002',
      ownerKey: SHARED,
      path: 'deals/quarterdeck-partners.md',
      kind: 'rename',
      fromPath: 'deals/quarterdeck-draft.md',
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
      id: 'npj_hq_003',
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
      id: 'npj_hq_004',
      ownerKey: SHARED,
      path: 'data/revenue-roll-up.md',
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
      id: 'oac_hq_001',
      code: 'ac_live_placeholder_0001',
      clientId: 'mcp_claude_desktop_local',
      userId: ADMIN,
      redirectUri: 'http://localhost:33418/callback',
      scope: 'context:read context:write',
      expiresAt: ahead(9),
      consumedAt: null as Date | null,
      createdAt: ago(1),
    },
    {
      id: 'oac_hq_003',
      code: 'ac_expired_placeholder_0003',
      clientId: 'mcp_claude_desktop_local',
      userId: MEMBER,
      redirectUri: 'http://localhost:33418/callback',
      scope: 'context:read',
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
// 8. The audit ledger — top up what the other layers only started
// ─────────────────────────────────────────────────────────────────────────────

async function seedAudit() {
  // Governance mutations and gated reads — the events the ledger exists for.
  const entries = [
    { id: 'cae_hq_001', userId: ADMIN, name: 'Dev Admin', action: 'grant.create', path: 'deals', detail: 'alias Partner → edit', at: ago(20_000) },
    { id: 'cae_hq_002', userId: ADMIN, name: 'Dev Admin', action: 'folder.restrict', path: 'deals', detail: 'restricted: true', at: ago(19_900) },
    { id: 'cae_hq_003', userId: MEMBER, name: 'Dev Member', action: 'note.read', path: 'data/revenue-roll-up.md', detail: 'restricted boundary: data', at: ago(5_800) },
    { id: 'cae_hq_006', userId: ADMIN, name: 'Dev Admin', action: 'connector.run', path: 'connectors/sandbox.md', detail: '200 in 412ms', at: ago(30) },
    { id: 'cae_hq_007', userId: ADMIN, name: 'Dev Admin', action: 'secret.update', path: 'SANDBOX_KEY', detail: 'rotated', at: ago(9_000) },
    { id: 'cae_hq_008', userId: ADMIN, name: 'Dev Admin', action: 'agent.deactivate', path: 'agents/investor-update-drafter/index.md', detail: 'brief_changed', at: ago(4_320) },
    { id: 'cae_hq_009', userId: ADMIN, name: 'Dev Admin', action: 'proposal.approve', path: 'team/onboarding-notes-september.md', detail: 'publish from Dev Admin', at: ago(8_940) },
    { id: 'cae_hq_010', userId: ADMIN, name: 'Dev Admin', action: 'publication.unlink', path: 'segments/venture-capital.md', detail: 'target visvine', at: ago(7_000) },
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
  if (!space) throw new Error(`Space ${SPACE} not found — run \`pnpm db:hq:full\` first.`);

  await seedAgents();
  await seedConnectors();
  await seedGovernance();
  await seedRetrieval();
  await seedDrive();
  await seedMessaging();
  await seedMachinery();
  await seedAudit();

  console.log(`\nplaceholder layer seeded into ${SPACE}:`);
  for (const table of Object.keys(tally).sort()) {
    console.log(`  ${table.padEnd(26)} ${tally[table]}`);
  }
  console.log(
    `\nnote: the ${EMBED_DIMENSIONS}-dim vectors are deterministic placeholders written under` +
      `\n      model "${PLACEHOLDER_EMBED_MODEL}", which retrieval filters OUT. Run` +
      `\n      \`pnpm db:embed\` with an OPENROUTER_API_KEY for real ones.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
