'use client'

// The Share dialog — one place that answers "who can see this and why" and
// carries every sharing action (docs/brain-permissions-plan.md §9). Modeled on
// the Google Drive share dialog: an "Add people" typeahead on top, the computed
// people-with-access list (with per-row role menus — this list IS the audit),
// a General access section (Restricted ↔ Everyone in the community, plus the
// folder-inheritance boundary), published copies, and a Copy link / Done
// footer. All enforcement is server-side (/api/notes/access,
// /api/notes/publications) — this dialog only renders what the endpoints say
// the caller may do.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Users, UsersRound, Lock, Radio, Link2Off, Link as LinkIcon, Check } from 'lucide-react'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import {
  ACCESS_LEVELS,
  levelDisplayLabel,
  type AccessLevelName,
} from '@/lib/notes/shared/authz'
import type { AccessRequest } from '@/lib/notes/shared/brainTypes'
import {
  notesApi,
  type PathAccessResponse,
  type PublicationStateResponse,
} from '../lib/notesApi'
import { contextKeys, invalidateContextCache } from '../lib/contextPrefetch'

// The canonical level table (authz.ts) rendered with this panel's field names.
const LEVELS = ACCESS_LEVELS.map(({ name, label, hint }) => ({ value: name, label, hint }))

const levelLabel = levelDisplayLabel

const PERSONAL_ID_PREFIX = 'me:'

/** A person or team picked in the add-people input, waiting to be shared. */
interface PendingSubject {
  key: string // 'user:<id>' | 'team:<id>'
  type: 'user' | 'team'
  id: string
  name: string
}

interface SharePanelProps {
  communityId: string
  /** The note or folder the panel is about. */
  path: string
  kind: 'note' | 'folder'
  /** Overrides the derived display name (e.g. the admin-set context name for path ''). */
  title?: string
  onClose: () => void
}

