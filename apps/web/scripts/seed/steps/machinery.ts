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
 * the digest with `share_as: use`, so Investments may start it and it runs here
 * as its own author, and the drafter with `share_as: run-in`, so the app fans a
 * copy stamped `shared_from` into Fund Operations, which the house governs.
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
import { parseEvery, type AgentSchedule } from '../../../lib/agents/config'
import { syncAgentState } from '../../../lib/agents/hooks'
import { storeAgentConfig } from '../../../lib/agents/record'
import { applyConfigPatch, defaultAgentConfig, type AgentConfigPatch } from '../../../lib/agents/shared/agentConfig'
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
const DRAFTER = 'lp-update-drafter'

// A brief is what the agent IS; how it runs is its record, set below with
// the same write configure_agent makes (lib/agents/shared/agentConfig.ts).
const DIGEST_BRIEF = `---
type: agent
title: Dealflow digest
description: Each weekday morning, what moved in dealflow and across the portfolio
tags: [Investments]
---

You keep the investment team's picture of dealflow honest.

Each run, read what changed under dealflow/ and spaces/ since your last run (your
memory says when that was). Write a short digest to agents/dealflow-digest/digest.md:

- stage changes, with the deal note linked;
- portfolio companies with a new round, a new name or an exit;
- anything a founder asked for twice.

Deals go by codename. Never write a company's real name into a dealflow note or
the digest, and never edit a deal note yourself; if one is wrong, say so in the
digest.
`

const DRAFTER_BRIEF = `---
type: agent
title: LP update drafter
description: Drafts the quarterly LP letter from the fund table and the portfolio news
tags: [Fund operations]
---

At the start of each quarter, draft the LP letter into
agents/lp-update-drafter/draft.md from funds/performance.md and the portfolio
records under spaces/. The fund table first, then the rounds and exits of the
quarter, then one founder's story. Plain sentences; no adjectives about growth,
and nothing about a live deal.
`

const DIGEST_MEMORY = `---
title: Memory
agent: ${DIGEST}
---

## What I know
- 2026-09-22 — last digest covered everything saved up to yesterday 08:00
- 2026-09-18 — the CRM is ahead of the deal notes by about a day
- 2026-09-17 — Project Banksia is going to committee; Michael owns it

## Decisions
- 2026-09-16 — a first meeting with no follow-up in two weeks is quiet, not dead
- 2026-09-10 — passed deals get one line, never a section

## Open threads
- 2026-09-21 — Project Wattle is waiting on a technical reference
- 2026-09-19 — Heidi's round is announced; the record needs the new valuation

## Last run
- 2026-09-23 — scheduled — Banksia to committee, Quokka passed, Heidi raised
`

function schedule(every: string): AgentSchedule {
  const parsed = parseEvery(every)
  if (!parsed.ok) throw new Error(`seed: ${parsed.error}`)
  return parsed.schedule
}

