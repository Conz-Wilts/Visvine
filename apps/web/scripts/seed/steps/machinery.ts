/**
 * The machinery a space only has once it is lived in: connectors and their
 * secrets, the space's model and its agents, and then the rows those produce
 * over time — agent runs and their mailbox, OAuth connections, the access and
 * promotion queues, publications, message decorations, the MCP OAuth server's
 * clients, rate-limit buckets and the audit ledger.
 *
 * The declarations are real notes, written through the store: the connector
 * and agent nodes, the agents' `agent_state` rows and the folder indexes all
 * come from the app's own projections. Only the HISTORY is fabricated, and it
 * is keyed to what the declarations made rather than to names typed twice.
 *
 * Both agents are shared down into the rooms, one each way (docs/sub-spaces.md):
 * the digest with `share_as: use`, so Marketing may start it and it runs here as
 * its own author, and the drafter with `share_as: run-in`, so the app fans a
 * copy stamped `shared_from` into Finance, which the house governs.
 * Both are projections of the brief — the seed writes no such row itself.
 *
 * Two honest caveats about that history:
 *  1. **No model key is stored.** The agents run on the space's model note,
 *     whose provider key is a secret this seed does not have; Run now fails
 *     with `auth` until one is added from the model's page.
 *  2. **The OAuth tokens are not credentials.** Connection rows hold encrypted
 *     placeholder strings; they exercise storage, decrypt and the "acts as …"
 *     paths and authenticate to nothing.
 */

import { createHash } from 'node:crypto'
import prisma from '../../../lib/prisma'
import { encryptSecret } from '../../../lib/crypto/secrets'
import { MODEL_CATALOG, modelFromCatalog } from '../../../lib/models/catalog'
import { setFolderLocked, setFolderRestricted } from '../../../lib/notes/access'
import { publishNote, unpublish } from '../../../lib/notes/publications'
import { SHARED_OWNER_KEY } from '../../../lib/notes/store'
import { GLOBAL_SPACE_ID } from '../../../lib/spaces/globalSpace'
import { CONNECTOR_DEMOS, connectorDemo } from '../connectors'
import { ADMIN_USER, MEMBER_USER, SPACE_ID, SPACE_TIMEZONE } from '../space'
import { anchorActor } from './base'
import { putNote, putNotes } from '../write'
import { digestDemoRuns } from './agentDemoRuns'

const SHARED = SHARED_OWNER_KEY
const ADMIN = ADMIN_USER
const MEMBER = MEMBER_USER

const MINUTE = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE)
const ahead = (minutes: number) => new Date(Date.now() + minutes * MINUTE)

/** How lib/rateLimit.ts stores a caller-derived key: hashed and fixed-width. */
const bucketKey = (raw: string) => createHash('sha256').update(raw).digest('hex')

// ---- connectors ---------------------------------------------------------------

export async function seedConnectors(): Promise<{ notes: number; secrets: number }> {
  const context = { spaceId: SPACE_ID, ownerKey: SHARED }
  let notes = 0
  let secrets = 0
  for (const kind of CONNECTOR_DEMOS) {
    const set = connectorDemo(kind, SPACE_ID)
    notes += await putNotes(context, set.notes, anchorActor(ADMIN))
    for (const secret of set.secrets) {
      await prisma.connectorSecret.create({
        data: { spaceId: SPACE_ID, name: secret.name, ciphertext: encryptSecret(secret.value), createdBy: ADMIN },
      })
      secrets++
    }
  }
  return { notes, secrets }
}

// ---- the model and the agents -------------------------------------------------

const DIGEST = 'dealflow-digest'
const DRAFTER = 'investor-update-drafter'

const DIGEST_BRIEF = `---
type: agent
title: Dealflow digest
description: Each weekday morning, what moved in the pipeline and across the accounts
connectors: [crm]
tools: [directory]
share: [marketing]
max_turns: 30
active: true
every: "0 9 * * 1-5"
timezone: ${SPACE_TIMEZONE}
on:
  context: ["deals/**", "spaces/**"]
debounce: 2m
for:
  - user: ${MEMBER_USER}
    at: "07:30"
---

You keep the team's picture of the pipeline honest.

Each run, read what changed under deals/ and spaces/ since your last run (your
memory says when that was). Write a short digest to agents/dealflow-digest/digest.md:

- stage changes, with the deal note linked;
- accounts whose health moved, and why if a note says;
- anything a customer asked for twice.

Check the CRM connector before calling a deal stalled — the notes lag it. Never
edit a deal note yourself; if one is wrong, say so in the digest.
`

