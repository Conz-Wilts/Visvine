/**
 * The frame's boot sequence — the first thing that runs inside a Tool's iframe
 * and the only code there that a Tool author does not write.
 *
 * The frame document (built by the runtime route) declares the parent origin on
 * `window`, imports this module and calls `bootTool(() => import('./bundle'))`.
 * From there:
 *
 *   ready → init → theme + stylesheet → mount → observe height
 *
 * Nothing is rendered before the handshake lands, so a Tool never flashes
 * unstyled and never runs against a half-built bridge. Everything after the
 * handshake is wrapped: a module that fails to load, a component that throws on
 * its first render and an error thrown later all end at the same place — an
 * error card in the pane and a `visvine:error` to the host — because a Tool
 * failing must never look like Visvine failing.
 *
 * Written with `createElement` rather than JSX so this stays a `.ts` file next
 * to the client it boots; there are four elements in it.
 */
import { Component, createElement } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ToolInitMessage } from '@/lib/tools/protocol';
import { createBridgeClient } from './client';
import type { BridgeClient } from './client';
import { Banner } from './components/Banner';
import { VisvineProvider } from './hooks';
import { KIT_CSS } from './styles';

/**
 * The frame document sets `window[PARENT_ORIGIN_GLOBAL]` to the app origin it
 * was embedded by. It cannot be inferred here: the frame is sandboxed without
 * `allow-same-origin`, so `document.referrer` is the only other hint and it is
 * neither guaranteed nor trustworthy.
 */
export const PARENT_ORIGIN_GLOBAL = '__VISVINE_PARENT_ORIGIN';

/** How long the frame waits for `visvine:init` before showing an error card. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

const STYLE_ELEMENT_ID = 'vv-kit-css';

export interface BootOptions {
  /** Defaults to `window[PARENT_ORIGIN_GLOBAL]`. */
  parentOrigin?: string;
  /** Defaults to `window`. */
  win?: Window;
  /** Defaults to `#root`, created if the document does not have one. */
  mount?: HTMLElement;
}

function readParentOrigin(win: Window): string {
  const declared = (win as unknown as Record<string, unknown>)[PARENT_ORIGIN_GLOBAL];
  if (typeof declared === 'string' && declared.length > 0) return declared;
  throw new Error(`Tool frame is missing window.${PARENT_ORIGIN_GLOBAL} — it cannot talk to Visvine.`);
}

function injectStylesheet(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = KIT_CSS;
  doc.head.appendChild(style);
}

/**
 * Paint the host's theme onto `:root`. Only custom properties are applied —
 * the map is the host's, but a Tool bundle could in principle reach this and
 * an entry named `background` would let it repaint arbitrary CSS.
 */
function applyTheme(doc: Document, theme: Record<string, string>): void {
  for (const [name, value] of Object.entries(theme)) {
    if (name.startsWith('--')) doc.documentElement.style.setProperty(name, value);
  }
}

function mountPoint(doc: Document, provided?: HTMLElement): HTMLElement {
  if (provided) return provided;
  const existing = doc.getElementById('root');
  if (existing) return existing;
  const created = doc.createElement('div');
  created.id = 'root';
  doc.body.appendChild(created);
  return created;
}

function waitForInit(client: BridgeClient): Promise<ToolInitMessage> {
  let off: (() => void) | undefined;
  const settled = new Promise<ToolInitMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Visvine did not answer this Tool frame.')), HANDSHAKE_TIMEOUT_MS);
    off = client.onInit((init) => {
      clearTimeout(timer);
      resolve(init);
    });
  });
  // `off` is assigned by the time this runs even if init arrived synchronously.
  return settled.finally(() => off?.());
}

/**
 * Report the two ways a Tool can fail outside React: a synchronous throw that
 * reaches `window`, and a promise nobody caught. Both are the author's bugs and
 * both should show up in the host, not only in the frame's console.
 */
function reportUncaught(win: Window, client: BridgeClient): void {
  win.addEventListener('error', (event) => {
    client.reportError(event.message || 'Uncaught error', event.error instanceof Error ? event.error.stack : undefined);
  });
  win.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    client.reportError(
      reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
      reason instanceof Error ? reason.stack : undefined,
    );
  });
}

/**
 * Tell the host how tall the Tool is, so the iframe can be sized to its
 * content instead of scrolling inside a fixed box. Only changes are posted —
 * an unconditional post per observation would ping-pong with the host's own
 * resize.
 */
function observeHeight(win: Window, client: BridgeClient): void {
  const doc = win.document;
  let last = -1;
  const send = () => {
    const height = Math.ceil(doc.documentElement.scrollHeight);
    if (height === last) return;
    last = height;
    client.resize(height);
  };
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(send).observe(doc.documentElement);
  }
  win.addEventListener('load', send);
  send();
}

interface BoundaryProps {
  client: BridgeClient;
  children?: ReactNode;
}

interface BoundaryState {
  message: string | null;
}

class ToolErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const stack = error instanceof Error ? error.stack : undefined;
    this.props.client.reportError(
      error instanceof Error ? error.message : String(error),
      stack ?? info.componentStack ?? undefined,
    );
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return errorCard('This Tool stopped', this.state.message);
  }
}

function errorCard(title: string, message: string): ReactNode {
  return createElement(Banner, { tone: 'danger', title }, message);
}

/**
 * Boot a Tool. `loadModule` is a dynamic import of the compiled bundle, kept as
 * a thunk so a bundle that throws while evaluating fails inside the try below
 * rather than while this module is being imported.
 */
export async function bootTool(
  loadModule: () => Promise<{ default: ComponentType }>,
  options: BootOptions = {},
): Promise<void> {
  const win = options.win ?? window;
  const doc = win.document;
  const client = createBridgeClient(win, options.parentOrigin ?? readParentOrigin(win));
  reportUncaught(win, client);

  injectStylesheet(doc);
  const root = createRoot(mountPoint(doc, options.mount));

  let init: ToolInitMessage;
  try {
    const pending = waitForInit(client);
    client.ready();
    init = await pending;
  } catch (e) {
    root.render(errorCard('This Tool could not start', e instanceof Error ? e.message : String(e)));
    observeHeight(win, client);
    return;
  }

  applyTheme(doc, init.theme);
  client.onTheme((theme) => applyTheme(doc, theme));

  let Tool: ComponentType;
  try {
    Tool = (await loadModule()).default;
    if (typeof Tool !== 'function') throw new Error('The Tool must `export default` a React component.');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    client.reportError(message, e instanceof Error ? e.stack : undefined);
    root.render(errorCard('This Tool could not start', message));
    observeHeight(win, client);
    return;
  }

  root.render(
    createElement(
      ToolErrorBoundary,
      { client },
      createElement(VisvineProvider, { client, init }, createElement(Tool)),
    ),
  );
  observeHeight(win, client);
}
