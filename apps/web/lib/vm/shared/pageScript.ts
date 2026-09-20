/**
 * The page, as a table: what an agent's machine runs to read its browser and
 * to act in it. Pure — a script and the shapes it speaks.
 *
 * One command does both halves of a step. It attaches to the machine's own
 * browser over CDP, performs the action it was handed (if any), lets the page
 * settle, and answers with the page as DATA: the visible text and one row per
 * control a person could use right now, each with a node id. So a step is one
 * round trip to the machine, never "act" then "look".
 *
 * A node id is minted by the page reader and kept in the page
 * (`window.__vvPage`), so it names the actual element that was observed, not a
 * selector somebody wrote — nothing a model says is ever evaluated as code.
 * Every action carries the `guard` its snapshot gave for that node: a hash of
 * the element's own state and the text around it. If that no longer matches,
 * or the element is covered, hidden or disabled, nothing is clicked and the
 * answer is `stale` beside the page as it is NOW. A decision made about one
 * page is never executed on another.
 *
 * Password, file and hidden inputs are never listed and never filled: a
 * credential reaches a page through `sign_in` (lib/vm/signin.ts) and no other
 * way. Shadow roots, iframes and canvas are not read; a page built from them
 * is driven with a script over CDP instead.
 *
 * The reading pattern — an indexed table of controls instead of a screenshot,
 * identity-preserving node ids, a guard checked immediately before input — is
 * browser-use's jev-ultrafast (MIT).
 */

/** A control's kind decides what may be done to it. */
type PageActionKind = 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'enter'

/** One thing that can be done on the page as observed. */
export interface PageAction {
  /** `e12` for an element, or `scroll_down` / `scroll_up` / `wait` / `enter`. */
  id: string
  kind: PageActionKind
  label: string
  /** The observed element. Absent on the page-level controls. */
  node?: number
  role?: string
  /** A field's current text, or the option's value on a `select`. */
  value?: string
  /** What a dropdown shows now (on `select` rows). */
  current_value?: string
  checked?: string
  selected?: string
  expanded?: string
  delta?: number
}

export interface PageState {
  url: string
  title: string
  /** The text visible in the viewport, capped. */
  text: string
  scroll: { y: number; height: number }
  actions: PageAction[]
  /** node id → the guard an action on it must present. */
  guards: Record<string, string>
  /** Changes when the page's meaning does; geometry and animation do not count. */
  fingerprint: string
  /** Controls past the cap that were not listed. */
  omitted: number
}

export interface PageCommand {
  /**
   * Set on every command of a browse_task loop. The command line is what the
   * machine's timeline records, so this is how a run's page tells a loop's
   * many commands (one step) from a single page_act (a step each).
   */
  task?: boolean
  act?: {
    kind: PageActionKind
    node?: number
    /** The guard the snapshot gave for `node`. */
    guard?: string
    /** `select`: the option's value. */
    value?: string
    /** `fill`: what to type, replacing what is there. */
    text?: string
    delta?: number
  }
}

export type PageResult =
  | { ok: true; acted: boolean; state: PageState }
  /** The page moved on before the action could be made; `state` is the page now. */
  | { ok: false; reason: 'stale'; state: PageState }
  | { ok: false; reason: 'no_page' | 'unreadable' | 'failed'; message: string }

/** Controls listed per snapshot; the rest are counted in `omitted`. */
const PAGE_ACTION_CAP = 150
const PAGE_TEXT_CAP = 6_000

