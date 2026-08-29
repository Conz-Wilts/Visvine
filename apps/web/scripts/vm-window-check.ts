/**
 * The window, end to end: lease a machine, open its browser, watch it, take
 * control, type, and check the frames actually change.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/vm-window-check.ts
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { mintWatchTicket, watchUrl } from '../lib/vm/watch';
import { environment } from '../lib/vm/lease';

const SPACE = process.argv.find((a) => a.startsWith('community:')) ?? 'community:blackbird-ventures';
const AGENT = 'window-check';
const ENV = environment();
const edge = process.env.AGENT_EDGE_URL!;
const secret = process.env.EDGE_SERVICE_TOKEN!;
const OUT = process.argv[2] ?? '/tmp';

async function call(path: string, body: unknown) {
  const res = await fetch(`${edge}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const policy = { version: 1, allow: ['example.com'], deny: ['localhost'], approval: [], inject: [] };
  console.log('lease:', await call('/lease', {
    environment: ENV, spaceId: SPACE, agentName: AGENT, policy, instanceType: 'standard-3',
    workspaceKey: `spaces/${ENV}/${SPACE}/workspace`, idleMinutes: 10,
  }));

  const socket = new WebSocket(watchUrl(edge, ENV, SPACE, AGENT, mintWatchTicket(ENV, SPACE, AGENT, secret)));
  const frames: string[] = [];
  const kinds: string[] = [];
  socket.addEventListener('message', (m) => {
    const e = JSON.parse(String(m.data));
    if (e.kind === 'frame') frames.push(e.payload.jpeg as string);
    else {
      kinds.push(e.kind);
      const text = e.payload?.text ?? (Array.isArray(e.payload?.cmd) ? e.payload.cmd.join(' ') : '');
      console.log(`  ← ${e.kind}${text ? ` ${String(text).trim().slice(0, 60)}` : ''}`);
    }
  });
  await new Promise<void>((r) => socket.addEventListener('open', () => r()));
  console.log('watching');

  console.log('browse:', await call('/browse', { environment: ENV, spaceId: SPACE, agentName: AGENT, url: 'https://example.com/' }));
  await wait(12_000);
  const beforeTakeover = frames.length;

  // An input before the takeover must do nothing at all.
  socket.send(JSON.stringify({ kind: 'input', event: { kind: 'type', text: 'should-be-ignored' } }));
  await wait(1_500);

  socket.send(JSON.stringify({ kind: 'takeover', by: 'the smoke test' }));
  await wait(500);
  socket.send(JSON.stringify({ kind: 'input', event: { kind: 'click', x: 640, y: 63 } }));
  await wait(600);
  socket.send(JSON.stringify({ kind: 'input', event: { kind: 'type', text: 'typed during takeover' } }));
  await wait(3_000);
  socket.send(JSON.stringify({ kind: 'release' }));
  await wait(1_000);

  console.log(`frames: ${frames.length} (${beforeTakeover} before the takeover)`);
  if (frames.length > 0) {
    writeFileSync(`${OUT}/window-first.jpg`, Buffer.from(frames[0]!, 'base64'));
    writeFileSync(`${OUT}/window-last.jpg`, Buffer.from(frames[frames.length - 1]!, 'base64'));
    console.log(`wrote ${OUT}/window-first.jpg and ${OUT}/window-last.jpg`);
  }
  console.log('events:', kinds.join(', '));
  socket.close();
  console.log('status:', await call('/status', { environment: ENV, spaceId: SPACE, agentName: AGENT }));
  await call('/stop', { environment: ENV, spaceId: SPACE, agentName: AGENT });
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
