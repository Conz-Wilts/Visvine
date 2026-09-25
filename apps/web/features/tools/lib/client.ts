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
import { fetchJson, fetchJsonBody, FetchJsonError } from '@/lib/fetchJson'
import type { CheckReport } from '@/lib/tools/checks/findings'
import type { BuilderStreamEvent } from '@/lib/tools/builder'
import type {
  BuilderResponse,
  CheckResponse,
  WriteFileResponse,
  ApprovalDecisionResponse,
  ApprovalQueueResponse,
  InstallCreatedResponse,
  AuthoredToolView,
  InstallUpdatedResponse,
  InstallsResponse,
  PublishResponse,
  VersionResponse,
  DirectoryResponse,
  ListingAboutResponse,
  ListingResponse,
  ListingSourceResponse,
  SpaceListingsResponse,
} from '@/lib/tools/api'
import type { TypeClaims } from '@/lib/tools/installs'
import type { BindableSpace } from '@visvine/tool-protocol/bindings'

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
  | { bind: { bindings?: Record<string, string>; settings?: Record<string, unknown> } }

/** What this space can bind a Tool's slots to — admins only, for the install sheet's pickers. */
export function fetchBindable(spaceId: string, signal?: AbortSignal): Promise<BindableSpace> {
  return fetchJson<BindableSpace>(`/api/spaces/${encodeURIComponent(spaceId)}/tools/bindable`, { signal })
}

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

/** Install an approved version into this space (admins), placed and with its type claims answered. */
export function installToolVersion(
  spaceId: string,
  input: {
    versionId: string
    placement?: 'rail' | 'more'
    typeClaims?: Record<string, 'page' | 'tab' | 'none'>
    bindings?: Record<string, string>
    settings?: Record<string, unknown>
  },
): Promise<InstallCreatedResponse> {
  return fetchJsonBody<InstallCreatedResponse>(`/api/spaces/${encodeURIComponent(spaceId)}/tools`, 'POST', input)
}

/** Pull an approved version back — it stops wherever it runs (admins of the space that made it). */
export function revokeToolVersion(spaceId: string, versionId: string, reason?: string): Promise<{ ok: true }> {
  return fetchJsonBody<{ ok: true }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/versions/${encodeURIComponent(versionId)}`,
    'POST',
    { action: 'revoke', ...(reason ? { reason } : {}) },
  )
}

/**
 * Publish the working copy as the next version, INTO THIS SPACE.
 *
 * An admin's publish is approved as it lands; a member's waits for one of their
 * admins in Console → Approvals. Neither offers it to any other space. A
 * working copy that does not compile comes back 409 with its diagnostics.
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

/** Save one of a Tool's files from the Workbench; answers with the fresh build. */
export function saveToolFile(spaceId: string, name: string, file: string, content: string): Promise<WriteFileResponse> {
  return fetchJsonBody<WriteFileResponse>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}/files/${encodeURIComponent(file)}`,
    'PUT',
    { content },
  )
}

// ── the builder ──────────────────────────────────────────────────────────────

const builderUrl = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/tools/builder`

/** The person's builder thread in this space, newest first, and whether the space can answer. */
export function fetchBuilder(spaceId: string, signal?: AbortSignal): Promise<BuilderResponse> {
  return fetchJson<BuilderResponse>(builderUrl(spaceId), { signal })
}

/** Start the builder thread over. */
export function clearBuilder(spaceId: string): Promise<{ ok: true }> {
  return fetchJsonBody<{ ok: true }>(builderUrl(spaceId), 'DELETE', {})
}

/**
 * Send one message to the builder and read its turn as it happens. Resolves
 * when the stream ends; every event — the stored question, each call, the
 * `workbench` notices, the answer — goes to `onEvent` on the way.
 */
export async function streamBuilder(
  spaceId: string,
  body: { text: string; tool: string | null },
  onEvent: (event: BuilderStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${builderUrl(spaceId)}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new FetchJsonError(res.status, data?.error ?? `Request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as BuilderStreamEvent)
        } catch {
          // A frame that is not JSON is not an event.
        }
      }
      end = buffer.indexOf('\n\n')
    }
  }
}

/** Run the static checks on the working copy now; the report is recorded and returned. */
export function runToolChecks(spaceId: string, name: string): Promise<CheckResponse> {
  return fetchJsonBody<CheckResponse>(
    `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}/check`,
    'POST',
    {},
  )
}

/** The report a refused publish carried, when checks — not the compiler — refused it. */
export function blockedReport(error: unknown): CheckReport | null {
  if (!(error instanceof FetchJsonError) || error.status !== 422) return null
  const body = error.body as { report?: CheckReport } | null | undefined
  return body?.report ?? null
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

// ── going global ─────────────────────────────────────────────────────────────

/**
 * A listing act on one of this space's versions (lib/tools/listings.ts):
 * `list` asks Visvine (co-signed at once by its author), `cosign` is the
 * author's consent, `unlist` takes a request back.
 */
export function listingAction(
  spaceId: string,
  versionId: string,
  input: { action: 'list'; license?: string; note?: string } | { action: 'cosign'; license: string } | { action: 'unlist' },
): Promise<ListingResponse> {
  return fetchJsonBody<ListingResponse>(versionsUrl(spaceId, versionId), 'POST', input)
}

/** The listings this space publishes, and those offered to it. */
export function fetchSpaceListings(spaceId: string, signal?: AbortSignal): Promise<SpaceListingsResponse> {
  return fetchJson<SpaceListingsResponse>(`/api/spaces/${encodeURIComponent(spaceId)}/tools/listings`, { signal })
}

/** Offer a listing to another space, take an offer back, or answer one. */
export function moveListing(
  spaceId: string,
  input:
    | { action: 'offer'; listingId: string; toSpaceId: string | null }
    | { action: 'accept'; listingId: string; name?: string }
    | { action: 'decline'; listingId: string },
): Promise<{ listingId: string; key: string; transferTo: string | null }> {
  return fetchJsonBody(`/api/spaces/${encodeURIComponent(spaceId)}/tools/listings`, 'POST', input)
}

/** Where a working copy downloads as a `.vvtool`. */
export function workingCopyExportUrl(spaceId: string, name: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}/tools/authoring/${encodeURIComponent(name)}/export`
}

// ── the directory (Discover → Tools) ─────────────────────────────────────────

/** One page of listed Tools; 404 when the directory is not open to this viewer. */
export function fetchDirectory(q: string, cursor?: string | null, signal?: AbortSignal): Promise<DirectoryResponse> {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return fetchJson<DirectoryResponse>(`/api/tools/directory${query ? `?${query}` : ''}`, { signal })
}

export function fetchListingAbout(listingId: string, signal?: AbortSignal): Promise<ListingAboutResponse> {
  return fetchJson<ListingAboutResponse>(`/api/tools/directory/${encodeURIComponent(listingId)}`, { signal })
}

export function fetchListingSource(listingId: string, signal?: AbortSignal): Promise<ListingSourceResponse> {
  return fetchJson<ListingSourceResponse>(`/api/tools/directory/${encodeURIComponent(listingId)}/source`, { signal })
}