/** Runs IN the page. Returns the state, or null while the document is navigating. */
const READ_PAGE = `
(() => {
  if (!document.body) return null;
  const cache = window.__vvPage ||= { ids: new WeakMap(), nodes: new Map(), next: 1 };
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e); cache.nodes.set(id, e); return id;
  };
  for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const safe = e => !['password', 'file', 'hidden'].includes(e.type);
  const visible = e => !e.closest('[aria-hidden="true"],[inert]') && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const name = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => name(document.getElementById(id), seen)).filter(Boolean).join(' ');
    return referenced || e.getAttribute('aria-label') ||
      [...(e.labels || [])].map(l => name(l, seen)).filter(Boolean).join(' ') ||
      (['button', 'submit', 'reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName === 'INPUT' ? '' : [...e.childNodes].map(n => n.nodeType === 3 ? n.textContent :
        n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' ? name(n, seen) : '').join(' ').replace(/\\s+/g, ' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const roles = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemradio', 'option', 'gridcell', 'combobox', 'textbox', 'searchbox', 'spinbutton'];
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' + roles.map(r => '[role="' + r + '"]').join(',');
  const role = e => {
    const explicit = e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
    if (e.tagName === 'A') return 'link';
    if (e.tagName === 'SELECT') return 'combobox';
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName === 'INPUT') {
      if (['checkbox', 'radio'].includes(e.type)) return e.type;
      if (['button', 'submit', 'reset', 'image'].includes(e.type)) return 'button';
      if (e.type === 'search') return 'searchbox';
      if (e.type === 'number') return 'spinbutton';
      if (['text', 'email', 'url', 'tel', 'date', 'time', 'datetime-local', 'month', 'week'].includes(e.type)) return 'textbox';
    }
    return null;
  };
  cache.guard = e => {
    if (!e?.isConnected || !visible(e)) return null;
    const scope = e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return hash(JSON.stringify([location.href, identity(e), role(e), name(e), e.value ?? null, e.checked ?? null, e.selectedIndex ?? null,
      e.readOnly ?? null, e.matches(':disabled'), e.getAttribute('aria-disabled'), e.getAttribute('aria-expanded'),
      e.getAttribute('aria-checked'), e.getAttribute('aria-selected'), e.getAttribute('href'), scope?.innerText?.slice(0, 4000) || '']));
  };
  const actions = [];
  for (const e of document.querySelectorAll(selector)) {
    if (!safe(e) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, rname = role(e);
    if (!rname || r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    if (rname === 'gridcell' && e.querySelector('button,[role="button"]')) continue;
    const base = { node: identity(e), role: rname, label: (name(e) || rname).slice(0, 160) };
    for (const key of ['checked', 'selected', 'expanded']) {
      const value = e.getAttribute('aria-' + key);
      if (value !== null) base[key] = value;
    }
    if (['checkbox', 'radio'].includes(e.type)) base.checked = String(e.checked);
    if (e.tagName === 'SELECT') {
      const current = [...e.selectedOptions].map(o => o.label).join(', ');
      for (const o of [...e.options].slice(0, 40)) if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]'))
        actions.push({ ...base, kind: 'select', value: o.value, current_value: current, label: base.label + ' → ' + o.label });
    } else {
      const editable = !e.readOnly && e.getAttribute('aria-readonly') !== 'true' &&
        (['textbox', 'searchbox', 'spinbutton'].includes(rname) || (rname === 'combobox' && ['INPUT', 'TEXTAREA'].includes(e.tagName)));
      const value = ('value' in e ? String(e.value) : e.isContentEditable || rname === 'combobox' ? e.innerText.trim() : '').slice(0, 200);
      actions.push({ ...base, kind: editable ? 'fill' : 'click', value });
    }
  }
  const words = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), range = document.createRange();
  let node, length = 0;
  while ((node = walker.nextNode()) && length < ${PAGE_TEXT_CAP}) {
    const value = node.textContent.trim(), parent = node.parentElement;
    if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue;
    range.selectNodeContents(node); const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) { words.push(value); length += value.length; }
  }
  const text = words.join('\\n').slice(0, ${PAGE_TEXT_CAP}), height = document.documentElement.scrollHeight;
  const omitted = Math.max(0, actions.length - ${PAGE_ACTION_CAP});
  actions.splice(${PAGE_ACTION_CAP});
  const fingerprint = hash(JSON.stringify([location.href, document.title, Math.round(scrollY), text, actions]));
  const guards = {};
  for (const a of actions) if (!(a.node in guards)) guards[a.node] = cache.guard(cache.nodes.get(a.node));
  actions.forEach((a, i) => { a.id = 'e' + (i + 1); });
  const focused = document.activeElement;
  if (focused && focused !== document.body && safe(focused) && ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role(focused)))
    actions.push({ id: 'enter', kind: 'enter', label: 'Press Enter in the focused field (' + (name(focused) || role(focused)).slice(0, 80) + ')' });
  if (scrollY + innerHeight < height - 2) actions.push({ id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 });
  if (scrollY > 0) actions.push({ id: 'scroll_up', kind: 'scroll', label: 'Scroll up', delta: -560 });
  actions.push({ id: 'wait', kind: 'wait', label: 'Wait for the page to update' });
  return { url: location.href, title: document.title, text, scroll: { y: Math.round(scrollY), height }, actions, guards, fingerprint, omitted };
})()
`.trim()

/** Runs IN the page, immediately before input. `{x,y}` to press, `'done'` for a select, or null when the target is no longer the one observed. */
const RESOLVE_TARGET = `
(action => {
  const c = window.__vvPage, e = c?.nodes.get(action.node);
  if (!e?.isConnected || ['password', 'file', 'hidden'].includes(e.type)) return null;
  if (c.guard(e) !== action.guard) return null;
  if (e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return null;
  if (action.kind === 'fill' && (e.readOnly || e.getAttribute('aria-readonly') === 'true')) return null;
  const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  if (!e.contains(hit) && !(hit && [...(e.labels || [])].some(l => l.contains(hit)))) return null;
  if (action.kind === 'select') {
    if (e.tagName !== 'SELECT' || ![...e.options].some(o => o.value === action.value && !o.disabled && !o.closest('optgroup[disabled]'))) return null;
    e.value = action.value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return 'done';
  }
  return { x, y };
})
`.trim()

