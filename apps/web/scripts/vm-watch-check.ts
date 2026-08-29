/** Opens the machine's window the way the browser does, and prints what arrives. */
import 'dotenv/config';
import { mintWatchTicket, watchUrl } from '../lib/vm/watch';

const SPACE = 'community:blackbird-ventures';
const AGENT = 'window-check';
const edge = process.env.AGENT_EDGE_URL!;
const secret = process.env.EDGE_SERVICE_TOKEN!;

async function edgeCall(path: string, body: unknown) {
  const res = await fetch(`${edge}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const policy = { version: 1, allow: ['api.github.com'], deny: ['localhost'], approval: [], inject: [] };
  console.log('lease:', await edgeCall('/lease', {
    spaceId: SPACE, agentName: AGENT, policy, instanceType: 'standard-3',
    workspaceKey: 'spaces/window-check/workspace', idleMinutes: 10,
  }));

  const ticket = mintWatchTicket(SPACE, AGENT, secret);
  const socket = new WebSocket(watchUrl(edge, SPACE, AGENT, ticket));
  const seen: string[] = [];
  socket.addEventListener('message', (m) => {
    const e = JSON.parse(String(m.data));
    seen.push(e.kind);
    const text = e.payload?.text ?? (Array.isArray(e.payload?.cmd) ? e.payload.cmd.join(' ') : '');
    console.log(`  ← ${e.kind}${text ? ` ${String(text).trim().slice(0, 60)}` : ''}`);
  });
  socket.addEventListener('error', (e) => console.log('socket error', String((e as ErrorEvent).message ?? e)));
  socket.addEventListener('close', (e) => console.log('socket closed', (e as CloseEvent).code, (e as CloseEvent).reason));
  const opened = await Promise.race([
    new Promise<boolean>((r) => socket.addEventListener('open', () => r(true))),
    new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
  ]);
  console.log('socket open:', opened);
  if (!opened) {
    const probe = await fetch(watchUrl(edge, SPACE, AGENT, ticket).replace('wss:', 'https:'), { headers: { upgrade: 'websocket' } });
    console.log('probe:', probe.status, (await probe.text()).slice(0, 200));
    return;
  }

  await edgeCall('/exec', { spaceId: SPACE, agentName: AGENT, cmd: ['sh', '-c', 'echo hello-from-the-window; echo to-stderr >&2'], timeoutSeconds: 25 });
  await new Promise((r) => setTimeout(r, 1500));

  // A real ticket for a DIFFERENT machine must not open this one.
  const wrong = mintWatchTicket(SPACE, 'a-different-agent', secret);
  const refusedSocket = new WebSocket(watchUrl(edge, SPACE, AGENT, wrong));
  const refusedOpened = await Promise.race([
    new Promise<boolean>((r) => refusedSocket.addEventListener('open', () => r(true))),
    new Promise<boolean>((r) => refusedSocket.addEventListener('close', () => r(false))),
    new Promise<boolean>((r) => setTimeout(() => r(true), 8000)),
  ]);
  console.log(`wrong-machine ticket opened a socket: ${refusedOpened}`);
  refusedSocket.close();

  socket.close();
  console.log('kinds seen:', seen.join(', '));
  await edgeCall('/stop', { spaceId: SPACE, agentName: AGENT });
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
