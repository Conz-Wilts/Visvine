/**
 * What a frame token is allowed to load.
 *
 * The frame route and the bundle route both have to answer this — one to build
 * the document, the other to decide whether the id in the URL is the id that
 * token may have — and they have to answer it the SAME way, or the bundle
 * route becomes a way to read any Tool's code with any valid token. So it
 * lives here rather than in either route.
 *
 * A token names an install or a working copy; it never names a bundle id. The
 * id is derived from the token every time, so the `[id]` segment is only ever
 * checked against it, never trusted.
 */
import { createHash } from 'node:crypto'
import prisma from '@/lib/prisma'
import type { CompileDiagnostic } from './compile'
import type { FrameTokenPayload } from './frameToken'
import { decodeToolConfig } from './registry'
import { manifestOf } from './config'
import { sdkMajorOf } from '@visvine/tool-protocol/manifest'

/** The kit a stored config was written for: 2 for a Tool that says so, 1 for everything before. */
function kitOf(rawConfig: unknown, name: string): 1 | 2 {
  if (!rawConfig) return 1
  return sdkMajorOf(manifestOf(decodeToolConfig(rawConfig, name)).sdk) >= 2 ? 2 : 1
}

/** `v_<versionId>` for a pinned install, `b_<buildId>` for an author's working copy. */
export interface RuntimeBundleRef {
  ok: true
  /** The id the bundle route's `[id]` segment must equal. */
  id: string
  kind: 'version' | 'build'
  recordId: string
  /**
   * A published version's bundle never changes, so its URL may be cached for a
   * year. A working copy is recompiled on every write to `ui.tsx`.
   */
  immutable: boolean
  /** The kit major the Tool was written for — which kit its frame loads. */
  kit: 1 | 2
}

interface RuntimeBundleProblem {
  ok: false
  /** 200 for a build that failed to compile — that IS the Tool, rendered. */
  status: number
  title: string
  message: string
  details?: CompileDiagnostic[]
}

export type RuntimeBundleResult = RuntimeBundleRef | RuntimeBundleProblem

/** `errors`/`warnings` are Json columns; keep only rows that look like diagnostics. */
function asDiagnostics(value: unknown): CompileDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { message, line, column, text } = entry as Record<string, unknown>
    if (typeof message !== 'string') return []
    return [
      {
        message,
        line: typeof line === 'number' ? line : null,
        column: typeof column === 'number' ? column : null,
        text: typeof text === 'string' ? text : null,
      },
    ]
  })
}

async function resolveInstall(
  payload: Extract<FrameTokenPayload, { kind: 'install' }>,
): Promise<RuntimeBundleResult> {
  // Matched on the space too: a token minted for one space must not resolve an
  // install id that has since moved, or was guessed, in another.
  const install = await prisma.appToolInstall.findFirst({
    where: { id: payload.installId, spaceId: payload.spaceId },
    select: { versionId: true, enabled: true, version: { select: { name: true, config: true } } },
  })
  if (!install) {
    return {
      ok: false,
      status: 404,
      title: 'This Tool is not installed',
      message: 'It may have been removed from this space. Reload the page to see what is there now.',
    }
  }
  if (!install.enabled) {
    return {
      ok: false,
      status: 403,
      title: 'This Tool is turned off',
      message: 'An admin has disabled it for this space.',
    }
  }
  return {
    ok: true,
    id: `v_${install.versionId}`,
    kind: 'version',
    recordId: install.versionId,
    immutable: true,
    kit: kitOf(install.version.config, install.version.name),
  }
}

async function resolvePreview(
  payload: Extract<FrameTokenPayload, { kind: 'preview' }>,
): Promise<RuntimeBundleResult> {
  const build = await prisma.appToolBuild.findFirst({
    where: { spaceId: payload.spaceId, name: payload.name },
    select: { id: true, ok: true, uiBundle: true, errors: true, configError: true, config: true },
  })
  if (!build) {
    return {
      ok: false,
      status: 404,
      title: 'This Tool has not been built yet',
      message: `Nothing has compiled for tools/${payload.name} in this space. Save ui.tsx and try again.`,
    }
  }
  if (!build.ok || !build.uiBundle) {
    // 200, not an error status: a compile failure IS the preview. This is the
    // surface an author sees their own diagnostics on, in the pane, without
    // leaving the page they are building on.
    const details = asDiagnostics(build.errors)
    return {
      ok: false,
      status: 200,
      title: 'This Tool did not compile',
      message: build.configError ?? 'Fix the problems below and save again.',
      details: details.length > 0 ? details : undefined,
    }
  }
  return { ok: true, id: `b_${build.id}`, kind: 'build', recordId: build.id, immutable: false, kit: kitOf(build.config, payload.name) }
}

/** The one place a frame token turns into a bundle id. */
export function resolveRuntimeBundle(payload: FrameTokenPayload): Promise<RuntimeBundleResult> {
  return payload.kind === 'install' ? resolveInstall(payload) : resolvePreview(payload)
}

/**
 * The compiled ESM itself, read only after the ref has been checked against
 * the requested id. Null when the row vanished between the two reads.
 */
export async function loadRuntimeBundleCode(ref: RuntimeBundleRef): Promise<string | null> {
  if (ref.kind === 'version') {
    const version = await prisma.appToolVersion.findUnique({
      where: { id: ref.recordId },
      select: { uiBundle: true },
    })
    return version?.uiBundle ?? null
  }
  const build = await prisma.appToolBuild.findUnique({
    where: { id: ref.recordId },
    select: { uiBundle: true },
  })
  return build?.uiBundle ?? null
}

// ── caching ───────────────────────────────────────────────────────────────────

/**
 * The ETag both runtime asset routes use — sha1 of the bytes served, so it is
 * the same value whether it was computed here or alongside a vendor build.
 */
export function assetEtag(code: string): string {
  return createHash('sha1').update(code, 'utf8').digest('hex')
}

/**
 * Whether an `If-None-Match` header covers `etag`, tolerating the weak prefix
 * and the quoting a browser adds. `*` matches anything that exists, which for
 * these routes is anything we are about to serve.
 */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1'))
    .some((candidate) => candidate === etag || candidate === '*')
}
