/**
 * The host half of the Tool bridge: the only thing in the Visvine page that
 * talks to a Tool's iframe.
 *
 * The frame is third-party code on a cookie-less origin. It has no session, no
 * network (`connect-src 'none'`) and no way to name its own install — so every
 * capability it has arrives through this file, which relays each `visvine:call`
 * to `POST /api/tools/bridge` with the viewer's own cookie and the target THIS
 * PAGE chose. A Tool cannot rewrite that target, so it cannot ask for another
 * install's data.
 *
 * Trust in, on every message, before a single field is read:
 *   • `event.source === iframe.contentWindow` — the message came from the window
 *     we created, not from a popup, another frame, or the opener;
 *   • `event.origin === frameOrigin` — see `SANDBOXED_FRAME_ORIGIN` below;
 *   • `isFrameMessage(data)` — the structure is one of the five shapes.
 *
 * Trust out: nothing here decides anything. Perimeter, viewer grants and caps
 * are the server's, and this module never throws a relay failure at the caller —
 * a failed call becomes a `visvine:result` the Tool can render, because a Tool
 * whose fetch hangs must not be able to take the page down with it.
 */
import { FetchJsonError, fetchJsonBody } from '@/lib/fetchJson'
import {
  PROTOCOL_VERSION,
  isFrameMessage,
  isHostMethod,
  isInAppPath,
  type BridgeError,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeTarget,
  type HostMessage,
  type HostMethod,
  type ToolDegraded,
  type ToolInstallInfo,
  type ToolSubject,
  type ToolViewer,
} from '@/lib/tools/protocol'

/** Where the host relays a frame's calls. Same-origin, so the cookie rides. */
const BRIDGE_ENDPOINT = '/api/tools/bridge'

/**
 * What a Tool frame reports as `event.origin`.
 *
 * The iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so its
 * origin is opaque and serializes as the literal string "null" — the tools
 * origin we loaded it from is never what arrives, whatever `TOOLS_ORIGIN` says.
 * That is the isolation working, not a bug, and it is why the `event.source`
 * identity check above is the one that actually names the sender.
 *
 * The same fact runs the other way: an opaque origin matches no serialized
 * origin, so `'*'` is the only `targetOrigin` that can reach the frame at all
 * (see `postTarget`). It is not a broadcast — the message is delivered to the
 * one window handle we hold and to nothing else.
 */
export const SANDBOXED_FRAME_ORIGIN = 'null'

/** Never squeeze a Tool below this, however small it says it is. */
export const MIN_FRAME_HEIGHT = 320

// ── the shapes this module needs, so it can be tested against fakes ──

interface FrameWindowLike {
  postMessage(message: unknown, targetOrigin: string): void
}

interface IframeLike {
  readonly contentWindow: FrameWindowLike | null
}

export interface FrameMessageEvent {
  data: unknown
  origin: string
  source: unknown
}

interface HostWindowLike {
  addEventListener(type: 'message', listener: (event: FrameMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: FrameMessageEvent) => void): void
}

/**
 * The handshake payload, minus the two fields the protocol fixes. Supplied as a
 * getter so it is built when the frame says `visvine:ready` — which is after
 * paint, and therefore after ThemeContext has written its variables.
 */
export interface HostInit {
  theme: Record<string, string>
  subject: ToolSubject | null
  install: ToolInstallInfo
  degraded: ToolDegraded | null
  viewer: ToolViewer
  /** The active section when the page draws the Tool's own sections. */
  section?: string | null
}

/**
 * What `POST /api/tools/frame-token` answers.
 *
 * The mint is one authenticated round trip and it returns everything the
 * handshake needs, not just the token: `install`, `degraded` and `viewer` are
 * all server-derived facts about THIS viewer and THIS install, and
 * `viewer.isAdmin` in particular must never be something the page decided for
 * itself. The host adds only the theme, which is the one part it alone can see.
 */
export interface FrameTokenResponse {
  token: string
  frameUrl: string
  install: ToolInstallInfo
  degraded: ToolDegraded | null
  viewer: ToolViewer
  /** The host services this Tool declared — `ui.download` asks before it saves, and only when declared. */
  ui?: { download: boolean }
}

