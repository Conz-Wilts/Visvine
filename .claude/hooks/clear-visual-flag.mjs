#!/usr/bin/env node
// PostToolUse / mcp__playwright__.*: using any Playwright MCP tool counts as
// verifying the change, so clear this session's pending marker. See ./README.md.
import { clearPending, readInput } from './lib/visual-verify.mjs';

const input = await readInput();
clearPending(input?.session_id);
process.exit(0);
