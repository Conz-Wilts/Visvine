#!/usr/bin/env node
// PostToolUse / Write|Edit: if a visual file was edited, record it and remind
// the model to verify in a browser via the Playwright MCP. See ./README.md.
import { VISUAL_RE, addPending, mode, readInput } from './lib/visual-verify.mjs';

if (mode() === 'off') process.exit(0);

const input = await readInput();
const file = input?.tool_input?.file_path || input?.tool_response?.filePath || '';
if (!VISUAL_RE.test(file)) process.exit(0); // not a visual file: stay silent

addPending(input?.session_id, file);

const tail =
  mode() === 'block'
    ? 'Using any Playwright MCP tool clears this requirement; otherwise the Stop hook will block finishing.'
    : 'This is a reminder only (VISUAL_VERIFY_MODE=warn) — finishing will not be blocked.';

const context =
  `Visual/UI file edited (${file}). Before ending this turn, verify the change in a ` +
  `real browser using the Playwright MCP (server "playwright"): ensure the dev server ` +
  `is up (pnpm dev -> http://localhost:3000), log in via http://localhost:3000/dev/login, ` +
  `navigate to the affected page, take a screenshot/snapshot, and confirm it renders as ` +
  `intended. ${tail}`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  })
);
process.exit(0);