export interface HostBridgeOptions {
  iframe: IframeLike
  /** The window whose `message` events carry the frame's posts. */
  hostWindow: HostWindowLike
  /** The origin the frame's messages must report — `SANDBOXED_FRAME_ORIGIN`. */
  frameOrigin: string
  /** Which Tool this frame is. Chosen by the page; the frame never sees it. */
  target: BridgeTarget
  init: () => HostInit
  /** The tallest the frame may be right now, in CSS pixels (the pane). */
  maxHeight: () => number
  /** The frame completed its handshake — stop showing the skeleton. */
  onReady: () => void
  /** A clamped height the frame asked for. */
  onResize: (height: number) => void
  /** The Tool crashed. Render the error card. */
  onError: (error: { message: string; stack?: string }) => void
  /** The Tool asked the app to move. Already checked to be an in-app path. */
  navigate: (path: string) => void
  /**
   * The bridge answered `revoked`: the version was withdrawn or its listing
   * held. The host removes the frame; the Tool is never told.
   */
  onRevoked?: (message: string) => void
  /** The Tool asked to switch its own section. The page decides whether it is one. */
  onSection?: (section: string) => void
  /**
   * A host service the Tool called (`ui.*`) — a toast, a confirm, a download,
   * opening a record or a file. Answered by the page, never the server; absent,
   * every one is refused.
   */
  onHostCall?: (method: HostMethod, params: unknown) => Promise<BridgeResponse>
  /**
   * Injected by tests; defaults to the real POST. Whatever it resolves is run
   * through `readResponse` — there is exactly one place a bridge answer is
   * believed, and this is not it.
   */
  send?: (request: BridgeRequest) => Promise<unknown>
}

export interface HostBridge {
  /** Push a new theme. No-op when it matches what the frame already has. */
  setTheme(theme: Record<string, string>): void
  /** Push a new subject. No-op when it matches what the frame already has. */
  setSubject(subject: ToolSubject | null): void
  /**
   * Tell the frame these note paths changed (from the changes stream). Dropped
   * before the handshake — the Tool has nothing to refresh yet — and when
   * empty. Paths only; the Tool re-reads through the bridge.
   */
  notifyChanged(paths: string[]): void
  /** Tell the frame the person chose another section. */
  setSection(section: string | null): void
  /** Tell the frame the person pressed one of its band buttons. */
  sendAction(id: string): void
  /** Stop listening and stop posting. Safe to call twice. */
  dispose(): void
}

