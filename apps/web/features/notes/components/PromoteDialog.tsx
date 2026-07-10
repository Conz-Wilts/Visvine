'use client'

// Share a note from the user's PERSONAL space into a community's brain — a
// one-time cross-community copy (the personal original stays). Step 1: pick a
// target community (the user's non-personal communities). Step 2: pick a
// destination folder the caller can write to in THAT community's brain (plus
// the brain root when the root gate grants write), tweak the path, and go.
// If the folder gate can't apply the copy directly, the server queues a
// proposal for the folder admins — surfaced here as a "queued" notice.

import { useEffect, useMemo, useState } from 'react'
import { notesApi, type RegistryFolder, type BrainGate } from '../lib/notesApi'

interface PromoteDialogProps {
  /** The user's non-personal communities (share targets). */
  targetCommunities: { id: string; name: string }[]
  /** Source path in the user's personal brain. */
  fromPath: string
  onClose: () => void
}

const ROOT = ''

type Outcome =
  | { kind: 'applied'; path: string; communityName: string }
  | { kind: 'queued'; folderId: string }

export function PromoteDialog({ targetCommunities, fromPath, onClose }: PromoteDialogProps) {
  const [targetId, setTargetId] = useState<string>(targetCommunities[0]?.id ?? '')
  // The target's registry: writable folders + whether the root gate grants write.
  const [folders, setFolders] = useState<RegistryFolder[] | null>(null)
  const [gate, setGate] = useState<BrainGate | null>(null)
  const [registryError, setRegistryError] = useState(false)
  const [folderId, setFolderId] = useState<string>(ROOT)
  const [toPath, setToPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const basename = useMemo(() => fromPath.split('/').pop() ?? fromPath, [fromPath])
  const targetName = targetCommunities.find((c) => c.id === targetId)?.name ?? targetId

  // Fetch the chosen target's registry. Root writability: an ungated brain keeps
  // the open pre-registry behavior (every member writes the root); a gated brain
  // grants root write only via the '' folder entry / gate level.
  useEffect(() => {
    if (!targetId) return
    setFolders(null)
    setGate(null)
    setRegistryError(false)
    setFolderId(ROOT)
    notesApi
      .getRegistry(targetId)
      .then(({ folders: f, gate: g }) => {
        setFolders(f.filter((x) => x.id !== ROOT && x.canWrite))
        setGate(g)
      })
      .catch(() => setRegistryError(true))
  }, [targetId])

  const rootWritable =
    gate !== null &&
    (!gate.gated || gate.myLevel === 'write' || gate.myLevel === 'admin')
  const canReadTarget = gate === null || gate.canRead
  const loadingRegistry = !registryError && folders === null

  // Keep the folder choice valid as options load/change.
  useEffect(() => {
    if (folders === null) return
    const valid = (id: string) => (id === ROOT ? rootWritable : folders.some((f) => f.id === id))
    setFolderId((cur) => (valid(cur) ? cur : rootWritable ? ROOT : folders[0]?.id ?? ROOT))
  }, [folders, rootWritable])

  // Default destination path tracks the folder choice.
  useEffect(() => {
    setToPath(folderId === ROOT ? basename : `${folderId}/${basename}`)
  }, [folderId, basename])

  const noWritableTarget = folders !== null && folders.length === 0 && !rootWritable

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await notesApi.promoteNote(targetId, fromPath, toPath.trim())
      if (result.status === 'applied') {
        setOutcome({ kind: 'applied', path: result.path, communityName: targetName })
      } else if (result.status === 'proposed') {
        setOutcome({ kind: 'queued', folderId })
      } else {
        setError(result.reason || 'Sharing denied')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share note')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Share to community</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>

        {outcome ? (
          <div className="p-4">
            <div className="rounded-xl border border-brand-green/30 bg-brand-light-bg px-3 py-2.5 text-sm text-brand-dark-green">
              {outcome.kind === 'applied' ? (
                <>
                  Shared — a copy now lives in <span className="font-semibold">{outcome.communityName}</span> at{' '}
                  <span className="font-mono">{outcome.path}</span>. Your personal note stays here; open that
                  community's Context page to see the shared copy.
                </>
              ) : (
                <>
                  Queued for approval — the copy will land once an admin of{' '}
                  <span className="font-semibold">{outcome.folderId || 'the brain root'}</span> approves it.
                </>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : targetCommunities.length === 0 ? (
          <div className="p-4">
            <p className="text-sm text-text-secondary">
              You're not a member of any community yet — join one to share notes into its brain.
            </p>
            <div className="mt-3 flex justify-end">
              <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted hover:bg-surface-2">
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <p className="text-sm text-text-secondary">
              Copy <span className="font-mono text-text-primary">{fromPath}</span> from your notes into a community's
              brain. Your personal note stays where it is.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Community</span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-green disabled:opacity-50"
              >
                {targetCommunities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            {loadingRegistry ? (
              <div className="py-2 text-center text-sm text-text-muted">Loading destinations…</div>
            ) : registryError || !canReadTarget ? (
              <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-muted">
                {registryError
                  ? "Couldn't load this community's folders — try again."
                  : "This community's brain is private and you don't have access to it yet."}
              </div>
            ) : noWritableTarget ? (
              <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-muted">
                You don't have write access to any folder in this community's brain.
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Destination folder</span>
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-green disabled:opacity-50"
                  >
                    {rootWritable && <option value={ROOT}>Brain root</option>}
                    {(folders ?? []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}{f.visibility === 'private' ? ' (private)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Destination path</span>
                  <input
                    value={toPath}
                    onChange={(e) => setToPath(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-brand-green disabled:opacity-50"
                  />
                </label>
                <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
                  <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted hover:bg-surface-2">
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy || !toPath.trim()}
                    className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                  >
                    {busy ? 'Sharing…' : 'Share'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
