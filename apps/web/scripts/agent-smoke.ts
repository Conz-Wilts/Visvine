/**
 * End-to-end smoke test for the agent runtime, against the LOCAL database.
 *
 * It wires a throwaway model connector (OpenRouter through `provider: custom`)
 * and a throwaway agent, derives the state row the way a note save does, runs
 * the agent once through the real claim → dispatch → runner path, and prints
 * the transcript. Nothing here is a fixture: the model call is real, the note
 * writes are real, and the run row is the same shape the agent pages read.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/agent-smoke.ts          # run it
 *   pnpm --filter @visvine/web exec tsx scripts/agent-smoke.ts --off    # tear it down
 *
 * The key comes from OPENROUTER_API_KEY in apps/web/.env and is stored the way
 * every model key is — encrypted in ConnectorSecret, admin-only, write-only.
 * `--off` deletes it, switches the connector off and removes both agent notes.
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { encryptSecret } from '../lib/crypto/secrets';
import { syncContextLinksBulk } from '../lib/notes/entityLinks';
import { syncAgentState } from '../lib/agents/hooks';
import { claimManualRun } from '../lib/agents/schedule';
import { latestRun } from '../lib/agents/runs';

const SHARED = 'shared';
const SPACE = process.argv.find((a) => a.startsWith('community:')) ?? 'community:blackbird-ventures';
const OFF = process.argv.includes('--off');
const AGENT = 'smoke-test';
const CONNECTOR = 'connectors/openrouter.md';
const BRIEF = `agents/${AGENT}.md`;
const LIVE = `agents/live/${AGENT}.md`;
const MODEL = 'custom/z-ai/glm-5.3-flash';

const connectorNote = (enabled: boolean) => `---
type: connector
kind: model
provider: custom
base_url: https://openrouter.ai/api/v1/
title: OpenRouter (test)
description: Throwaway model endpoint for the agent smoke test${enabled ? '' : '\nenabled: false'}
---

OpenRouter's OpenAI-compatible endpoint, wired only to prove the agent runtime
end to end. The key is the space's \`MODEL_KEY_CUSTOM\` secret.
`;

const briefNote = `---
type: agent
title: Smoke test
description: Proves the agent runtime is wired — model, tools, run record
model: ${MODEL}
max_turns: 4
---

You are a smoke test. Do exactly one thing and stop.

Count the letter "r" in the word "strawberry" and write the answer, in one
sentence, to \`reports/agent-smoke.md\` using write_context. Then say what you
wrote and finish. Do not read anything else and do not ask a human anything.
`;

const liveNote = `---
active: true
every: 24h
---

Activated by scripts/agent-smoke.ts. Manual runs only in practice.
`;

async function upsertNote(spaceId: string, path: string, content: string, createdBy: string) {
  await prisma.contextNote.upsert({
    where: { note_identity: { spaceId, ownerKey: SHARED, path } },
    create: { spaceId, ownerKey: SHARED, path, content, createdBy },
    update: { content, deletedAt: null, deletedPath: null },
  });
}

async function main() {
  const space = await prisma.space.findUnique({ where: { id: SPACE }, select: { id: true, name: true } });
  if (!space) throw new Error(`no space ${SPACE} — seed the database first`);

  if (OFF) {
    await prisma.connectorSecret.deleteMany({ where: { spaceId: space.id, name: 'MODEL_KEY_CUSTOM' } });
    // The connector note stays, switched off: `enabled: false` is what "off"
    // means everywhere else in this app, and it keeps the run history readable.
    await upsertNote(space.id, CONNECTOR, connectorNote(false), 'agent-smoke');
    const notes = await prisma.contextNote.deleteMany({
      where: { spaceId: space.id, ownerKey: SHARED, path: { in: [BRIEF, LIVE] } },
    });
    await prisma.agentState.deleteMany({ where: { spaceId: space.id, name: AGENT } });
    await syncContextLinksBulk({ spaceId: space.id, ownerKey: SHARED }, [BRIEF, LIVE]);
    console.log(`off: key deleted, connector disabled, ${notes.count} agent note(s) removed from ${space.name}`);
    return;
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set in apps/web/.env');

  const owner =
    (await prisma.userAlias.findFirst({ where: { spaceId: space.id, aliasId: ADMIN_ALIAS_ID }, select: { userId: true } })) ??
    (await prisma.spaceMember.findFirst({ where: { spaceId: space.id }, select: { userId: true } }));
  if (!owner) throw new Error(`space ${SPACE} has no members to attribute the notes to`);

  await upsertNote(space.id, CONNECTOR, connectorNote(true), owner.userId);
  await upsertNote(space.id, BRIEF, briefNote, owner.userId);
  await upsertNote(space.id, LIVE, liveNote, owner.userId);
  await syncContextLinksBulk(
    { spaceId: space.id, ownerKey: SHARED },
    [],
    [[CONNECTOR, connectorNote(true)]],
  );

  await prisma.connectorSecret.upsert({
    where: { secret_identity: { spaceId: space.id, name: 'MODEL_KEY_CUSTOM' } },
    create: { spaceId: space.id, name: 'MODEL_KEY_CUSTOM', ciphertext: encryptSecret(key), createdBy: 'agent-smoke' },
    update: { ciphertext: encryptSecret(key), createdBy: 'agent-smoke' },
  });

  // What a note save does. Writing straight to the table skips the store, so
  // the row the scheduler reads has to be derived by hand.
  const state = await syncAgentState(space.id, AGENT);
  console.log(`state: active=${state.active} nextRunAt=${state.nextRunAt?.toISOString() ?? 'null'} invalid=${state.invalid ?? 'none'}`);
  if (!state.active) throw new Error(`the agent did not activate: ${state.invalid ?? 'unknown reason'}`);

  const claimed = await claimManualRun(space.id, AGENT, owner.userId);
  if (!claimed.ok) throw new Error(`could not start a run: ${claimed.code} — ${claimed.message}`);
  console.log(`run:   ${claimed.runId} claimed, dispatching…`);
  const outcome = await claimed.dispatch;
  console.log(`       ${outcome?.ok ? 'dispatch ok' : `dispatch failed: ${outcome?.error}`}`);

  const run = await latestRun(space.id, AGENT);
  if (!run) throw new Error('no run row was written');
  console.log(`\n=== run ${run.id} ===`);
  console.log(`status ${run.status}  turns ${run.turns}  model ${run.model ?? '—'}  cost ${Number(run.costMicros ?? 0) / 1_000_000} USD`);
  // The transcript is not on the list row — it is the run's own `events` column.
  const detail = await prisma.agentRun.findUnique({ where: { id: run.id }, select: { events: true, errorMessage: true } });
  const events = Array.isArray(detail?.events) ? (detail.events as { type?: string; text?: string; tool?: string; detail?: string }[]) : [];
  for (const e of events) {
    const body = (e.text ?? e.detail ?? '').replace(/\s+/g, ' ').slice(0, 300);
    console.log(`  ${(e.type ?? '?').padEnd(12)} ${e.tool ? `[${e.tool}] ` : ''}${body}`);
  }
  if (detail?.errorMessage) console.log(`  error: ${detail.errorMessage}`);

  const written = await prisma.contextNote.findUnique({
    where: { note_identity: { spaceId: space.id, ownerKey: SHARED, path: 'reports/agent-smoke.md' } },
    select: { content: true, updatedAt: true },
  });
  console.log(`\nreports/agent-smoke.md: ${written ? `written ${written.updatedAt.toISOString()}\n---\n${written.content}` : 'NOT written'}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