const DRAFTER_BRIEF = `---
type: agent
title: Investor update drafter
description: Drafts the monthly investor update from the revenue roll-up
tools: [directory]
share: [finance]
share_as: run-in
max_turns: 20
active: false
every: "0 7 1 * *"
timezone: ${SPACE_TIMEZONE}
---

On the first of the month, draft the investor update into
agents/investor-update-drafter/draft.md from data/revenue-roll-up.md and
data/retention.md. Numbers first, then the one thing that went wrong, then
what we are hiring for. Plain sentences; no adjectives about growth.
`

const DIGEST_MEMORY = `---
title: Memory
agent: ${DIGEST}
---

## What I know
- 2026-09-18 — last digest covered everything saved up to yesterday 09:00
- 2026-09-16 — the CRM is ahead of the deal notes by about a day
- 2026-09-12 — Quarterdeck Partners is at proposal; Ana owns it

## Decisions
- 2026-09-16 — a trial with a login in the last 3 days is quiet, not stalled
- 2026-09-10 — closed-lost deals get one line, never a section

## Open threads
- 2026-09-18 — Harbour Labs has asked about SSO twice; nobody has answered
- 2026-09-17 — Fernhill: 9 days without a login in the notes, 2 in the CRM

## Last run
- 2026-09-19 — scheduled — one stage change, one loss, Juniper renewed
`