/** Runs IN the page after an action: two frames, and a little longer for a field whose suggestions are still arriving. */
const SETTLE = `
(action => new Promise(resolve => {
  const field = window.__vvPage?.nodes.get(action.node);
  const autocomplete = action.kind === 'fill' && field?.getAttribute('role') === 'combobox';
  let frames = 0, stopped = false;
  const finish = () => { stopped = true; resolve(true); };
  setTimeout(finish, autocomplete ? 600 : 150);
  const ready = () => {
    if (stopped) return;
    const ids = (field?.getAttribute('aria-controls') || field?.getAttribute('aria-owns') || '').split(/\\s+/).filter(Boolean);
    const roots = ids.length ? ids.map(id => document.getElementById(id)).filter(Boolean) : [document];
    const options = roots.flatMap(root => [...root.querySelectorAll('[role="option"]')]);
    if (++frames >= 2 && (!autocomplete || options.some(e => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })))) finish();
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
}))
`.trim()

/**
 * What the machine runs. The page is the tab in front — the one open_page
 * steered, or the one a link just opened. The last line it prints is the
 * PageResult.
 */
export const PAGE_SCRIPT = `
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs'
const READ = ${JSON.stringify(READ_PAGE)}
const RESOLVE = ${JSON.stringify(RESOLVE_TARGET)}
const SETTLE = ${JSON.stringify(SETTLE)}
const say = (o) => { console.log(JSON.stringify(o)); process.exit(0) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let browser
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 }) }
catch { say({ ok: false, reason: 'no_page', message: 'No browser is open on this machine yet. open_page a URL first.' }) }
const context = browser.contexts()[0]
const pages = () => (context ? context.pages() : [])
const current = async () => {
  for (const p of [...pages()].reverse()) { try { if ((await p.evaluate('document.visibilityState')) === 'visible') return p } catch {} }
  return pages()[pages().length - 1]
}
if (!pages().length) say({ ok: false, reason: 'no_page', message: 'No page is open on this machine yet. open_page a URL first.' })
const read = async () => {
  for (let i = 0; i < 25; i++) {
    try { const state = await (await current()).evaluate(READ); if (state) return state } catch {}
    await sleep(120)
  }
  return null
}
const cmd = JSON.parse(process.argv[2] || '{}')
let acted = false
if (cmd.act) {
  const a = cmd.act, page = await current()
  try {
    if (a.kind === 'wait') { await sleep(700); acted = true }
    else if (a.kind === 'scroll') { await page.mouse.move(560, 400); await page.mouse.wheel(0, Number(a.delta) || 560); acted = true }
    else if (a.kind === 'enter') { await page.keyboard.press('Enter'); acted = true }
    else {
      const target = Number.isInteger(a.node) ? await page.evaluate('(' + RESOLVE + ')(' + JSON.stringify(a) + ')') : null
      if (target === null) { const state = await read(); say(state ? { ok: false, reason: 'stale', state } : { ok: false, reason: 'unreadable', message: 'The page did not settle.' }) }
      if (target !== 'done') {
        await page.mouse.click(target.x, target.y)
        if (a.kind === 'fill') { await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(String(a.text ?? '')) }
      }
      acted = true
    }
    await sleep(60)
    const after = await current()
    await after.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => null)
    await after.evaluate('(' + SETTLE + ')(' + JSON.stringify(a) + ')').catch(() => null)
  } catch (err) {
    say({ ok: false, reason: 'failed', message: String(err && err.message || err).slice(0, 300) })
  }
}
const state = await read()
say(state ? { ok: true, acted, state } : { ok: false, reason: 'unreadable', message: 'The page did not settle.' })
`.trim()

/**
 * Where the script lives on the machine. The timeline records the command line
 * of every exec, and nine kilobytes of the same script forty times a task is a
 * timeline nobody can read — so it is a file, written once per wake (/tmp is
 * fresh on every boot) and named by its content, so a deployment with a newer
 * script installs its own beside the old. It is the agent's own machine: a run
 * that rewrote this file would be lying to nobody but itself.
 */
const scriptHash = (text: string): string => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
const PAGE_SCRIPT_PATH = `/tmp/vv-page-${scriptHash(PAGE_SCRIPT)}.mjs`

export const pageCommandLine = (command: PageCommand): string[] => ['node', PAGE_SCRIPT_PATH, JSON.stringify(command)]
export const PAGE_INSTALL_LINE: string[] = [
  'node',
  '-e',
  "require('node:fs').writeFileSync(process.argv[1], process.argv[2])",
  PAGE_SCRIPT_PATH,
  PAGE_SCRIPT,
]
/** Did the command fail because the script is not on this machine yet? */
export const pageScriptMissing = (exitCode: number, stderr: string): boolean =>
  exitCode !== 0 && stderr.includes('MODULE_NOT_FOUND') && stderr.includes(PAGE_SCRIPT_PATH)

/** Is this recorded command line the script being written to the machine? */
export function isPageInstall(cmd: unknown): boolean {
  return Array.isArray(cmd) && cmd[1] === '-e' && typeof cmd[3] === 'string' && cmd[3].startsWith('/tmp/vv-page-')
}

/** Is this recorded command line one command of a browse_task loop? */
export function isTaskPageCommand(cmd: unknown): boolean {
  return Array.isArray(cmd) && typeof cmd[1] === 'string' && cmd[1].startsWith('/tmp/vv-page-') && typeof cmd[2] === 'string' && cmd[2].includes('"task":true')
}
