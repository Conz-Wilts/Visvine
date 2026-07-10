'use client'

// Folder access panel for a community's brain: shows a top-level folder's
// registry state and lets members act on it. Any member can register an
// unregistered folder (turn enforcement on); folder admins manage visibility,
// the lock, the member roster, and pending join requests; a non-member of a
// private folder sees a "Request access" form instead. The root registry entry
// (id '', "Community brain") is the BRAIN GATE — it controls who can access the
// community's brain at all — and is listed first; it's managed like any folder
// except it can't be unregistered from here (removing the gate re-opens the
// brain to everyone). Opened from a sidebar folder row's hover action or the
// command palette (which lets you pick the folder here).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { notesApi, type RegistryFolder, type RegistryResponse } from '../lib/notesApi'
import { formatRelativeTime } from '@/lib/notes/shared/time'
import type { FolderLevel, FolderVisibility, JoinRequest } from '@/lib/notes/shared/brainTypes'

interface FolderAccessModalProps {
  communityId: string
  /** Physical top-level folders in the shared tree (registered or not). */
  topLevelFolders: string[]
  /** Folder to show initially; null = first available. */
  initialFolderId: string | null
  /** Fired after any registry change so the workspace can refresh its copy. */
  onRegistryChanged: () => void
  onClose: () => void
}

const LEVELS: FolderLevel[] = ['read', 'write', 'admin']

