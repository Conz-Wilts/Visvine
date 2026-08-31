/**
 * The marketplace's one door to the Tools REST surface.
 *
 * Every fetch the `/tools` screens make goes through here, typed with the
 * envelopes in lib/tools/api.ts — the same declarations the route handlers
 * annotate their bodies with, so a change to a shape is a type error on both
 * ends rather than a runtime surprise on one. Nothing in here decides anything:
 * refusals arrive as `FetchJsonError` (status + the server's own sentence) and
 * the screens turn them into toasts, because the server's wording is the one an
 * admin can act on.
 *
 * Plain TypeScript, no React — this is the seam the components sit on, and it is
 * the only file in features/tools that knows a URL.
 */
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson'
import type {
  ApprovalDecisionResponse,
  ApprovalQueueResponse,
  AuthoredToolsResponse,
  AuthoredToolView,
  BrowseResponse,
  CreateToolRequest,
  CreateToolResponse,
  InstallCreatedResponse,
  InstallUpdatedResponse,
  InstallsResponse,
  ListingResponse,
  PublishResponse,
  ToolIconResponse,
  VersionResponse,
} from '@/lib/tools/api'
import type { TypeClaims } from '@/lib/tools/installs'

// ── browse ───────────────────────────────────────────────────────────────────

/**
 * The catalogue. `spaceId` is optional and does real work: naming a space adds
 * `installedInSpace` to every row (and gates the request on membership plus the
 * `tools` key), while omitting it leaves the flag ABSENT — which is how the
 * cards tell "this space doesn't run it" from "no space to ask about".
 */
export function browseTools(opts: {
  q?: string
  cursor?: string
  spaceId?: string | null
  signal?: AbortSignal
}): Promise<BrowseResponse> {
  const params = new URLSearchParams()
  if (opts.q?.trim()) params.set('q', opts.q.trim())
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (opts.spaceId) params.set('spaceId', opts.spaceId)
  const query = params.toString()
  return fetchJson<BrowseResponse>(`/api/tools/registry${query ? `?${query}` : ''}`, {
    signal: opts.signal,
  })
}

/** One version opened — the detail drawer's long description, reach and trail. */
export function fetchVersion(versionId: string, signal?: AbortSignal): Promise<VersionResponse> {
  return fetchJson<VersionResponse>(`/api/tools/registry/${encodeURIComponent(versionId)}`, { signal })
}

// ── installs ─────────────────────────────────────────────────────────────────

export function fetchInstalls(spaceId: string, signal?: AbortSignal): Promise<InstallsResponse> {
  return fetchJson<InstallsResponse>(`/api/communities/${encodeURIComponent(spaceId)}/tools`, { signal })
}

export function installVersion(
  spaceId: string,
  body: { versionId: string; slug?: string; typeClaims?: TypeClaims },
): Promise<InstallCreatedResponse> {
  return fetchJsonBody<InstallCreatedResponse>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools`,
    'POST',
    body,
  )
}

/**
 * The four things an admin does to an install. Exactly one key per request —
 * the route refuses two, because each is a separate decision with its own
 * refusals and a combined request would have no honest status code.
 */
export type InstallPatch =
  | { enabled: boolean }
  | { typeClaims: TypeClaims }
  | { applyUpgrade: true }
  | { recheck: true }

export function patchInstall(
  spaceId: string,
  installId: string,
  patch: InstallPatch,
): Promise<InstallUpdatedResponse> {
  return fetchJsonBody<InstallUpdatedResponse>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/${encodeURIComponent(installId)}`,
    'PATCH',
    patch,
  )
}

export function uninstallTool(spaceId: string, installId: string): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/${encodeURIComponent(installId)}`,
    { method: 'DELETE' },
  )
}

// ── authoring (Mine) ─────────────────────────────────────────────────────────

export function fetchAuthoredTools(spaceId: string, signal?: AbortSignal): Promise<AuthoredToolsResponse> {
  return fetchJson<AuthoredToolsResponse>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring`,
    { signal },
  )
}

/** The working copy, its checklist against this space, and its publication trail. */
export function fetchAuthoredTool(
  spaceId: string,
  name: string,
  signal?: AbortSignal,
): Promise<AuthoredToolView> {
  return fetchJson<AuthoredToolView>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
    { signal },
  )
}

/**
 * Scaffold a new Tool in a space — the Create panel's Tool tile. Any member with
 * write grants under `tools/`; the server refuses a taken or malformed name.
 */
