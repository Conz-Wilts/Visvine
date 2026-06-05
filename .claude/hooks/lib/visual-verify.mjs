// Shared helpers for the visual-verification hooks.
// See .claude/hooks/README.md for the full picture.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files whose edits should be confirmed in a browser. */
export const VISUAL_RE = /\.(tsx|jsx|css|scss)$/i;

/** Repo root: this file lives at <root>/.claude/hooks/lib/, so go up three. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Enforcement mode, from the VISUAL_VERIFY_MODE env var (default "block"):
 *   block — Stop hook blocks finishing until Playwright MCP is used (default)
 *   warn  — only the post-edit reminder fires; finishing is never blocked
 *   off   — hooks do nothing
 */
export function mode() {
  const m = String(process.env.VISUAL_VERIFY_MODE || 'block').toLowerCase();
  return ['block', 'warn', 'off'].includes(m) ? m : 'block';
}

/** Read all of stdin; resolves to '' on error so a hook never hard-fails. */
export function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    process.stdin.on('error', () => res(''));
  });
}

/** Parse the hook's stdin JSON payload; {} on malformed input. */
export async function readInput() {
  try {
    return JSON.parse((await readStdin()) || '{}');
  } catch {
    return {};
  }
}

function sanitize(session) {
  return String(session || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
}

function markerPath(session) {
  return join(REPO_ROOT, '.claude', '.cache', `visual-pending-${sanitize(session)}`);
}

/** Record that a visual file edit is awaiting verification for this session. */
export function addPending(session, file) {
  const marker = markerPath(session);
  mkdirSync(dirname(marker), { recursive: true });
  let files = [];
  try {
    if (existsSync(marker)) files = JSON.parse(readFileSync(marker, 'utf8'));
  } catch {}
  if (!files.includes(file)) files.push(file);
  writeFileSync(marker, JSON.stringify(files));
}

/** The list of files awaiting verification (empty if none). */
export function getPending(session) {
  const marker = markerPath(session);
  if (!existsSync(marker)) return [];
  try {
    return JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    return [];
  }
}

/** Clear this session's pending marker (verification done / mode allows stop). */
export function clearPending(session) {
  rmSync(markerPath(session), { force: true });
}