export function FolderAccessModal({
  communityId,
  topLevelFolders,
  initialFolderId,
  onRegistryChanged,
  onClose,
}: FolderAccessModalProps) {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [selected, setSelected] = useState<string | null>(initialFolderId)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Register form (unregistered folder)
  const [regName, setRegName] = useState('')
  const [regVisibility, setRegVisibility] = useState<FolderVisibility>('public')
  // Add-member form
  const [addUserId, setAddUserId] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addName, setAddName] = useState('')
  const [addLevel, setAddLevel] = useState<FolderLevel>('read')
  // Request-access form
  const [joinMessage, setJoinMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const reg = await notesApi.getRegistry(communityId)
      setRegistry(reg)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load folder registry')
    }
    // Join requests are best-effort: non-admins may only see their own (or none).
    try {
      const { requests: r } = await notesApi.listJoinRequests(communityId)
      setRequests(r)
    } catch {
      setRequests([])
    }
  }, [communityId])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  // All selectable folder ids: physical top-level folders ∪ registered folders.
  // The brain gate (root entry, id '') comes FIRST when the registry has one.
  const folderIds = useMemo(() => {
    const ids = new Set(topLevelFolders)
    for (const f of registry?.folders ?? []) ids.add(f.id)
    const sorted = [...ids].filter((id) => id !== '').sort()
    return ids.has('') ? ['', ...sorted] : sorted
  }, [topLevelFolders, registry])

  const folderId = selected ?? folderIds[0] ?? null
  // The brain gate: the root registry entry (id ''), managed like a folder but
  // controlling access to the whole brain.
  const isGate = folderId === ''
  const folder: RegistryFolder | null =
    registry?.folders.find((f) => f.id === folderId) ?? null
  const me = registry?.me ?? null
  const canAdmin = !!(folder && (folder.canAdmin || me?.communityAdmin))
  const isMember = !!folder?.myLevel
  const needsRequest = !!folder && folder.visibility === 'private' && !isMember && !canAdmin
  const pendingForFolder = requests.filter((r) => r.folderId === folderId && r.status === 'pending')
  const myPendingRequest = pendingForFolder.some((r) => r.userId === me?.userId)

  // Reset the register-form default name when the selection changes.
  useEffect(() => {
    setRegName(folderId ?? '')
    setNotice(null)
  }, [folderId])

  const run = async (fn: () => Promise<unknown>, doneNotice?: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onRegistryChanged()
      if (doneNotice) setNotice(doneNotice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Folder access</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="border-b border-brand-green/30 bg-brand-light-bg px-4 py-2 text-sm text-brand-dark-green">{notice}</div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-text-muted">Loading…</div>
          ) : folderIds.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">
              No top-level folders yet — create a folder first.
            </div>
          ) : (
            <>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Folder</span>
                <select
                  value={folderId ?? ''}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-green"
                >
                  {folderIds.map((id) => (
                    <option key={id} value={id}>{id === '' ? 'Community brain (brain gate)' : id}</option>
                  ))}
                </select>
              </label>

              {!folder ? (
                // ---------------- Unregistered folder -----------------------
                <div className="rounded-xl border border-border-subtle p-3">
                  <p className="text-sm text-text-secondary">
                    This folder isn’t registered — every community member can read and write it.
                    Register it to control visibility and membership.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Folder name"
                      className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
                    />
                    <VisibilityPicker value={regVisibility} onChange={setRegVisibility} disabled={busy} />
                    <div className="flex justify-end">
                      <button
                        onClick={() =>
                          run(
                            () =>
                              notesApi.registryAction(communityId, {
                                action: 'register',
                                name: regName.trim() || (folderId ?? ''),
                                id: folderId ?? undefined,
                                visibility: regVisibility,
                              }),
                            'Folder registered',
                          )
                        }
                        disabled={busy || !folderId}
                        className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                      >
                        Register folder
                      </button>
                    </div>
                  </div>
                </div>
              ) : needsRequest ? (
                // ---------------- Private folder, non-member ----------------
                <div className="rounded-xl border border-border-subtle p-3">
                  <p className="text-sm text-text-secondary">
                    <span className="font-semibold text-text-primary">{folder.name}</span> is a private folder.
                    You’re not a member — ask a folder admin for access.
                  </p>
                  {myPendingRequest ? (
                    <p className="mt-2 text-sm text-text-muted">Your request is pending approval.</p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        value={joinMessage}
                        onChange={(e) => setJoinMessage(e.target.value)}
                        placeholder="Message to the folder admins (optional)"
                        rows={2}
                        className="w-full resize-none rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={() =>
                            run(
                              () => notesApi.requestJoin(communityId, folder.id, joinMessage.trim() || undefined),
                              'Access requested',
                            )
                          }
                          disabled={busy}
                          className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                        >
                          Request access
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // ---------------- Registered folder -------------------------
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between rounded-xl border border-border-subtle p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text-primary">
                        {folder.name}
                        {isGate && (
                          <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                            brain gate
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">
                        {isGate
                          ? "Controls who can access this community's brain at all"
                          : folder.visibility === 'private' ? '🔒 Private — members only' : 'Public — all members can read'}
                        {folder.myLevel ? ` · your level: ${folder.myLevel}` : ''}
                      </div>
                    </div>
                    {/* No unregister on the brain gate — removing it would re-open
                        the whole brain to every member. */}
                    {canAdmin && !isGate && (
                      <button
                        onClick={() =>
                          run(() => notesApi.registryAction(communityId, { action: 'unregister', folderId: folder.id }), 'Folder unregistered')
                        }
                        disabled={busy}
                        className="shrink-0 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                      >
                        Unregister
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-4 rounded-xl border border-border-subtle p-3">
                    <VisibilityPicker
                      value={folder.visibility}
                      disabled={busy || !canAdmin}
                      onChange={(v) =>
                        run(() => notesApi.registryAction(communityId, { action: 'setVisibility', folderId: folder.id, visibility: v }))
                      }
                    />
                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={!!folder.locked}
                        disabled={busy || !canAdmin}
                        onChange={(e) =>
                          run(() => notesApi.registryAction(communityId, { action: 'setLock', folderId: folder.id, locked: e.target.checked }))
                        }
                        className="accent-brand-green"
                      />
                      Locked (skip AI maintenance)
                    </label>
                  </div>

                  <div className="rounded-xl border border-border-subtle p-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Members</div>
                    {folder.members.length === 0 ? (
                      <div className="py-2 text-sm text-text-muted">No members yet.</div>
                    ) : (
                      folder.members.map((m) => (
                        <div key={m.userId} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-text-primary">{m.name || m.email || m.userId}</div>
                            {m.email && m.name && <div className="truncate text-xs text-text-muted">{m.email}</div>}
                          </div>
                          <select
                            value={m.level}
                            disabled={busy || !canAdmin}
                            onChange={(e) =>
                              run(() =>
                                notesApi.registryAction(communityId, {
                                  action: 'setMember',
                                  folderId: folder.id,
                                  member: { userId: m.userId, name: m.name, email: m.email },
                                  level: e.target.value as FolderLevel,
                                }),
                              )
                            }
                            className="rounded-lg border border-border-default bg-surface-1 px-2 py-1 text-xs text-text-primary outline-none focus:border-brand-green disabled:opacity-50"
                          >
                            {LEVELS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          {canAdmin && (
                            <button
                              onClick={() =>
                                run(() => notesApi.registryAction(communityId, { action: 'removeMember', folderId: folder.id, userId: m.userId }))
                              }
                              disabled={busy}
                              className="text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))
                    )}
                    {canAdmin && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
                        <input
                          value={addUserId}
                          onChange={(e) => setAddUserId(e.target.value)}
                          placeholder="User ID"
                          className="w-32 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
                        />
                        <input
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                          placeholder="Email (optional)"
                          className="w-32 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
                        />
                        <input
                          value={addName}
                          onChange={(e) => setAddName(e.target.value)}
                          placeholder="Name (optional)"
                          className="w-28 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
                        />
                        <select
                          value={addLevel}
                          onChange={(e) => setAddLevel(e.target.value as FolderLevel)}
                          className="rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-brand-green"
                        >
                          {LEVELS.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            run(
                              () =>
                                notesApi.registryAction(communityId, {
                                  action: 'setMember',
                                  folderId: folder.id,
                                  member: {
                                    userId: addUserId.trim(),
                                    email: addEmail.trim() || undefined,
                                    name: addName.trim() || undefined,
                                  },
                                  level: addLevel,
                                }),
                              'Member added',
                            ).then(() => {
                              setAddUserId('')
                              setAddEmail('')
                              setAddName('')
                            })
                          }
                          disabled={busy || !addUserId.trim()}
                          className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>

                  {canAdmin && pendingForFolder.length > 0 && (
                    <div className="rounded-xl border border-border-subtle p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {isGate ? 'Pending brain access requests' : 'Pending join requests'}
                      </div>
                      {pendingForFolder.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-text-primary">{r.name || r.email || r.userId}</div>
                            <div className="truncate text-xs text-text-muted">
                              {formatRelativeTime(r.requestedAt, Date.now())}
                              {r.message ? ` · “${r.message}”` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => run(() => notesApi.resolveJoinRequest(communityId, r.id, true), 'Request approved')}
                            disabled={busy}
                            className="text-xs font-semibold text-brand-dark-green hover:underline disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => run(() => notesApi.resolveJoinRequest(communityId, r.id, false))}
                            disabled={busy}
                            className="text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                          >
                            Deny
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: FolderVisibility
  onChange: (v: FolderVisibility) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border-default p-0.5">
      {(['public', 'private'] as const).map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => value !== v && onChange(v)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            value === v ? 'bg-brand-green text-white' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {v === 'public' ? 'Public' : '🔒 Private'}
        </button>
      ))}
    </div>
  )
}