export async function seedAgents(): Promise<{ agents: number; runs: number }> {
  const context = { spaceId: SPACE_ID, ownerKey: SHARED }
  const actor = anchorActor(ADMIN)

  // The space's model, as Settings → Models writes it. The key is a secret the
  // seed does not have — see the header.
  const anthropic = MODEL_CATALOG.find((m) => m.id === 'anthropic')
  if (!anthropic) throw new Error('seed: no anthropic entry in the model catalogue')
  const model = modelFromCatalog(anthropic, {
    name: 'claude',
    title: 'Claude',
    description: 'What this space’s agents run on unless a brief pins another',
    values: { model: 'claude-sonnet-5' },
  })
  await putNote(context, 'models/claude.md', model.content, actor)

  await putNote(context, `agents/${DIGEST}/index.md`, DIGEST_BRIEF, actor)
  await putNote(context, `agents/${DRAFTER}/index.md`, DRAFTER_BRIEF, actor)
  await putNote(context, `agents/${DIGEST}/memory.md`, DIGEST_MEMORY, actor)

  const digest = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE_ID, name: DIGEST } } })
  const drafter = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE_ID, name: DRAFTER } } })
  if (!digest || !drafter) throw new Error('seed: writing the agent briefs made no agent_state rows')

  // The tick's single-row heartbeat; without it the panel reports the watcher down.
  await prisma.agentHeartbeat.create({ data: { id: 1, lastTickAt: ago(1) } })

  // The budget is admin-set and not a note field.
  await prisma.agentState.update({ where: { id: digest.id }, data: { budgetMonthlyCents: 2500 } })
  // The drafter's last run hit a rejected key, which is the one machine write
  // into a brief: it can only set `active: false` (docs/agents.md).
  await prisma.agentState.update({
    where: { id: drafter.id },
    data: {
      budgetMonthlyCents: 10_000,
      lastRunAt: ago(4_320),
      consecutiveFailures: 1,
      deactivatedReason: 'key_rejected',
      deactivatedDetail: 'Anthropic rejected the stored key (401).',
    },
  })

  const runs = [
    {
      id: 'run_hq_digest_001',
      state: digest,
      trigger: 'scheduled',
      status: 'succeeded',
      startedAt: ago(65),
      endedAt: ago(63),
      terminalReason: 'finished',
      summary:
        'Six spaces asked about pricing this week, four of them accelerators. Quarterdeck Partners is the only one at proposal stage; the rest are first conversations.',
      errorMessage: null,
      promptTokens: 18_442,
      completionTokens: 1_205,
      costMicros: BigInt(74_300),
      turns: 4,
      startedBy: null,
      input: { events: [] },
      events: [
        { type: 'assistant', at: ago(65).getTime(), text: 'Finding what moved this week.' },
        { type: 'tool', tool: 'search_context', at: ago(65).getTime(), detail: 'deals stage' },
        { type: 'tool_result', tool: 'search_context', at: ago(64).getTime(), text: '6 notes' },
        { type: 'tool', tool: 'write_context', at: ago(64).getTime(), detail: `agents/${DIGEST}/digest.md` },
        { type: 'tool_result', tool: 'write_context', at: ago(63).getTime(), text: `written agents/${DIGEST}/digest.md` },
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
      summary: 'Quarterdeck moved to proposal; the deal note and the pipeline now agree.',
      errorMessage: null,
      promptTokens: 9_871,
      completionTokens: 640,
      costMicros: BigInt(39_800),
      turns: 3,
      startedBy: null,
      input: {
        events: [
          { kind: 'note_written', source: 'deals/quarterdeck-partners.md', summary: 'stage: Trial → Proposal', at: ago(192).toISOString() },
        ],
      },
      events: [
        { type: 'tool', tool: 'read_context', at: ago(190).getTime(), detail: 'deals/quarterdeck-partners.md' },
        { type: 'tool_result', tool: 'read_context', at: ago(190).getTime(), text: 'Stage: Proposal' },
        { type: 'assistant', at: ago(188).getTime(), text: 'Pipeline and deal note agree.' },
      ],
    },
    {
      id: 'run_hq_drafter_001',
      state: drafter,
      trigger: 'scheduled',
      status: 'failed',
      startedAt: ago(4_320),
      endedAt: ago(4_318),
      terminalReason: 'auth',
      summary: null,
      errorMessage: 'Anthropic rejected the stored key (401). Set MODEL_KEY_ANTHROPIC on the Claude model.',
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
      events: [{ type: 'tool', tool: 'search_context', at: ago(2).getTime(), detail: 'accounts health' }],
    },
  ]
  // Runs long enough to show what a run looks like: turns, calls under them, a
  // refusal, a run for somebody else, one that ran out of turns.
  const demo = digestDemoRuns(ago, DIGEST, MEMBER, ADMIN).map((r) => ({
    ...r,
    state: digest,
    promptTokens: 21_000,
    completionTokens: 1_400,
    costMicros: BigInt(80_000),
    input: { events: [], writes: r.writes },
  }))
  for (const run of [...runs.map((r) => ({ ...r, runAsUserId: null as string | null })), ...demo]) {
    await prisma.agentRun.create({
      data: {
        id: run.id,
        stateId: run.state.id,
        spaceId: SPACE_ID,
        name: run.state.name,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        startedBy: run.startedBy,
        runAsUserId: run.runAsUserId,
        model: 'claude-sonnet-5',
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        costMicros: run.costMicros,
        turns: run.turns,
        terminalReason: run.terminalReason,
        summary: run.summary,
        errorMessage: run.errorMessage,
        events: run.events as never,
        eventCount: run.events.length,
        input: run.input as never,
      },
    })
  }

  // The `running` row must agree with the claim its state holds, or overlap
  // suppression is reading a state no tick could have produced.
  await prisma.agentState.update({
    where: { id: digest.id },
    data: { status: 'running', runningSince: ago(2), currentRunId: 'run_hq_digest_003', lastRunAt: ago(65) },
  })

  // The mailbox: one row consumed by the event run, two still waiting (one with a
  // dedupe key, the partial-unique case).
  await prisma.agentEvent.createMany({
    data: [
      {
        id: 'agev_hq_001',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'note_written',
        source: 'deals/quarterdeck-partners.md',
        summary: 'stage: Trial → Proposal',
        payload: { path: 'deals/quarterdeck-partners.md', actor: 'Dev Admin', changed: true },
        createdAt: ago(192),
        consumedBy: 'run_hq_digest_002',
      },
      {
        id: 'agev_hq_002',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'note_written',
        source: 'spaces/kowhai-labs/index.md',
        summary: 'Seat count updated on the account note',
        payload: { path: 'spaces/kowhai-labs/index.md', actor: 'Dev Admin', changed: true },
        dedupeKey: 'note_written:spaces/kowhai-labs/index.md',
        createdAt: ago(9),
      },
      {
        id: 'agev_hq_003',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'reply',
        source: 'Dev Admin',
        summary: 'Yes — call out Fernmark in tomorrow’s digest.',
        payload: { userId: ADMIN, text: 'Yes — call out Fernmark in tomorrow’s digest.' },
        createdAt: ago(6),
      },
    ],
  })

  return { agents: 2, runs: runs.length + demo.length }
}