/** HTTP status → the bridge code an author can branch on. */
const STATUS_CODES: Record<number, BridgeErrorCode> = {
  400: 'invalid',
  401: 'forbidden',
  403: 'forbidden',
  404: 'not_found',
  408: 'timeout',
  413: 'too_large',
  429: 'rate_limited',
  504: 'timeout',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a `BridgeResponse` off the wire. The bridge route is ours, but a proxy,
 * an error page or a future change could put anything here, and a Tool must
 * never see a half-shaped result.
 */
function readResponse(value: unknown): BridgeResponse {
  if (isRecord(value)) {
    if (value.ok === true) return { ok: true, value: value.value }
    if (value.ok === false && isRecord(value.error) && typeof value.error.message === 'string') {
      return { ok: false, error: value.error as unknown as BridgeError }
    }
  }
  return { ok: false, error: { code: 'internal', message: 'The bridge returned an unreadable response.' } }
}

/** Every way the relay itself can fail, as a code the Tool can act on. */
function relayError(cause: unknown): BridgeError {
  if (cause instanceof FetchJsonError) {
    return { code: STATUS_CODES[cause.status] ?? 'internal', message: cause.message }
  }
  return { code: 'internal', message: 'Visvine could not reach the Tool bridge.' }
}

function postBridge(request: BridgeRequest): Promise<unknown> {
  // Same-origin on purpose: this is the one request in the whole feature that
  // carries the viewer's session, and it never leaves the app host.
  return fetchJsonBody<unknown>(BRIDGE_ENDPOINT, 'POST', request, { credentials: 'same-origin' })
}

/** Whether two theme maps are the same set of properties and values. */
function sameTheme(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

function sameSubject(a: ToolSubject | null, b: ToolSubject | null): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const {
    iframe,
    hostWindow,
    frameOrigin,
    target,
    init,
    maxHeight,
    onReady,
    onResize,
    onError,
    navigate,
    onRevoked,
    onSection,
    onHostCall,
    send = postBridge,
  } = options

  let disposed = false
  let handshakeDone = false
  let theme: Record<string, string> = {}
  let subject: ToolSubject | null = null
  let section: string | null = null

  /**
   * An opaque-origin frame can only be addressed with `'*'`; a frame that ever
   * reports a real origin is addressed by that origin and nothing else.
   */
  const postTarget = frameOrigin === SANDBOXED_FRAME_ORIGIN ? '*' : frameOrigin

  function post(message: HostMessage): void {
    if (disposed) return
    const frameWindow = iframe.contentWindow
    if (!frameWindow) return
    try {
      frameWindow.postMessage(message, postTarget)
    } catch {
      // A frame that navigated away or was torn down mid-flight. Nothing to do:
      // the Tool is gone, and the host must not throw on its way out.
    }
  }

  async function relay(id: string, method: BridgeRequest['method'] | HostMethod, params: unknown): Promise<void> {
    let response: BridgeResponse
    try {
      if (isHostMethod(method)) {
        response = onHostCall
          ? readResponse(await onHostCall(method, params))
          : { ok: false, error: { code: 'invalid', message: `${method} is not available here.` } }
      } else {
        response = readResponse(await send({ target, method, params }))
      }
    } catch (cause) {
      response = { ok: false, error: relayError(cause) }
    }
    if (disposed) return
    if (!response.ok && response.error.code === 'revoked') {
      onRevoked?.(response.error.message)
      return
    }
    post(
      response.ok
        ? { type: 'visvine:result', id, ok: true, value: response.value }
        : { type: 'visvine:result', id, ok: false, error: response.error },
    )
  }

  function handleReady(): void {
    // The handshake is once. A Tool that re-posts `ready` (a re-mount, or a
    // deliberate attempt to make the host re-send the viewer) gets nothing.
    if (handshakeDone) return
    handshakeDone = true
    const payload = init()
    theme = payload.theme
    subject = payload.subject
    section = payload.section ?? null
    post({
      type: 'visvine:init',
      version: PROTOCOL_VERSION,
      theme: payload.theme,
      subject: payload.subject,
      install: payload.install,
      degraded: payload.degraded,
      viewer: payload.viewer,
      section,
    })
    onReady()
  }

  function handleResize(height: number): void {
    // The floor keeps a Tool that measures itself at 0 (mid-mount, or hidden)
    // from collapsing the pane; the ceiling is the pane itself, so a Tool can
    // never grow its way over the app's chrome.
    const ceiling = Math.max(MIN_FRAME_HEIGHT, Math.floor(maxHeight()))
    onResize(Math.min(ceiling, Math.max(MIN_FRAME_HEIGHT, Math.ceil(height))))
  }

  function onMessage(event: FrameMessageEvent): void {
    if (disposed) return
    const frameWindow = iframe.contentWindow
    if (!frameWindow || event.source !== frameWindow) return
    if (event.origin !== frameOrigin) return
    const message = event.data
    if (!isFrameMessage(message)) return

    switch (message.type) {
      case 'visvine:ready':
        handleReady()
        break
      case 'visvine:call':
        void relay(message.id, message.method, message.params)
        break
      case 'visvine:resize':
        handleResize(message.height)
        break
      case 'visvine:error':
        onError({ message: message.message, stack: message.stack })
        break
      case 'visvine:navigate':
        // A Tool may move the app around inside itself and nowhere else.
        // `isInAppPath` refuses schemes, protocol-relative `//host`, and
        // anything that resolves outside `/`.
        if (isInAppPath(message.path)) navigate(message.path)
        break
      case 'visvine:section':
        onSection?.(message.section)
        break
    }
  }

  hostWindow.addEventListener('message', onMessage)

  return {
    setTheme(next) {
      if (sameTheme(theme, next)) return
      theme = next
      if (handshakeDone) post({ type: 'visvine:theme', theme: next })
    },

    setSubject(next) {
      if (sameSubject(subject, next)) return
      subject = next
      if (handshakeDone) post({ type: 'visvine:subject', subject: next })
    },

    notifyChanged(paths) {
      if (!handshakeDone || paths.length === 0) return
      post({ type: 'visvine:changed', paths })
    },

    setSection(next) {
      if (next === section) return
      section = next
      if (handshakeDone) post({ type: 'visvine:route', section: next })
    },

    sendAction(id) {
      if (handshakeDone) post({ type: 'visvine:action', id })
    },

    dispose() {
      if (disposed) return
      disposed = true
      hostWindow.removeEventListener('message', onMessage)
    },
  }
}
