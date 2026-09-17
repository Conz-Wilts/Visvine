/**
 * The one door from the Tools screens to the Tools REST surface.
 *
 * Every fetch the console's Tools sections make goes through here, typed with the
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
  AuthoredToolView,
  CreateToolRequest,
  CreateToolResponse,
  InstallUpdatedResponse,
  InstallsResponse,
  PublishResponse,
  VersionResponse,
} from '@/lib/tools/api'
import type { TypeClaims } from '@/lib/tools/installs'

/** One version opened — the detail drawer's long description, reach and trail. */
export function fetchVersion(versionId: string, signal?: AbortSignal): Promise<VersionResponse> {
  return fetchJson<VersionResponse>(`/api/tools/registry/${encodeURIComponent(versionId)}`, { signal })
}

// ── installs ─────────────────────────────────────────────────────────────────

export function fetchInstalls(spaceId: string, signal?: AbortSignal): Promise<InstallsResponse> {
  return fetchJson<InstallsResponse>(`/api/spaces/${encodeURIComponent(spaceId)}/tools`, { signal })
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
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/${encodeURIComponent(installId)}`,
    'PATCH',
    patch,
  )
}

export function uninstallTool(spaceId: string, installId: string): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/${encodeURIComponent(installId)}`,
    { method: 'DELETE' },
  )
}

// ── authoring ─────────────────────────────────────────

/** The working copy, its checklist against this space, and its publication trail. */
export function fetchAuthoredTool(
  spaceId: string,
  name: string,
  signal?: AbortSignal,
): Promise<AuthoredToolView> {
  return fetchJson<AuthoredToolView>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
    { signal },
  )
}

/** Share the Tool with the space's sub-spaces (`share:` on its index note) — admin only. */
export function setAuthoredToolShare(
  spaceId: string,
  name: string,
  share: 'none' | 'all' | string[],
): Promise<{ tool: AuthoredToolView['tool'] }> {
  return fetchJsonBody(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
    'PATCH',
    { share },
  )
}

/**
 * Scaffold a new Tool in a space — the Create panel's Tool tile. Any member with
 * write grants under `tools/`; the server refuses a taken or malformed name.
 */
export function createTool(spaceId: string, input: CreateToolRequest): Promise<CreateToolResponse> {
  return fetchJsonBody<CreateToolResponse>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring`,
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
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
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
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}`,
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

function versionsUrl(spaceId: string, versionId?: string): string {
  const base = `/api/spaces/${encodeURIComponent(spaceId)}/tools/versions`
  return versionId ? `${base}/${encodeURIComponent(versionId)}` : base
}