export function SharePanel({ communityId, path, kind, title, onClose }: SharePanelProps) {
  const { joinedCommunities } = useCommunity()
  const isPersonalSpace = communityId.startsWith(PERSONAL_ID_PREFIX)
  const communityName = joinedCommunities.find((c) => c.id === communityId)?.name ?? 'the community'
  const displayName =
    title ?? (path === '' ? 'brain root' : (path.split('/').pop() ?? path).replace(/\.md$/, ''))

  const [access, setAccess] = useState<PathAccessResponse | null>(null)
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [pubs, setPubs] = useState<PublicationStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Add-people typeahead state.
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingSubject[]>([])
  const [pendingLevel, setPendingLevel] = useState<AccessLevelName>('view')
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Publish form.
  const [publishTarget, setPublishTarget] = useState('')
  const [publishPath, setPublishPath] = useState(path)

  // The folder whose restriction this panel manages: the folder itself, or the
  // note's containing folder ('' = root, which can't be restricted).
  const boundaryFolder = kind === 'folder' ? path : path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

  const reload = useCallback(() => {
    notesApi.getAccess(communityId, path).then(setAccess).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to load access')
    })
    if (kind === 'note') {
      notesApi.getPublications(communityId, path).then(setPubs).catch(() => setPubs(null))
    }
    if (!isPersonalSpace) {
      // Best-effort: the endpoint returns everything the caller may see, and the
      // block below narrows it to open requests for THIS path.
      notesApi.listAccessRequests(communityId).then(({ requests: r }) => setRequests(r)).catch(() => setRequests([]))
    }
  }, [communityId, path, kind, isPersonalSpace])

  useEffect(() => {
    reload()
  }, [reload])

  const afterMutation = useCallback(() => {
    // Access changed: the caller's own read/write answers may have too.
    invalidateContextCache(
      contextKeys.access(communityId, path),
      contextKeys.list(communityId),
      contextKeys.tree(communityId),
    )
    reload()
  }, [communityId, path, reload])

  const run = useCallback(
    async (fn: () => Promise<unknown>, successNotice?: string) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        await fn()
        if (successNotice) setNotice(successNotice)
        afterMutation()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    },
    [afterMutation],
  )

  const grant = (subjectType: 'community' | 'team' | 'user', subjectId: string, lvl: AccessLevelName) =>
    notesApi.accessAction(communityId, { action: 'grant', subjectType, subjectId, path, level: lvl })

  const sharePending = () =>
    run(async () => {
      for (const s of pending) await grant(s.type, s.id, pendingLevel)
      setPending([])
      setQuery('')
    })

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending' && r.resourcePath === path),
    [requests, path],
  )

  const resolveRequest = (id: string, approve: boolean) =>
    run(
      () => notesApi.resolveAccessRequest(communityId, id, approve),
      approve ? undefined : 'Request denied.',
    )

  const revokeGrants = (grantIds: string[]) =>
    run(async () => {
      for (const id of grantIds) await notesApi.accessAction(communityId, { action: 'revoke', grantId: id })
    })

  const isRestricted = access?.restricted.includes(boundaryFolder) ?? false
  const toggleRestrict = () => {
    const confirmText = isRestricted
      ? `Open up "${boundaryFolder}"? Access from parent folders will flow in again.`
      : `Limit "${boundaryFolder}"? Only people or teams added on this folder (and community admins) will see inside — everyone else loses access to it.`
    if (!window.confirm(confirmText)) return
    void run(() =>
      notesApi.accessAction(communityId, {
        action: 'restrict',
        folderPath: boundaryFolder,
        restricted: !isRestricted,
      }),
    )
  }

  const publish = () =>
    run(async () => {
      const result = await notesApi.publish(publishTarget, {
        fromCommunityId: communityId,
        fromPath: path,
        toPath: publishPath.trim() || path,
      })
      if (result.status === 'proposed') {
        setNotice('You can’t write there directly — the publish request was sent for approval.')
      }
    })

  const unlink = (id: string) =>
    run(() => notesApi.unpublish(communityId, id), 'Unlinked — the copy stays, no longer syncing.')

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const publishTargets = useMemo(
    () => joinedCommunities.filter((c) => c.id !== communityId && !c.id.startsWith(PERSONAL_ID_PREFIX)),
    [joinedCommunities, communityId],
  )

  const entries = access?.entries ?? []
  const communityEntry = entries.find((e) => e.subjectType === 'community') ?? null
  const peopleEntries = entries.filter((e) => e.subjectType !== 'community')

  // Typeahead suggestions: members and teams matching the query, minus anyone
  // already picked. People already on the list can be re-picked to change role,
  // but the per-row menu is the cleaner path, so we leave them out too.
  const suggestions = useMemo(() => {
    if (!access?.subjects) return []
    const q = query.trim().toLowerCase()
    const taken = new Set([
      ...pending.map((p) => p.key),
      ...peopleEntries.map((e) => `${e.subjectType}:${e.subjectId}`),
    ])
    const teams = access.subjects.teams
      .filter((t) => !taken.has(`team:${t.id}`) && (!q || t.name.toLowerCase().includes(q)))
      .map((t) => ({ key: `team:${t.id}`, type: 'team' as const, id: t.id, name: t.name, sub: `Team · ${t.memberCount} member${t.memberCount === 1 ? '' : 's'}`, image: null as string | null }))
    const members = access.subjects.members
      .filter(
        (m) =>
          !taken.has(`user:${m.userId}`) &&
          (!q || m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)),
      )
      .map((m) => ({ key: `user:${m.userId}`, type: 'user' as const, id: m.userId, name: m.name, sub: m.email ?? '', image: m.image }))
    return [...teams, ...members].slice(0, 8)
  }, [access?.subjects, query, pending, peopleEntries])

  const memberImage = (userId: string) =>
    access?.subjects?.members.find((m) => m.userId === userId)?.image ?? null

  const avatar = (type: string, name: string, image: string | null) =>
    type === 'team' ? (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted">
        <UsersRound className="h-4 w-4" />
      </span>
    ) : image ? (
      <img src={image} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
    ) : (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-sm font-semibold text-brand-green">
        {(name[0] ?? '?').toUpperCase()}
      </span>
    )

  // A native select doubling as Google's role menu: levels + a Remove option.
  const roleMenu = (
    current: string | null,
    onLevel: (l: AccessLevelName) => void,
    onRemove?: () => void,
  ) => (
    <select
      value={current ?? 'view'}
      disabled={busy}
      onChange={(e) => {
        if (e.target.value === '__remove') onRemove?.()
        else onLevel(e.target.value as AccessLevelName)
      }}
      className="h-8 shrink-0 cursor-pointer rounded-lg border border-transparent bg-transparent px-1.5 text-sm text-text-secondary transition hover:border-border-default hover:bg-surface-2 disabled:opacity-40"
    >
      {LEVELS.map((l) => (
        <option key={l.value} value={l.value} title={l.hint}>
          {l.label}
        </option>
      ))}
      {onRemove && <option value="__remove">Remove access</option>}
    </select>
  )

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/30 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-1 shadow-float">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h3 className="min-w-0 truncate text-[17px] font-semibold text-text-primary">
            Share “{displayName}”
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted transition hover:bg-surface-2 hover:text-text-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          {notice && (
            <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">
              {notice}
            </div>
          )}

          {isPersonalSpace ? (
            <p className="text-sm text-text-muted">
              This note lives in your personal brain — only you can see it. Publish it into a community
              below to share a live copy.
            </p>
          ) : access === null ? (
            <div className="animate-pulse space-y-2 py-2">
              <div className="h-4 w-2/3 rounded bg-surface-2" />
              <div className="h-4 w-1/2 rounded bg-surface-2" />
            </div>
          ) : (
            <>
              {/* Add people and teams */}
              {access.canManage && access.subjects && (
                <div className="relative">
                  <div
                    className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-border-default bg-surface-1 px-2.5 py-1.5 transition focus-within:border-brand-green"
                    onClick={() => inputRef.current?.focus()}
                  >
                    {pending.map((p) => (
                      <span
                        key={p.key}
                        className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-1 text-sm text-text-primary"
                      >
                        {p.name}
                        <button
                          type="button"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}
                          className="rounded-full p-0.5 text-text-muted hover:text-text-primary"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                      placeholder={pending.length === 0 ? 'Add people and teams' : ''}
                      className="min-w-[120px] flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                    />
                    {pending.length > 0 &&
                      roleMenu(pendingLevel, (l) => setPendingLevel(l))}
                  </div>

                  {inputFocused && suggestions.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-border-default bg-surface-1 py-1 shadow-float">
                      {suggestions.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setPending((prev) => [...prev, { key: s.key, type: s.type, id: s.id, name: s.name }])
                            setQuery('')
                            inputRef.current?.focus()
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-surface-2"
                        >
                          {avatar(s.type, s.name, s.image)}
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-text-primary">{s.name}</span>
                            {s.sub && <span className="block truncate text-[11px] text-text-muted">{s.sub}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {pending.length > 0 && (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPending([])
                          setQuery('')
                        }}
                        className="h-8 rounded-lg px-3 text-sm font-medium text-text-secondary transition hover:bg-surface-2"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void sharePending()}
                        className="h-8 rounded-lg bg-brand-green px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                      >
                        Share
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Waiting for access — requests filed against THIS path. The
                  console queue covers community admins; this block is the only
                  place a non-admin folder manager can resolve their own. */}
              {access.canManage && openRequests.length > 0 && (
                <section>
                  <h4 className="mb-1 text-sm font-semibold text-text-primary">
                    Waiting for access ({openRequests.length})
                  </h4>
                  <div className="-mx-2">
                    {openRequests.map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                        {avatar('user', r.requesterName ?? 'Member', r.requesterImage ?? null)}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {r.requesterName ?? 'Member'}
                          </div>
                          <div className="truncate text-[11px] text-text-muted">
                            {r.message ? `“${r.message}”` : (r.requesterEmail ?? 'Asked for access')}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resolveRequest(r.id, true)}
                          className="h-7 shrink-0 rounded-lg bg-brand-green px-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resolveRequest(r.id, false)}
                          className="h-7 shrink-0 rounded-lg border border-border-default px-2.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 disabled:opacity-40"
                        >
                          Deny
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* People with access */}
              <section>
                <h4 className="mb-1 text-sm font-semibold text-text-primary">People with access</h4>
                <div className="-mx-2">
                  {peopleEntries.map((entry) => {
                    const directGrantIds = entry.grants
                      .filter((g) => g.resourcePath === path)
                      .map((g) => g.id)
                    const editable = access.canManage && entry.via === path && directGrantIds.length > 0
                    return (
                      <div
                        key={`${entry.subjectType}:${entry.subjectId}`}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                      >
                        {avatar(entry.subjectType, entry.name, entry.subjectType === 'user' ? memberImage(entry.subjectId) : null)}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">{entry.name}</div>
                          <div className="truncate text-[11px] text-text-muted">
                            {entry.subjectType === 'team' && 'Team · '}
                            {entry.via === path
                              ? entry.email ?? (kind === 'note' ? 'Added on this note' : 'Added on this folder')
                              : entry.via === ''
                                ? 'Inherited from the brain root'
                                : `Inherited from ${entry.via}/`}
                          </div>
                        </div>
                        {editable ? (
                          roleMenu(
                            entry.levelName,
                            (l) => void run(() => grant(entry.subjectType as 'team' | 'user', entry.subjectId, l)),
                            () => void revokeGrants(directGrantIds),
                          )
                        ) : (
                          <span className="shrink-0 pr-1.5 text-sm text-text-muted">{levelLabel(entry.levelName)}</span>
                        )}
                      </div>
                    )
                  })}
                  {peopleEntries.length === 0 && !communityEntry && (
                    <p className="px-2 py-1 text-sm text-text-muted">
                      No one has been added yet — only community admins can see this.
                    </p>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  Community admins always have full access · You: {levelLabel(access.myLevel)}
                </p>
              </section>

              {/* General access */}
              <section>
                <h4 className="mb-1 text-sm font-semibold text-text-primary">General access</h4>
                <div className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      communityEntry ? 'bg-brand-green/15 text-brand-green' : 'bg-surface-2 text-text-muted'
                    }`}
                  >
                    {communityEntry ? <Users className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    {access.canManage && (!communityEntry || communityEntry.via === path) ? (
                      <select
                        value={communityEntry ? 'community' : 'restricted'}
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value === 'community') {
                            void run(() => grant('community', '', 'view'))
                          } else if (communityEntry) {
                            void revokeGrants(
                              communityEntry.grants.filter((g) => g.resourcePath === path).map((g) => g.id),
                            )
                          }
                        }}
                        className="-ml-1.5 h-8 max-w-full cursor-pointer rounded-lg border border-transparent bg-transparent pl-1 pr-1.5 text-sm font-medium text-text-primary transition hover:border-border-default hover:bg-surface-2 disabled:opacity-40"
                      >
                        <option value="restricted">Restricted</option>
                        <option value="community">Everyone in {communityName}</option>
                      </select>
                    ) : (
                      <div className="text-sm font-medium text-text-primary">
                        {communityEntry ? `Everyone in ${communityName}` : 'Restricted'}
                      </div>
                    )}
                    <div className="truncate text-[11px] text-text-muted">
                      {communityEntry
                        ? communityEntry.via === path
                          ? `Anyone in this community can ${levelLabel(communityEntry.levelName).toLowerCase() === 'viewer' ? 'view' : 'access'} this`
                          : `Inherited from ${communityEntry.via === '' ? 'the brain root' : `${communityEntry.via}/`}`
                        : 'Only people added above and community admins'}
                    </div>
                  </div>
                  {communityEntry &&
                    (access.canManage && communityEntry.via === path ? (
                      roleMenu(communityEntry.levelName, (l) => void run(() => grant('community', '', l)))
                    ) : (
                      <span className="shrink-0 pr-1.5 text-sm text-text-muted">
                        {levelLabel(communityEntry.levelName)}
                      </span>
                    ))}
                </div>

                {access.canManage && boundaryFolder !== '' && (
                  <button
                    type="button"
                    onClick={toggleRestrict}
                    disabled={busy}
                    className="-mx-2 mt-0.5 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2 disabled:opacity-40"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isRestricted ? 'bg-amber-500/15 text-amber-500' : 'bg-surface-2 text-text-muted'
                      }`}
                    >
                      <Lock className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text-primary">
                        {isRestricted ? `“${boundaryFolder}/” is limited` : `Limit “${boundaryFolder}/”`}
                      </span>
                      <span className="block text-[11px] text-text-muted">
                        {isRestricted
                          ? 'Access from parent folders is cut off — click to open it up again'
                          : 'Cut off access inherited from parent folders'}
                      </span>
                    </span>
                  </button>
                )}
              </section>
            </>
          )}

          {/* Published copies */}
          {kind === 'note' && (pubs?.asTarget || (pubs?.asSource ?? []).length > 0 || publishTargets.length > 0) && (
            <section>
              <h4 className="mb-1 text-sm font-semibold text-text-primary">Published copies</h4>
              {pubs?.asTarget && (
                <div className="mb-1 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm">
                  <Radio className="h-4 w-4 shrink-0 text-brand-green" />
                  <span className="min-w-0 flex-1 text-text-secondary">
                    Published from <span className="font-medium">{pubs.asTarget.sourceCommunityName}</span> — read-only
                    here.
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void unlink(pubs.asTarget!.id)}
                    className="shrink-0 rounded p-1 text-text-muted transition hover:text-red-500 disabled:opacity-40"
                    title="Unlink (keep as an editable copy)"
                  >
                    <Link2Off className="h-4 w-4" />
                  </button>
                </div>
              )}
              {(pubs?.asSource ?? []).map((pub) => (
                <div key={pub.id} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <Radio className={`h-4 w-4 shrink-0 ${pub.active ? 'text-brand-green' : 'text-text-muted'}`} />
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    → {pub.targetCommunityName} · {pub.targetPath}
                    {!pub.active && ' (unlinked)'}
                  </span>
                  {pub.active && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void unlink(pub.id)}
                      className="shrink-0 rounded p-1 text-text-muted transition hover:text-red-500 disabled:opacity-40"
                      title="Unlink (the copy stays, no longer syncing)"
                    >
                      <Link2Off className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}

              {publishTargets.length > 0 && (
                <div className="mt-1.5 space-y-2 rounded-xl border border-border-default p-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={publishTarget}
                      onChange={(e) => setPublishTarget(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 text-sm text-text-primary"
                    >
                      <option value="">Publish a live copy to…</option>
                      {publishTargets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !publishTarget}
                      onClick={() => void publish()}
                      className="h-8 shrink-0 rounded-lg bg-brand-green px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                    >
                      Publish
                    </button>
                  </div>
                  {publishTarget && (
                    <input
                      value={publishPath}
                      onChange={(e) => setPublishPath(e.target.value)}
                      placeholder="Destination path, e.g. research/canva.md"
                      className="h-8 w-full rounded-lg border border-border-default bg-surface-1 px-2 text-sm text-text-primary"
                    />
                  )}
                  <p className="text-[11px] text-text-muted">
                    The note stays yours here; a synced copy lives in the chosen community and updates on
                    every save. Unlink any time — the copy remains.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
          {kind === 'note' ? (
            <button
              type="button"
              onClick={copyLink}
              className="flex h-9 items-center gap-2 rounded-full border border-border-default px-4 text-sm font-medium text-text-primary transition hover:bg-surface-2"
            >
              {copied ? <Check className="h-4 w-4 text-brand-green" /> : <LinkIcon className="h-4 w-4" />}
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full bg-brand-green px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
