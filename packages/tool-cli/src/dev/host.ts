/**
 * The page around the Tool in `visvine-tool dev` — the host half of the
 * bridge, the same `createHostBridge` the app runs, relaying each call to the
 * dev server's offline runtime instead of Visvine's. It answers the host's own
 * services itself (a toast, a confirm, a download), draws the Tool's sections
 * when it declares them, lists every call with how it was answered, and
 * reloads the frame on each rebuild.
 */
import { createHostBridge, SANDBOXED_FRAME_ORIGIN, type HostBridge } from '@/features/tools/lib/hostBridge'
import { themeTokensFrom } from '@/features/tools/lib/theme'
import type { BridgeResponse, HostMethod, ToolDegraded, ToolInstallInfo, ToolViewer } from '@visvine/tool-protocol/protocol'

interface DevState {
  name: string
  title: string
  version: string
  problem: string | null
  build: { ok: boolean; errors: string[]; warnings: string[]; configError: string | null } | null
  init: { install: ToolInstallInfo; viewer: ToolViewer; degraded: ToolDegraded | null; subject: unknown } | null
  nav: { style: 'tabs' | 'side'; sections: Array<{ id: string; label: string; admin?: boolean }> } | null
  mayDownload: boolean
  frameUrl: string
  galleryUrl: string | null
}

const $ = (id: string) => document.getElementById(id)!
const theme = themeTokensFrom(() => '')
let state: DevState
let view: 'tool' | 'gallery' = 'tool'
let section: string | null = null
let bridge: HostBridge | null = null

function toast(message: string): void {
  const el = document.createElement('div')
  el.textContent = message
  $('toasts').append(el)
  setTimeout(() => el.remove(), 3500)
}

function logCall(entry: { method: string; ok: boolean; code?: string; message?: string }): void {
  const li = document.createElement('li')
  li.className = entry.ok ? 'yes' : 'no'
  li.textContent = `${entry.ok ? '✓' : '✗'} ${entry.method}${entry.code ? ` ${entry.code}` : ''}`
  if (entry.message) {
    const msg = document.createElement('span')
    msg.className = 'msg'
    msg.textContent = entry.message
    li.append(msg)
  }
  $('calls').prepend(li)
  while ($('calls').children.length > 200) $('calls').lastChild!.remove()
}

async function hostCall(method: HostMethod, params: unknown): Promise<BridgeResponse> {
  const p = (params ?? {}) as Record<string, unknown>
  logCall({ method, ok: true })
  switch (method) {
    case 'ui.toast':
      toast(String(p.message ?? ''))
      return { ok: true, value: null }
    case 'ui.confirm':
      return { ok: true, value: { confirmed: window.confirm([p.title, p.body].filter(Boolean).join('\n\n')) } }
    case 'ui.download': {
      if (!state.mayDownload) {
        return { ok: false, error: { code: 'perimeter', message: 'tool perimeter denied: this tool does not declare downloads — set permissions.ui.download' } }
      }
      const blob = new Blob([String(p.content ?? '')], { type: String(p.mimeType ?? 'text/plain') })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = String(p.filename ?? 'download').split(/[\\/]/).pop() || 'download'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      return { ok: true, value: { saved: true } }
    }
    case 'ui.openRecord':
    case 'ui.openResource':
      toast(`Opens ${String(p.path ?? p.nodeId ?? p.id ?? '')} in Visvine`)
      return { ok: true, value: null }
  }
  return { ok: false, error: { code: 'invalid', message: `Unknown host method ${method}` } }
}

function drawNav(): void {
  const nav = $('nav')
  nav.replaceChildren()
  if (view !== 'tool' || !state.nav) return
  const sections = state.nav.sections.filter((s) => !s.admin || state.init?.viewer.isAdmin)
  if (!section || !sections.some((s) => s.id === section)) section = sections[0]?.id ?? null
  nav.className = 'tabs'
  for (const s of sections) {
    const button = document.createElement('button')
    button.textContent = s.label
    button.setAttribute('aria-selected', String(s.id === section))
    button.onclick = () => {
      section = s.id
      bridge?.setSection(section)
      drawNav()
    }
    nav.append(button)
  }
}

function mount(): void {
  bridge?.dispose()
  bridge = null
  const slot = $('frame-slot')
  slot.replaceChildren()
  $('title').textContent = state.title
  const status = $('status')
  const broken = state.problem ?? (state.build && !state.build.ok ? [state.build.configError, ...state.build.errors].filter(Boolean).join('\n') : null)
  status.textContent = broken ? 'does not build' : `built · ${state.init?.viewer.isAdmin ? 'admin' : 'member'}`
  status.className = broken ? 'status bad' : 'status'
  const missing = state.init?.degraded?.missing
  $('degraded').textContent = missing ? `Unbound: ${[...(missing.bindings ?? []), ...missing.connectors, ...missing.types, ...missing.agents].join(', ')}` : ''
  drawNav()
  if (view === 'tool' && broken) {
    const pre = document.createElement('pre')
    pre.className = 'errors'
    pre.textContent = broken
    slot.append(pre)
    return
  }
  const url = view === 'gallery' ? state.galleryUrl : state.frameUrl
  if (!url || !state.init) return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', state.title)
  iframe.src = url
  slot.append(iframe)
  const init = state.init
  bridge = createHostBridge({
    iframe,
    hostWindow: window,
    frameOrigin: SANDBOXED_FRAME_ORIGIN,
    target: { kind: 'preview', spaceId: 'offline', name: state.name },
    init: () => ({ theme, subject: null, install: init.install, degraded: init.degraded, viewer: init.viewer, section }),
    maxHeight: () => 20_000,
    onReady: () => undefined,
    onResize: (height) => {
      iframe.style.height = `${height}px`
    },
    onError: (error) => {
      const pre = document.createElement('pre')
      pre.className = 'errors'
      pre.textContent = `${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
      slot.replaceChildren(pre)
    },
    navigate: (path) => toast(`Navigates to ${path} in Visvine`),
    onSection: (id) => {
      section = id
      drawNav()
    },
    onHostCall: hostCall,
    send: async (request) =>
      (
        await fetch('/__bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Visvine-Dev': '1' },
          body: JSON.stringify({ method: request.method, params: request.params }),
        })
      ).json(),
  })
}

async function refresh(): Promise<void> {
  state = (await (await fetch('/__state', { cache: 'no-store' })).json()) as DevState
  mount()
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.onclick = () => {
    view = button.dataset.view === 'gallery' ? 'gallery' : 'tool'
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b === button))
    mount()
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-admin]')) {
  button.onclick = async () => {
    await fetch('/__viewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Visvine-Dev': '1' },
      body: JSON.stringify({ isAdmin: button.dataset.admin === 'true' }),
    })
    for (const b of document.querySelectorAll('[data-admin]')) b.setAttribute('aria-selected', String(b === button))
    await refresh()
  }
}

const events = new EventSource('/__events')
events.addEventListener('build', () => void refresh())
events.addEventListener('changed', (event) => {
  const paths = (JSON.parse((event as MessageEvent).data) as { paths: string[] }).paths
  bridge?.notifyChanged(paths)
})
events.addEventListener('call', (event) => logCall(JSON.parse((event as MessageEvent).data)))

void refresh()
