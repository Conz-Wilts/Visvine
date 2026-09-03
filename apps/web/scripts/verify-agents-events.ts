/**
 * The live end-to-end run for REACTIVE agents and the bell — the counterpart to
 * the pure suites (tests/agents-events.test.ts, tests/connector-webhook.test.ts,
 * tests/agents-tick.test.ts), which can drive every part of this except the
 * whole of it. In one throw-away space, with a throw-away admin:
 *
 *   a. `on.context`  a note saved under `people/**` → ONE `agent_events` row
 *                    (a second save coalesces on the path) → `next_run_at`
 *                    pulled to now+debounce → the tick claims it → an
 *                    `agent_runs` row with `trigger: 'event'` and the payload
 *                    in `input.events`
 *   b. `on.webhook`  a `webhook:` connector + its URL token → a signed POST to
 *                    /api/hooks/… over real HTTP answers 202 (bad signature 401,
 *                    wrong token 404) → the tick claims it → `trigger: 'webhook'`
 *                    with the delivery as the payload; the admin Webhook GET
 *                    reports the same URL and the listening agent
 *   c. deactivation  a machine deactivation (`repeated_failure`) writes
 *                    `active: false` into the brief and the reason onto the row
 *
 * The runs themselves are expected to FAIL: the brief names `custom/probe` and
 * the space's custom model points at a closed local port, so the loop's
 * first model call is refused — which is exactly one failed run (no key
 * rejection, no deactivation), and everything this script asserts about the
 * run row is written at CLAIM time, before the model is ever consulted. What is
 * being proved is trigger → mailbox → claim → run row, over the real tick.
 *
 * Needs `pnpm dev` running for the HTTP steps (the hook POSTs, dev login, the
 * admin GET); everything else is in-process. It WRITES to the database (a space,
 * a user, notes, secrets, agent rows) so it is guarded to a
 * local one, and it takes all of it back out — the cleanup also runs first, so
 * a run after a failed one starts clean.
 *
 *   pnpm --filter @visvine/web verify:agents-events
 *
 * If the local `.env` still carries a `CLOUD_SQL_CONNECTION_NAME` from a
 * `pnpm dev:cloud` session, the local-DB guard refuses on sight even though
 * DATABASE_URL points at Docker. Clear it for the run: `CLOUD_SQL_CONNECTION_NAME= pnpm …`.
 *
 * Env:
 *   BASE_URL   the app origin, default http://localhost:3000
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { writeGated } from '../lib/notes/contextService';
import { principalOf, resolveContext } from '../lib/notes/resolve';
import * as store from '../lib/notes/store';
import { agentBriefPath } from '../lib/agents/config';
import { deactivateAgent } from '../lib/agents/hooks';
import { tick } from '../lib/agents/schedule';
import { encryptSecret } from '../lib/crypto/secrets';
import { provisionWebhookToken } from '../lib/connectors/webhookInbound';
import { webhookPath } from '../lib/connectors/webhook';
import { newModelNote } from '../lib/models/config';

// The tick dispatches inline (the dev default) — stated, so a shell that
// exported AGENT_DISPATCH=self for something else cannot turn the claimed runs
// into HTTP round-trips to a run endpoint this script never wants.
process.env.AGENT_DISPATCH = 'inline';

const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const SPACE = 'verify:agents-events';
const ADMIN_ID = 'verify-agents-events-admin';
const ADMIN_EMAIL = 'verify-agents-events@local.dev';

const NOTE_AGENT = 'ev-probe';
const HOOK_AGENT = 'hook-probe';
const CONNECTOR = 'probe-hook';
const HOOK_SECRET_NAME = 'PROBE_HOOK';
const HOOK_SECRET = 'verify-agents-events-hmac-secret';
const PERSON_NOTE = 'people/probe.md';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  if (ok) pass++;
  else fail++;
  return ok;
}

function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


// ── notes ─────────────────────────────────────────────────────────────────────

/** A brief, with its activation in the same frontmatter — one note is the whole agent. */
const brief = (title: string, activation: string[] = []) =>
  ['---', 'type: agent', `title: ${title}`, 'model: custom/probe', ...activation, '---', '', `Verify fixture: ${title}. Say hello and stop.`, ''].join('\n');