/** An agent's record, stored as configure_agent stores it, and its row re-derived. */
async function configureSeedAgent(name: string, patch: AgentConfigPatch): Promise<void> {
  const config = applyConfigPatch(defaultAgentConfig(), patch)
  if (!config.ok) throw new Error(`seed: ${name}: ${config.error}`)
  await storeAgentConfig(SPACE_ID, name, config.config, { userId: ADMIN })
  await syncAgentState(SPACE_ID, name)
}

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
  await configureSeedAgent(DIGEST, {
    connectors: ['crm'],
    tools: ['directory'],
    share: ['investments'],
    maxTurns: 30,
    active: true,
    schedule: schedule('0 8 * * 1-5'),
    timezone: SPACE_TIMEZONE,
    on: { context: ['dealflow/**', 'spaces/**'], webhook: null },
    debounceMs: 120_000,
    runsFor: [{ userId: MEMBER_USER, at: { hour: 7, minute: 30 }, timezone: null, model: null }],
  })
  await configureSeedAgent(DRAFTER, {
    tools: ['directory'],
    share: ['fund-operations'],
    shareAs: 'run-in',
    maxTurns: 20,
    schedule: schedule('0 7 1 1,4,7,10 *'),
    timezone: SPACE_TIMEZONE,
  })

  const digest = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE_ID, name: DIGEST } } })
  const drafter = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE_ID, name: DRAFTER } } })
  if (!digest || !drafter) throw new Error('seed: writing the agent briefs made no agent_state rows')

  // The tick's single-row heartbeat; without it the panel reports the watcher down.
  await prisma.agentHeartbeat.create({ data: { id: 1, lastTickAt: ago(1) } })

  // The budget is admin-set and not a note field.
  await prisma.agentState.update({ where: { id: digest.id }, data: { budgetMonthlyCents: 2500 } })
  // The drafter's last run hit a rejected key, which switched its record off
  // (a machine write only ever sets `active: false` — docs/agents.md).
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
      id: 'run_bb_digest_001',
      state: digest,
      trigger: 'scheduled',
      status: 'succeeded',
      startedAt: ago(65),
      endedAt: ago(63),
      terminalReason: 'finished',
      summary:
        'Two first meetings this week, both from programs — Kea from Giants and Kōwhai from Foundry. Banksia is the only deal heading to committee.',
      errorMessage: null,
      promptTokens: 18_442,
      completionTokens: 1_205,
      costMicros: BigInt(74_300),
      turns: 4,
      startedBy: null,
      input: { events: [] },
      events: [
        { type: 'assistant', at: ago(65).getTime(), text: 'Finding what moved this week.' },
        { type: 'tool', tool: 'search_context', at: ago(65).getTime(), detail: 'dealflow stage' },
        { type: 'tool_result', tool: 'search_context', at: ago(64).getTime(), text: '6 notes' },
        { type: 'tool', tool: 'write_context', at: ago(64).getTime(), detail: `agents/${DIGEST}/digest.md` },
        { type: 'tool_result', tool: 'write_context', at: ago(63).getTime(), text: `written agents/${DIGEST}/digest.md` },
        { type: 'assistant', at: ago(63).getTime(), text: 'Digest written.' },
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
      summary: 'Wattle moved to diligence; the deal note and the pipeline now agree.',
      errorMessage: null,
      promptTokens: 9_871,
      completionTokens: 640,
      costMicros: BigInt(39_800),
      turns: 3,
      startedBy: null,
      input: {
        events: [
          { kind: 'note_written', source: 'dealflow/project-wattle.md', summary: 'stage: Partner meeting → Diligence', at: ago(192).toISOString() },
        ],
      },
      events: [
        { type: 'tool', tool: 'read_context', at: ago(190).getTime(), detail: 'dealflow/project-wattle.md' },
        { type: 'tool_result', tool: 'read_context', at: ago(190).getTime(), text: 'Stage: Diligence' },
        { type: 'assistant', at: ago(188).getTime(), text: 'Pipeline and deal note agree.' },
      ],
    },
    {
      id: 'run_bb_drafter_001',
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
      events: [{ type: 'tool', tool: 'search_context', at: ago(2).getTime(), detail: 'portfolio rounds this week' }],
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
    data: { status: 'running', runningSince: ago(2), currentRunId: 'run_bb_digest_003', lastRunAt: ago(65) },
  })

  // The mailbox: one row consumed by the event run, two still waiting (one with a
  // dedupe key, the partial-unique case).
  await prisma.agentEvent.createMany({
    data: [
      {
        id: 'agev_bb_001',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'note_written',
        source: 'dealflow/project-wattle.md',
        summary: 'stage: Partner meeting → Diligence',
        payload: { path: 'dealflow/project-wattle.md', actor: 'Dev Admin', changed: true },
        createdAt: ago(192),
        consumedBy: 'run_bb_digest_002',
      },
      {
        id: 'agev_bb_002',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'note_written',
        source: 'spaces/heidi-health/index.md',
        summary: 'Latest round updated on the record',
        payload: { path: 'spaces/heidi-health/index.md', actor: 'Dev Admin', changed: true },
        dedupeKey: 'note_written:spaces/heidi-health/index.md',
        createdAt: ago(9),
      },
      {
        id: 'agev_bb_003',
        spaceId: SPACE_ID,
        agentName: DIGEST,
        kind: 'reply',
        source: 'Dev Admin',
        summary: 'Yes — lead tomorrow’s digest with Heidi.',
        payload: { userId: ADMIN, text: 'Yes — lead tomorrow’s digest with Heidi.' },
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
  for (const path of ['dealflow', 'team']) await setFolderRestricted(SPACE_ID, path, true, system)
  await setFolderLocked(SPACE_ID, 'funds', true, system)
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
      { spaceId: SPACE_ID, provider: 'notion', issuer: 'https://api.notion.com', clientId: 'bb-notion-dev-client', clientSecret: encryptSecret('placeholder-notion-client-secret'), createdAt: ago(20_000) },
      { spaceId: SPACE_ID, provider: 'linear', issuer: 'https://linear.app', clientId: 'bb-linear-dev-client', clientSecret: null, createdAt: ago(20_000) },
    ],
  })
  count('connector_oauth_clients', 2)
  for (const c of [
    // '' is the space-mode sentinel — NULL would let two space connections coexist.
    { provider: 'notion', userId: '', mode: 'space', accountLabel: 'Blackbird Ventures (workspace)', scopes: ['read_content', 'update_content'], expiresAt: ahead(50), brokenAt: null as Date | null, brokenReason: null as string | null },
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
      { id: 'car_bb_001', spaceId: SPACE_ID, userId: MEMBER, resourcePath: 'dealflow', level: 10, message: 'Helping a Giants founder who is raising — could I read the dealflow notes?', status: 'pending', createdAt: ago(180) },
      // '' is the context root. Recorded even when it does not exist, so a denial never admits whether it does.
      { id: 'car_bb_002', spaceId: SPACE_ID, userId: MEMBER, resourcePath: 'funds', level: 10, message: null, status: 'pending', createdAt: ago(45) },
    ],
  })
  count('context_access_requests', 2)

  // Promotion proposals: a personal note someone wants landed in a shared
  // folder they cannot write to — pending, approved and denied.
  await prisma.contextMoveProposal.createMany({
    data: [
      { id: 'cmp_bb_001', spaceId: SPACE_ID, fromPath: 'diligence/project-wattle.md', toPath: 'dealflow/project-wattle-diligence.md', folderId: 'dealflow', kind: 'copy', status: 'pending', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(150), content: '---\ntitle: Project Wattle — diligence\ntype: Deal\n---\n\nThe first customer is the open question, not the chemistry.\n' },
      { id: 'cmp_bb_002', spaceId: SPACE_ID, fromPath: 'meetings/sunrise-planning.md', toPath: 'team/sunrise-planning.md', folderId: 'team', kind: 'copy', status: 'approved', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(9_000), resolvedBy: ADMIN, resolvedAt: ago(8_940), content: '---\ntitle: Sunrise planning\n---\n\nRun sheet settled; the program drops in early October.\n' },
      { id: 'cmp_bb_003', spaceId: SPACE_ID, fromPath: 'journal/2026-09-04.md', toPath: 'funds/september-scratch.md', folderId: 'funds', kind: 'copy', status: 'denied', proposedBy: ADMIN, proposerName: 'Dev Admin', proposedAt: ago(10_000), resolvedBy: ADMIN, resolvedAt: ago(9_800), content: '---\ntitle: September scratch\n---\n\nSuperseded by the published fund table.\n' },
    ],
  })
  count('context_move_proposals', 3)

  // Publications into the platform's global space, through the publish flow
  // itself: a live link whose replica the sync wrote, and one unlinked since and
  // left behind as a plain copy.
  for (const p of [
    { sourcePath: 'spaces/halter/index.md', targetPath: 'published/blackbird-ventures/halter.md', unlink: false },
    { sourcePath: 'sectors/deep-tech.md', targetPath: 'published/blackbird-ventures/deep-tech.md', unlink: true },
  ]) {
    const result = await publishNote(SPACE_ID, p.sourcePath, GLOBAL_SPACE_ID, p.targetPath, anchorActor(ADMIN))
    if (result.status !== 'applied') throw new Error(`seed: publishing ${p.sourcePath}: ${result.reason}`)
    if (p.unlink) await unpublish(result.publication.id, anchorActor(ADMIN))
    count('context_publications', 1)
  }

  // Message decorations: images, both mention shapes, stars and link previews.
  const heidi = await prisma.node.findFirst({ where: { spaceId: SPACE_ID, name: 'Heidi Health' }, select: { id: true } })
  const withMessage = async (id: string) => (await prisma.message.findUnique({ where: { id }, select: { id: true } }))?.id
  const launch = await withMessage('msg_bb_020')
  const general = await withMessage('msg_bb_001')
  const pipeline = await withMessage('msg_bb_026')
  if (launch) {
    await prisma.messageImage.createMany({
      data: [
        { id: 'mimg_bb_1', messageId: launch, imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=Heidi+Series+C', position: 0 },
        { id: 'mimg_bb_2', messageId: launch, imageUrl: 'https://images.placeholders.dev/?width=1200&height=630&text=US%24340M', position: 1 },
      ],
    })
    count('message_images', 2)
    if (heidi) {
      await prisma.messageMention.create({ data: { id: 'ment_bb_002', messageId: launch, mentionedNodeId: heidi.id, mentionType: 'node' } })
      count('message_mentions', 1)
    }
  }
  if (general) {
    await prisma.messageMention.create({ data: { id: 'ment_bb_001', messageId: general, mentionedUserId: MEMBER, mentionType: 'user' } })
    count('message_mentions', 1)
  }
  for (const messageId of [launch, pipeline].filter((id): id is string => Boolean(id))) {
    await prisma.messageStar.create({ data: { messageId, userId: ADMIN, createdAt: ago(500) } })
    count('message_stars', 1)
  }
  for (const [i, preview] of [
    { url: 'https://www.blackbird.vc/blog/a-billion-reasons-to-invest-right-at-the-very-beginning', title: 'A billion reasons to invest right at the very beginning', description: "Sam Wong on our sixth fund, and why we're still backing wild hearts with wild ideas right at the very beginning.", siteName: 'Blackbird', messageId: launch },
    { url: 'https://www.blackbird.vc/blog/investment-notes-halter-series-e', title: 'Investment Notes: Halter Series E', description: 'Samantha Wong and Maddy Guest on Halter’s Series E.', siteName: 'Blackbird', messageId: pipeline },
  ].entries()) {
    const row = await prisma.linkPreview.create({
      data: { url: preview.url, title: preview.title, description: preview.description, siteName: preview.siteName, imageUrl: `https://images.placeholders.dev/?width=1200&height=630&text=${encodeURIComponent(preview.siteName)}`, fetchedAt: ago(600) },
    })
    count('link_previews', 1)
    if (preview.messageId) {
      await prisma.messageLinkPreview.create({ data: { id: `mlp_bb_${i + 1}`, messageId: preview.messageId, linkPreviewId: row.id } })
      count('message_link_previews', 1)
    }
  }

  // The projection outbox is self-pruning, so a realistic table holds only what
  // is still owed. Every write above settled; this is the one parked, poisoned
  // row the drain gave up on — the state the admin panel exists to show.
  await prisma.noteProjectionJob.create({
    data: {
      id: 'npj_bb_parked',
      spaceId: SPACE_ID,
      ownerKey: SHARED,
      path: 'funds/performance.md',
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
    { id: 'oac_bb_001', code: 'ac_live_placeholder_0001', userId: ADMIN, scope: 'context:read context:write', expiresAt: ahead(9), createdAt: ago(1) },
    { id: 'oac_bb_002', code: 'ac_expired_placeholder_0002', userId: MEMBER, scope: 'context:read', expiresAt: ago(2_870), createdAt: ago(2_880) },
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
      { id: 'cae_bb_001', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'grant.create', path: 'dealflow', detail: 'alias Team → edit', at: ago(20_000) },
      { id: 'cae_bb_002', spaceId: SPACE_ID, userId: MEMBER, name: 'Dev Member', action: 'note.read', path: 'funds/performance.md', detail: 'denied: not granted', at: ago(5_800) },
      { id: 'cae_bb_003', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'connector.run', path: 'connectors/sandbox.md', detail: '200 in 412ms', at: ago(30) },
      { id: 'cae_bb_004', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'secret.update', path: 'SANDBOX_KEY', detail: 'rotated', at: ago(9_000) },
      { id: 'cae_bb_005', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'agent.deactivate', path: `agents/${DRAFTER}/index.md`, detail: 'key_rejected', at: ago(4_318) },
      { id: 'cae_bb_006', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'proposal.approve', path: 'team/sunrise-planning.md', detail: 'copy from Dev Admin', at: ago(8_940) },
      { id: 'cae_bb_007', spaceId: SPACE_ID, userId: ADMIN, name: 'Dev Admin', action: 'publication.unlink', path: 'sectors/deep-tech.md', detail: `target ${GLOBAL_SPACE_ID}`, at: ago(7_000) },
    ],
  })
  count('context_audit_entries', 7)

  return tally
}