export function createTool(spaceId: string, input: CreateToolRequest): Promise<CreateToolResponse> {
  return fetchJsonBody<CreateToolResponse>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring`,
    'POST',
    input,
  )
}

/**
 * Delete a working copy — its notes, folder, node and build. Published
 * versions in the registry stay. The server holds this to the note store's
 * removal bar (admin, the author, or a full-access member) and refuses a
 * non-admin whose Tool is still installed in this space.
 */
export function deleteAuthoredTool(spaceId: string, name: string): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

/**
 * Publish the working copy as the next version, INTO THIS SPACE.
 *
 * An admin's publish is approved as it lands; a member's waits for one of their
 * admins in the Approvals tab. Neither offers it to anyone else — that is
 * `listOnMarketplace`. A working copy that does not compile comes back 409 with
 * its diagnostics.
 */
export function publishTool(
  spaceId: string,
  name: string,
  note?: string,
  releaseNotes?: string,
): Promise<PublishResponse> {
  return fetchJsonBody<PublishResponse>(
    `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
    'POST',
    { action: 'publish', ...(note ? { note } : {}), ...(releaseNotes ? { releaseNotes } : {}) },
  )
}

// ── approvals and listings (a version, not a working copy) ───────────────────

/** This space's own queue: versions its members published, awaiting an admin. */
export function fetchApprovalQueue(
  spaceId: string,
  signal?: AbortSignal,
): Promise<ApprovalQueueResponse> {
  return fetchJson<ApprovalQueueResponse>(versionsUrl(spaceId), { signal })
}

/** A space admin's verdict on a member's publish — the update queue's decision. */
export function reviewSpaceVersion(
  spaceId: string,
  versionId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<ApprovalDecisionResponse> {
  return fetchJsonBody<ApprovalDecisionResponse>(versionsUrl(spaceId, versionId), 'POST', {
    action: 'review',
    decision,
    ...(note ? { note } : {}),
  })
}

/** Offer an approved version to every other space — Visvine reviews it. */
export function listOnMarketplace(
  spaceId: string,
  versionId: string,
  note?: string,
): Promise<ListingResponse> {
  return fetchJsonBody<ListingResponse>(versionsUrl(spaceId, versionId), 'POST', {
    action: 'list',
    ...(note ? { note } : {}),
  })
}

/** Take a listing request back out of Visvine's queue. */
export function unlistFromMarketplace(spaceId: string, versionId: string): Promise<ListingResponse> {
  return fetchJsonBody<ListingResponse>(versionsUrl(spaceId, versionId), 'POST', { action: 'unlist' })
}

function versionsUrl(spaceId: string, versionId?: string): string {
  const base = `/api/communities/${encodeURIComponent(spaceId)}/tools/versions`
  return versionId ? `${base}/${encodeURIComponent(versionId)}` : base
}

/**
 * Set or clear a Tool's own rail glyph.
 *
 * The response carries the rebuilt BUILD, not just an ok: an SVG that fails the
 * sanitizer comes back as a build error rather than an HTTP error, because that
 * is the same channel every other authoring mistake arrives on and the author
 * is already reading it.
 */
export function setToolIcon(spaceId: string, name: string, svg: string): Promise<ToolIconResponse> {
  return fetchJsonBody<ToolIconResponse>(iconUrl(spaceId, name), 'PUT', { svg });
}

export function clearToolIcon(spaceId: string, name: string): Promise<ToolIconResponse> {
  return fetchJson<ToolIconResponse>(iconUrl(spaceId, name), { method: 'DELETE' });
}

function iconUrl(spaceId: string, name: string): string {
  return `/api/communities/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}/icon`;
}

// ── what the space has (the install checklist's other half) ──────────────────

/**
 * The connector and agent names this space can satisfy a Tool's perimeter with.
 *
 * The install dialog shows a requirements checklist BEFORE anything is written,
 * and the only honest way to draw it is to run the server's own
 * `computeRequirements` over the same three lists it would use. Two of them come
 * from routes that already exist; the third (node types) is on the space DTO the
 * shell hydrated with, so it costs nothing.
 *
 * `null` means "this space would not answer" rather than "it has none" — the
 * agents roster is gated on the `agents` feature key, and a space that switched
 * Agents off must show that dimension as unchecked instead of inventing a
 * missing dependency. The install itself is unaffected either way: the server
 * computes the real answer and hands it back on the row.
 */
export interface SpaceCapabilities {
  connectors: string[] | null
  agents: string[] | null
}

interface ConnectorRow {
  name: string
  /** `model` connectors name an LLM provider and are never runnable. */
  kind: string
}

export async function fetchSpaceCapabilities(
  spaceId: string,
  signal?: AbortSignal,
): Promise<SpaceCapabilities> {
  const base = `/api/communities/${encodeURIComponent(spaceId)}`
  const [connectors, agents] = await Promise.all([
    fetchJson<{ connectors: ConnectorRow[] }>(`${base}/connectors`, { signal })
      .then((body) => body.connectors.filter((row) => row.kind !== 'model').map((row) => row.name))
      .catch(() => null),
    fetchJson<{ agents: { name: string }[] }>(`${base}/agents`, { signal })
      .then((body) => body.agents.map((row) => row.name))
      .catch(() => null),
  ])
  return { connectors, agents }
}
