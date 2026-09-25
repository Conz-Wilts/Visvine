/**
 * The host's own services to a Tool — `ui.toast`, `ui.confirm`, `ui.download`,
 * `ui.openRecord`, `ui.openResource` — answered by the page around the frame,
 * never the server. The frame has no popups, no downloads and no navigation of
 * its own (`sandbox="allow-scripts"`), so each of these is the app acting on
 * the Tool's behalf, in the app's own chrome, where the viewer can see who is
 * asking. Plain TypeScript: the page supplies the effects, so the rules are
 * testable without a DOM.
 */
import { noteHref } from '@/lib/notes/entities'
import type { BridgeResponse, HostMethod } from '@/lib/tools/protocol'

/** The largest file a Tool may hand the viewer to save. */
export const DOWNLOAD_MAX_CHARS = 5_000_000

const TOAST_MAX_CHARS = 200

export interface HostServiceEnv {
  /** Does this Tool declare downloads (`permissions.ui.download`)? From the mint, never the frame. */
  mayDownload: boolean
  toast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void
  /** Ask the viewer; resolves to their answer. Null when a question is already open. */
  confirm: (question: { title: string; body?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean> | null
  save: (file: { filename: string; content: string; mimeType: string }) => void
  navigate: (path: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/** A name the viewer's disk will accept: the last segment only, no control characters. */
export function safeFilename(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return name || 'download.txt'
}

const invalid = (message: string): BridgeResponse => ({ ok: false, error: { code: 'invalid', message } })

export async function hostServiceCall(method: HostMethod, params: unknown, env: HostServiceEnv): Promise<BridgeResponse> {
  const p = isRecord(params) ? params : {}
  switch (method) {
    case 'ui.toast': {
      const message = text(p.message, TOAST_MAX_CHARS)
      if (!message) return invalid('ui.toast needs a message')
      const tone = p.tone === 'success' || p.tone === 'warning' || p.tone === 'error' ? p.tone : 'info'
      env.toast(tone, message)
      return { ok: true, value: null }
    }
    case 'ui.confirm': {
      const title = text(p.title, 120)
      if (!title) return invalid('ui.confirm needs a title')
      const asked = env.confirm({
        title,
        body: text(p.body, 600) ?? undefined,
        confirmLabel: text(p.confirmLabel, 24) ?? undefined,
        destructive: p.destructive === true,
      })
      if (!asked) return { ok: false, error: { code: 'rate_limited', message: 'A question is already open.' } }
      return { ok: true, value: { confirmed: await asked } }
    }
    case 'ui.download': {
      if (!env.mayDownload) {
        return { ok: false, error: { code: 'perimeter', message: 'tool perimeter denied: this tool does not declare downloads — set permissions.ui.download' } }
      }
      const filename = text(p.filename, 200)
      if (!filename || typeof p.content !== 'string') return invalid('ui.download needs a filename and content')
      if (p.content.length > DOWNLOAD_MAX_CHARS) {
        return { ok: false, error: { code: 'too_large', message: `A download is at most ${DOWNLOAD_MAX_CHARS} characters.` } }
      }
      const name = safeFilename(filename)
      const asked = env.confirm({ title: `Save ${name}?`, confirmLabel: 'Save' })
      if (!asked) return { ok: false, error: { code: 'rate_limited', message: 'A question is already open.' } }
      if (!(await asked)) return { ok: true, value: { saved: false } }
      const mimeType = text(p.mimeType, 100) ?? 'text/plain'
      env.save({ filename: name, content: p.content, mimeType })
      return { ok: true, value: { saved: true } }
    }
    case 'ui.openRecord': {
      const nodeId = text(p.nodeId, 200)
      const path = text(p.path, 512)
      if (nodeId) env.navigate(`/directory/${encodeURIComponent(nodeId)}`)
      else if (path && !path.includes('..')) env.navigate(noteHref(path.replace(/^\/+/, '')))
      else return invalid('ui.openRecord needs a path or a nodeId')
      return { ok: true, value: null }
    }
    case 'ui.openResource': {
      const id = text(p.id, 200)
      if (!id) return invalid('ui.openResource needs an id')
      env.navigate(`/directory?view=resources&resource=${encodeURIComponent(id)}`)
      return { ok: true, value: null }
    }
  }
}