// ---- what living in a space leaves behind -------------------------------------

export async function seedLivedIn(): Promise<Record<string, number>> {
  const tally: Record<string, number> = {}
  const count = (table: string, n: number) => (tally[table] = (tally[table] ?? 0) + n)
  const system = { userId: ADMIN, name: 'Dev Admin' }

  // Folder flags, set the way the Share panel sets them. `restricted` cuts grant
  // inheritance at the boundary; `locked` freezes a folder for AI maintenance.
  for (const path of ['deals', 'team']) await setFolderRestricted(SPACE_ID, path, true, system)
  await setFolderLocked(SPACE_ID, 'data', true, system)
  await prisma.contextFolder.upsert({
    where: { folder_identity: { spaceId: SPACE_ID, ownerKey: ADMIN, path: 'journal' } },
    create: { spaceId: SPACE_ID, ownerKey: ADMIN, path: 'journal', locked: true },
    update: { locked: true },
  })
  count('context_folders (flagged)', 4)

  // Connectors: registered OAuth clients (confidential and public), a live space
  // connection and a broken user one, and a connector's memory between runs.
  await prisma.connectorOAuthClient.createMany({
    data: [
      { spaceId: SPACE_ID, provider: 'notion', issuer: 'https://api.notion.com', clientId: 'hq-notion-dev-client', clientSecret: encryptSecret('placeholder-notion-client-secret'), createdAt: ago(20_000) },
      { spaceId: SPACE_ID, provider: 'linear', issuer: 'https://linear.app', clientId: 'hq-linear-dev-client', clientSecret: null, createdAt: ago(20_000) },
    ],
  })
  count('connector_oauth_clients', 2)
  for (const c of [
    // '' is the space-mode sentinel — NULL would let two space connections coexist.
    { provider: 'notion', userId: '', mode: 'space', accountLabel: 'Visvine HQ (workspace)', scopes: ['read_content', 'update_content'], expiresAt: ahead(50), brokenAt: null as Date | null, brokenReason: null as string | null },
    { provider: 'atlassian', userId: ADMIN, mode: 'user', accountLabel: 'admin@local.dev', scopes: ['read:jira-work'], expiresAt: ago(2_880), brokenAt: ago(2_875), brokenReason: 'refresh_token_expired: the provider rejected the refresh grant (invalid_grant)' },
  ]) {
    await prisma.connectorConnection.create({
      data: {
        ...c,
        spaceId: SPACE_ID,
        connectedBy: ADMIN,
        accessToken: encryptSecret(`placeholder-access-token-${c.provider}`),
        refreshToken: encryptSecret(`placeholder-refresh-token-${c.provider}`),
        createdAt: ago(20_000),
      },
    })
  }
  count('connector_connections', 2)
  await prisma.connectorState.createMany({
    data: [
      { spaceId: SPACE_ID, path: 'connectors/sandbox.md', key: 'lastCursor', value: { cursor: 'wid_003', at: ago(30).toISOString() } },
      { spaceId: SPACE_ID, path: 'connectors/crm.md', key: 'lastSync', value: { contacts: 6, at: ago(120).toISOString() } },
    ],
  })
  count('connector_state', 2)

  // Access requests: the pending queue behind Console → People → Waiting.
  await prisma.contextAccessRequest.createMany({
    data: [
      { id: 'car_hq_001', spaceId: SPACE_ID, userId: MEMBER, resourcePath: 'deals', level: 10, message: 'Working on the Quarterdeck proposal — I need to read the deal notes.', status: 'pending', createdAt: ago(180) },
      // '' is the context root. Recorded even when it does not exist, so a denial never admits whether it does.
      { id: 'car_hq_002', spaceId: SPACE_ID, userId: MEMBER, resourcePath: 'data', level: 10, message: null, status: 'pending', createdAt: ago(45) },
    ],
  })
  count('context_access_requests', 2)

  // Promotion proposals: a personal note someone wants landed in a shared
  // folder they cannot write to — pending, approved and denied.
  await prisma.contextMoveProposal.createMany({
    data: [
      { id: 'cmp_hq_001', spaceId: SPACE_ID, fromPath: 'discovery/quarterdeck.md', toPath: 'deals/quarterdeck-discovery.md', folderId: 'deals', kind: 'copy', status: 'pending', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(150), content: '---\ntitle: Quarterdeck Partners — discovery\ntype: Deal\n---\n\nProcurement timing is the open question, not the product.\n' },
      { id: 'cmp_hq_002', spaceId: SPACE_ID, fromPath: 'meetings/offsite-debrief.md', toPath: 'team/offsite-debrief.md', folderId: 'team', kind: 'copy', status: 'approved', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(9_000), resolvedBy: ADMIN, resolvedAt: ago(8_940), content: '---\ntitle: Team offsite debrief\n---\n\nWhere the principles came from.\n' },
      { id: 'cmp_hq_003', spaceId: SPACE_ID, fromPath: 'journal/2026-09-04.md', toPath: 'data/september-scratch.md', folderId: 'data', kind: 'copy', status: 'denied', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(10_000), resolvedBy: ADMIN, resolvedAt: ago(9_800), content: '---\ntitle: September scratch\n---\n\nSuperseded by the revenue roll-up.\n' },
    ],
  })
  count('context_move_proposals', 3)

  // Publications into the platform's global space, through the publish flow
  // itself: a live link whose replica the sync wrote, and one unlinked since and
  // left behind as a plain copy.
  for (const p of [
    { sourcePath: 'spaces/kowhai-labs/index.md', targetPath: 'published/visvine-hq/kowhai-labs.md', unlink: false },
    { sourcePath: 'segments/venture-capital.md', targetPath: 'published/visvine-hq/venture-capital.md', unlink: true },
  ]) {
    const result = await publishNote(SPACE_ID, p.sourcePath, GLOBAL_SPACE_ID, p.targetPath, anchorActor(ADMIN))
    if (result.status !== 'applied') throw new Error(`seed: publishing ${p.sourcePath}: ${result.reason}`)
    if (p.unlink) await unpublish(result.publication.id, anchorActor(ADMIN))
    count('context_publications', 1)
  }

  // Message decorations: images, both mention shapes, stars and link previews.
  const kowhai = await prisma.node.findFirst({ where: { spaceId: SPACE_ID, name: 'Kowhai Labs' }, select: { id: true } })
  const withMessage = async (id: string) => (await prisma.message.findUnique({ where: { id }, select: { id: true } }))?.id
  const launch = await withMessage('msg_hq_020')
  const general = await withMessage('msg_hq_001')
  const pipeline = await withMessage('msg_hq_013')
  if (launch) {
    await prisma.messageImage.createMany({
      data: [
        { id: 'mimg_hq_1', messageId: launch, imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Cohort+five', position: 0 },
        { id: 'mimg_hq_2', messageId: launch, imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=MRR+curve', position: 1 },
      ],
    })
    count('message_images', 2)
    if (kowhai) {
      await prisma.messageMention.create({ data: { id: 'ment_hq_002', messageId: launch, mentionedNodeId: kowhai.id, mentionType: 'node' } })
      count('message_mentions', 1)
    }
  }
  if (general) {
    await prisma.messageMention.create({ data: { id: 'ment_hq_001', messageId: general, mentionedUserId: MEMBER, mentionType: 'user' } })
    count('message_mentions', 1)
  }
  for (const messageId of [launch, pipeline].filter((id): id is string => Boolean(id))) {
    await prisma.messageStar.create({ data: { messageId, userId: ADMIN, createdAt: ago(500) } })
    count('message_stars', 1)
  }
  for (const [i, preview] of [
    { url: 'https://kowhai-labs.example.com/news/cohort-five', title: 'Kowhai Labs opens cohort five', description: 'Twelve teams, twelve weeks, and an alumni network four cohorts deep.', siteName: 'Kowhai Labs', messageId: launch },
    { url: 'https://docs.visvine.example.com/playbook', title: 'The Space Playbook', description: 'How to run a community space that people actually open twice.', siteName: 'Visvine', messageId: pipeline },
  ].entries()) {
    const row = await prisma.linkPreview.create({
      data: { url: preview.url, title: preview.title, description: preview.description, siteName: preview.siteName, imageUrl: `https://images.placeholders.dev/?width=1200&height=630&text=${encodeURIComponent(preview.siteName)}`, fetchedAt: ago(600) },
    })
    count('link_previews', 1)
    if (preview.messageId) {
      await prisma.messageLinkPreview.create({ data: { id: `mlp_hq_${i + 1}`, messageId: preview.messageId, linkPreviewId: row.id } })
      count('message_link_previews', 1)
    }
  }

  // The projection outbox is self-pruning, so a realistic table holds only what
  // is still owed. Every write above settled; this is the one parked, poisoned
  // row the drain gave up on — the state the admin panel exists to show.
  await prisma.noteProjectionJob.create({
    data: {
      id: 'npj_hq_parked',
      spaceId: SPACE_ID,
      ownerKey: SHARED,
      path: 'data/revenue-roll-up.md',
      kind: 'write',
      origin: 'agent',
      actorId: `agent:${DRAFTER}`,
      actorName: DRAFTER,
      model: 'claude-sonnet-5',
      changed: true,
      attempts: 8,
      lastError: 'publication sync failed: target space replica is locked',
      createdAt: ago(3_000),
      runAfter: ago(2_400),
      doneAt: ago(2_390),
    },
  })
  count('note_projection_jobs', 1)

  // The self-hosted MCP OAuth server: registered public clients, a live code
  // and an expired one. No refresh tokens — that grant does not exist.
  await prisma.oAuthClient.createMany({
    data: [
      { clientId: 'mcp_claude_desktop_local', clientName: 'Claude Desktop', redirectUris: ['http://localhost:33418/callback', 'claude://oauth/callback'], scope: 'context:read context:write', createdAt: ago(30_000) },
      { clientId: 'mcp_claude_code_local', clientName: 'Claude Code', redirectUris: ['http://127.0.0.1:41293/callback'], scope: 'context:read creator:write', createdAt: ago(30_000) },
    ],
  })
  count('oauth_clients', 2)
  for (const code of [
    { id: 'oac_hq_001', code: 'ac_live_placeholder_0001', userId: ADMIN, scope: 'context:read context:write', expiresAt: ahead(9), createdAt: ago(1) },
    { id: 'oac_hq_002', code: 'ac_expired_placeholder_0002', userId: MEMBER, scope: 'context:read', expiresAt: ago(2_870), createdAt: ago(2_880) },
  ]) {
    await prisma.oAuthAuthCode.create({
      data: { ...code, clientId: 'mcp_claude_desktop_local', redirectUri: 'http://localhost:33418/callback', codeChallenge: createHash('sha256').update(`verifier-${code.id}`).digest('base64url') },
    })
  }
  count('oauth_auth_codes', 2)

  // Rate-limit buckets: partly spent, nearly exhausted, and a full idle one the
  // nightly sweep is meant to reclaim.
  await prisma.rateLimitBucket.createMany({
    data: [
      { key: bucketKey('login:admin@local.dev'), tokens: 4.5, updatedAt: ago(3) },
      { key: bucketKey('login:198.51.100.24'), tokens: 0.25, updatedAt: ago(1) },
      { key: bucketKey(`connector-runs:${SPACE_ID}`), tokens: 112, updatedAt: ago(8) },
      { key: bucketKey(`agent-tick:${SPACE_ID}`), tokens: 30, updatedAt: ago(4_000) },
    ],
  })
  count('rate_limit_buckets', 4)

  // The audit ledger: governance mutations and gated reads the other layers
  // did not already log.
  await prisma.contextAuditEntry.createMany({
    data: [
      { id: 'cae_hq_001', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'grant.create', path: 'deals', detail: 'alias Team → edit', at: ago(20_000) },
      { id: 'cae_hq_002', spaceId: SPACE_ID, userId: MEMBER, name: 'Dev Member', action: 'note.read', path: 'data/revenue-roll-up.md', detail: 'denied: not granted', at: ago(5_800) },
      { id: 'cae_hq_003', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'connector.run', path: 'connectors/sandbox.md', detail: '200 in 412ms', at: ago(30) },
      { id: 'cae_hq_004', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'secret.update', path: 'SANDBOX_KEY', detail: 'rotated', at: ago(9_000) },
      { id: 'cae_hq_005', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'agent.deactivate', path: `agents/${DRAFTER}/index.md`, detail: 'key_rejected', at: ago(4_318) },
      { id: 'cae_hq_006', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'proposal.approve', path: 'team/offsite-debrief.md', detail: 'copy from Dev Admin', at: ago(8_940) },
      { id: 'cae_hq_007', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'publication.unlink', path: 'segments/venture-capital.md', detail: `target ${GLOBAL_SPACE_ID}`, at: ago(7_000) },
    ],
  })
  count('context_audit_entries', 7)

  return tally
}
