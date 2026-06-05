#!/usr/bin/env node
// Stop hook: in "block" mode, refuse to finish while a visual edit is still
// unverified (no Playwright MCP tool used since). The stop_hook_active guard
// blocks at most once per pending state so the turn can't loop forever if the
// dev server is genuinely unavailable. See ./README.md.
import { clearPending, getPending, mode, readInput } from './lib/visual-verify.mjs';

const input = await readInput();
const session = input?.session_id;
const pending = getPending(session);

// Nothing pending, or enforcement isn't blocking: allow the stop.
if (pending.length === 0 || mode() !== 'block') {
  if (pending.length) clearPending(session); // tidy up in warn/off mode
  process.exit(0);
}

// Already blocked once this turn — let it through (and clear) to avoid a loop.
if (input?.stop_hook_active) {
  clearPending(session);
  process.exit(0);
}

const reason =
  `You edited visual/UI file(s) (${pending.join(', ')}) but have not verified the change ` +
  `in a browser via the Playwright MCP. Before finishing: make sure the dev server is ` +
  `running (pnpm dev -> http://localhost:3000), log in at http://localhost:3000/dev/login, ` +
  `navigate to the affected page with the playwright MCP tools, screenshot/snapshot it, and ` +
  `confirm it renders correctly. If verification is genuinely impossible right now (e.g. the ` +
  `dev server can't start), say so explicitly and stop again.`;

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