const NOTE_LIVE = ['active: true', 'on:', '  context:', '    - "people/**"', 'debounce: 5s'];
const HOOK_LIVE = ['active: true', 'on:', `  webhook: ${CONNECTOR}`, 'debounce: 5s'];

const CONNECTOR_NOTE = [
  '---',
  'type: connector',
  'title: Probe hook',
  'hosts: []',
  'webhook:',
  '  signature: hmac-sha256',
  `  secret: "{{secret:${HOOK_SECRET_NAME}}}"`,
  '  header: x-sig',
  '  prefix: "sha256="',
  '---',
  '',
  'A connector that only receives. Nothing to run.',
  '',
].join('\n');

const personNote = (n: number) =>
  ['---', 'title: Probe Person', 'type: person', '---', '', `Save number ${n} of the probe person.`, ''].join('\n');

// ── HTTP ──────────────────────────────────────────────────────────────────────

interface Fetched {
  status: number;
  headers: Headers;
  body: string;
}

async function http(url: string, init: RequestInit = {}): Promise<Fetched> {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function serverIsUp(): Promise<boolean> {
  try {
    await fetch(`${APP}/`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

/** The dev-login flow, over the wire: POST /api/dev/login-as/<id> sets the session cookie. */
async function devLoginCookie(userId: string): Promise<string | null> {
  const res = await http(`${APP}/api/dev/login-as/${encodeURIComponent(userId)}`, { method: 'POST' });
  if (res.status === 404) throw new Error('/api/dev/login-as is 404 — set NODE_ENV=development and ENABLE_DEV_AUTH=true');
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/auth_session=([^;]+)/);
  return m ? `auth_session=${m[1]}` : null;
}

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

// ── fixture ───────────────────────────────────────────────────────────────────

/**
 * Everything the run creates hangs off the space or the user, and every table
 * involved cascades from one of them (context notes, agent rows, events,
 * secrets, audit lines). Deleting the two is the whole cleanup —
 * so it is also safe to run BEFORE the run, against whatever a crashed one left.
 */
async function cleanup(): Promise<void> {
  await prisma.space.deleteMany({ where: { id: SPACE } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
}

async function setup() {
  await prisma.space.create({
    data: {
      id: SPACE,
      name: 'verify agents events',
      timezone: 'UTC',
    },
  });
  await prisma.user.create({ data: { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Verify Admin' } });
  await prisma.spaceMember.create({ data: { spaceId: SPACE, userId: ADMIN_ID } });
  // Admin = holding the space's owner alias (lib/auth.ts#isAdmin).
  await prisma.userAlias.create({ data: { spaceId: SPACE, userId: ADMIN_ID, aliasId: ADMIN_ALIAS_ID } });
  // The model key the resolver insists on before it will even try the endpoint.
  await prisma.connectorSecret.create({
    data: { spaceId: SPACE, name: 'MODEL_KEY_CUSTOM', ciphertext: encryptSecret('not-a-real-key'), createdBy: ADMIN_EMAIL },
  });
  // The webhook's signing secret, stored the way the secrets route stores one.
  await prisma.connectorSecret.create({
    data: { spaceId: SPACE, name: HOOK_SECRET_NAME, ciphertext: encryptSecret(HOOK_SECRET), createdBy: ADMIN_EMAIL },
  });
}

const state = (name: string) => prisma.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE, name } } });
const pendingEvents = (name: string) => prisma.agentEvent.findMany({ where: { spaceId: SPACE, agentName: name, consumedBy: null }, orderBy: { createdAt: 'asc' } });
const runsOf = (name: string) => prisma.agentRun.findMany({ where: { spaceId: SPACE, name }, orderBy: { startedAt: 'asc' } });

type RunEvents = { events?: { kind: string; source: string; summary: string; at: string }[] } | null;

/** Wait out the debounce the row is holding, then tick. */
async function tickWhenDue(name: string) {
  const row = await state(name);
  const due = row?.nextRunAt ? row.nextRunAt.getTime() - Date.now() : 0;
  if (due > 0) await sleep(due + 200);
  return tick();
}

// ── the run ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`space   ${SPACE}`);
  console.log(`admin   ${ADMIN_EMAIL} (${ADMIN_ID})`);
  console.log(`app     ${APP}`);
  if (!(await serverIsUp())) throw new Error(`${APP} is not answering — start \`pnpm dev\` first`);

  await cleanup(); // leftovers from a run that died half way
  await setup();

  try {
    const session = { userId: ADMIN_ID, name: 'Verify Admin', email: ADMIN_EMAIL, personId: null };
    const resolved = await resolveContext(session, SPACE);
    if (resolved instanceof Response) throw new Error(`resolveContext: ${resolved.status}`);
    if (!resolved.isAdmin) throw new Error('the fixture admin does not resolve as an admin');
    const principal = await principalOf(resolved);
    const context: store.Context = { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY };
    const write = async (path: string, content: string) => {
      const r = await writeGated(principal, context, path, content);
      if (r.status === 'denied') throw new Error(`write ${path} denied: ${r.reason}`);
    };

    // The `custom/…` model resolves against the space's custom model note.
    // A closed local port: the run's first model call is refused and the run
    // fails, which is the outcome this script wants (see the header). http and
    // a loopback host are only accepted because NODE_ENV is development.
    await write(
      'models/probe-model.md',
      newModelNote({ name: 'probe-model', provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1/' }),
    );

    // ── a. on.context ────────────────────────────────────────────────────────
    step('a1. the brief derives an active, event-only state row');
    await write(agentBriefPath(NOTE_AGENT), brief('Event probe', NOTE_LIVE));
    const derived = await state(NOTE_AGENT);
    check(
      'agents/ev-probe/index.md → active row, no clock, triggers + debounce recorded',
      derived?.active === true &&
        derived.nextRunAt === null &&
        derived.debounceMs === 5_000 &&
        JSON.stringify(derived.triggersJson) === JSON.stringify({ context: ['people/**'], webhook: null }),
      derived
        ? `active=${derived.active} next_run_at=${derived.nextRunAt?.toISOString() ?? 'null'} debounce=${derived.debounceMs} triggers=${JSON.stringify(derived.triggersJson)}`
        : 'no agent_state row',
    );

    step('a2. two quick saves under people/** → one pending event, next_run_at pulled forward');
    const before = Date.now();
    await write(PERSON_NOTE, personNote(1));
    await write(PERSON_NOTE, personNote(2));
    const pending = await pendingEvents(NOTE_AGENT);
    const pulled = await state(NOTE_AGENT);
    const soon = pulled?.nextRunAt ? pulled.nextRunAt.getTime() - before : null;
    check(
      'exactly one agent_events row (deduped on the note path), kind note_written, source = the path',
      pending.length === 1 && pending[0].kind === 'note_written' && pending[0].source === PERSON_NOTE,
      `${pending.length} pending: ${pending.map((e) => `${e.kind} ${e.source} "${e.summary}"`).join(' | ') || 'none'}`,
    );
    check(
      'next_run_at moved to roughly now + debounce (5s)',
      soon !== null && soon > 0 && soon <= 5_000 + 2_000,
      soon === null ? 'next_run_at is null' : `in ${soon}ms`,
    );

    step('a3. the tick claims the event → agent_runs row trigger=event with input.events');
    const report1 = await tickWhenDue(NOTE_AGENT);
    const runs1 = await runsOf(NOTE_AGENT);
    const run1 = runs1[0];
    const input1 = (run1?.input as RunEvents) ?? null;
    check(
      'one run claimed for ev-probe, trigger event, event_count 1, input.events[0].source = the note path',
      report1.claimed.length === 1 &&
        runs1.length === 1 &&
        run1.trigger === 'event' &&
        run1.eventCount === 1 &&
        input1?.events?.[0]?.kind === 'note_written' &&
        input1.events[0].source === PERSON_NOTE,
      run1
        ? `run ${run1.id} trigger=${run1.trigger} events=${run1.eventCount} status=${run1.status} input=${JSON.stringify(input1).slice(0, 160)}`
        : `tick claimed [${report1.claimed.join(', ')}], no run row`,
    );
    const consumed = await prisma.agentEvent.count({ where: { spaceId: SPACE, agentName: NOTE_AGENT, consumedBy: run1?.id ?? '-' } });
    const after1 = await state(NOTE_AGENT);
    check(
      'the event is stamped consumed_by the run; the row is idle again, still active, no clock',
      consumed === 1 && after1?.status === 'idle' && after1.active === true && after1.nextRunAt === null,
      `consumed=${consumed} status=${after1?.status} active=${after1?.active} next_run_at=${after1?.nextRunAt?.toISOString() ?? 'null'} failures=${after1?.consecutiveFailures}`,
    );
    // The run itself was dispatched inline and failed at the model (see the
    // header) — reported, not asserted, since it is not what this proves.
    console.log(`        (dispatch: ${JSON.stringify(report1.dispatched[0]?.result ?? null).slice(0, 200)})`);

    // ── b. on.webhook ────────────────────────────────────────────────────────
    step('b1. a webhook: connector, its URL token, and a listening agent');
    await write(`connectors/${CONNECTOR}.md`, CONNECTOR_NOTE);
    const token = await provisionWebhookToken(SPACE, CONNECTOR, ADMIN_EMAIL);
    await write(agentBriefPath(HOOK_AGENT), brief('Hook probe', HOOK_LIVE));
    const hookState = await state(HOOK_AGENT);
    check(
      'agents/hook-probe/index.md → active row listening on the connector',
      hookState?.active === true && JSON.stringify(hookState.triggersJson) === JSON.stringify({ context: [], webhook: CONNECTOR }),
      hookState ? `active=${hookState.active} triggers=${JSON.stringify(hookState.triggersJson)}` : 'no agent_state row',
    );

    step('b2. POST to /api/hooks over HTTP: signed 202, bad signature 401, wrong token 404');
    const hookUrl = `${APP}${webhookPath(SPACE, CONNECTOR, token)}`;
    const body = JSON.stringify({ event: 'probe.fired', id: 'evt_1', note: 'verify-agents-events' });
    const headers = { 'content-type': 'application/json' };
    const good = await http(hookUrl, { method: 'POST', headers: { ...headers, 'x-sig': sign(body, HOOK_SECRET) }, body });
    check('a correctly signed delivery is accepted by exactly one agent', good.status === 202 && good.body === '{"accepted":1}', `${good.status} ${good.body}`);
    const bad = await http(hookUrl, { method: 'POST', headers: { ...headers, 'x-sig': sign(body, 'wrong-secret') }, body });
    check('a delivery signed with the wrong secret is refused (401)', bad.status === 401, `${bad.status} ${bad.body}`);
    const wrongToken = await http(`${APP}${webhookPath(SPACE, CONNECTOR, 'ab'.repeat(32))}`, {
      method: 'POST',
      headers: { ...headers, 'x-sig': sign(body, HOOK_SECRET) },
      body,
    });
    check('a well-formed but wrong URL token is 404 (indistinguishable from no hook)', wrongToken.status === 404, `${wrongToken.status} ${wrongToken.body}`);
    const hookPending = await pendingEvents(HOOK_AGENT);
    check(
      'exactly one webhook event is waiting for hook-probe (the 401 and 404 enqueued nothing)',
      hookPending.length === 1 && hookPending[0].kind === 'webhook' && hookPending[0].source === CONNECTOR,
      `${hookPending.length} pending: ${hookPending.map((e) => `${e.kind} ${e.source} "${e.summary}"`).join(' | ') || 'none'}`,
    );

    step('b3. the admin Webhook GET reports the same address and the listener');
    const cookie = await devLoginCookie(ADMIN_ID);
    check('POST /api/dev/login-as sets the session cookie', cookie !== null, cookie ? `${cookie.slice(0, 40)}…` : 'no auth_session cookie');
    const described = await http(`${APP}/api/communities/${encodeURIComponent(SPACE)}/connectors/${CONNECTOR}/webhook`, {
      headers: { cookie: cookie ?? '' },
    });
    let describedJson: { url?: string; signature?: string; header?: string; hasSignatureSecret?: boolean; recipients?: string[] } = {};
    try {
      describedJson = JSON.parse(described.body);
    } catch {
      /* asserted below */
    }
    check(
      'GET …/connectors/probe-hook/webhook: 200 with the provisioned URL, hmac-sha256/x-sig, secret stored, recipients [hook-probe]',
      described.status === 200 &&
        describedJson.url === hookUrl &&
        describedJson.signature === 'hmac-sha256' &&
        describedJson.header === 'x-sig' &&
        describedJson.hasSignatureSecret === true &&
        JSON.stringify(describedJson.recipients) === JSON.stringify([HOOK_AGENT]),
      `${described.status} ${described.body.slice(0, 300)}`,
    );

    step('b4. the tick claims the delivery → agent_runs row trigger=webhook with the payload');
    const report2 = await tickWhenDue(HOOK_AGENT);
    const runs2 = await runsOf(HOOK_AGENT);
    const run2 = runs2[0];
    const input2 = (run2?.input as RunEvents) ?? null;
    const consumed2 = run2 ? await prisma.agentEvent.findFirst({ where: { consumedBy: run2.id } }) : null;
    const payload = (consumed2?.payload ?? null) as { connector?: string; body?: { event?: string } } | null;
    check(
      'one run for hook-probe, trigger webhook, event_count 1, input.events[0].source = the connector, payload carries the body',
      report2.claimed.length === 1 &&
        runs2.length === 1 &&
        run2.trigger === 'webhook' &&
        run2.eventCount === 1 &&
        input2?.events?.[0]?.kind === 'webhook' &&
        input2.events[0].source === CONNECTOR &&
        payload?.connector === CONNECTOR &&
        payload.body?.event === 'probe.fired',
      run2
        ? `run ${run2.id} trigger=${run2.trigger} events=${run2.eventCount} status=${run2.status} input=${JSON.stringify(input2).slice(0, 120)} payload.body=${JSON.stringify(payload?.body).slice(0, 100)}`
        : `tick claimed [${report2.claimed.join(', ')}], no run row`,
    );

    // ── c. deactivation ──────────────────────────────────────────────────────
    step('c1. a machine deactivation switches the agent off in the brief and on the row');
    const activeBefore = (await state(NOTE_AGENT))?.active;
    await deactivateAgent(SPACE, NOTE_AGENT, 'repeated_failure', 'verify-agents-events: forced');
    const liveAfter = await store.readNoteOrNull(context, agentBriefPath(NOTE_AGENT));
    const stateAfter = await state(NOTE_AGENT);
    check(
      'deactivateAgent(repeated_failure): the brief reads active:false, the row is inactive with the reason',
      activeBefore === true &&
        /active:\s*false/.test(liveAfter ?? '') &&
        stateAfter?.active === false &&
        stateAfter.deactivatedReason === 'repeated_failure',
      `brief active=${/active:\s*false/.test(liveAfter ?? '') ? 'false' : 'not false'} · row active=${stateAfter?.active} reason=${stateAfter?.deactivatedReason}`,
    );
  } finally {
    step('cleanup');
    await cleanup();
    const [spaces, users, notes, states, events, runs, secrets] = await Promise.all([
      prisma.space.count({ where: { id: SPACE } }),
      prisma.user.count({ where: { id: ADMIN_ID } }),
      prisma.contextNote.count({ where: { spaceId: SPACE } }),
      prisma.agentState.count({ where: { spaceId: SPACE } }),
      prisma.agentEvent.count({ where: { spaceId: SPACE } }),
      prisma.agentRun.count({ where: { spaceId: SPACE } }),
      prisma.connectorSecret.count({ where: { spaceId: SPACE } }),
    ]);
    const left = spaces + users + notes + states + events + runs + secrets;
    check(
      'cleanup leaves nothing behind (space, user and everything hanging off them)',
      left === 0,
      `space=${spaces} user=${users} notes=${notes} agent_state=${states} events=${events} runs=${runs} secrets=${secrets}`,
    );
  }
}

main()
  .then(async () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(`\nFAIL  ${e instanceof Error ? e.message : String(e)}`);
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
