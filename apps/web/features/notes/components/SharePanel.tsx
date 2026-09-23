'use client'

// The Share dialog — one place that answers "who can see this and why" and
// carries every sharing action. Modeled closely on the Google Drive share
// dialog, both in behaviour and in shape:
//
//   • Two modes, like Drive. Picking people switches the whole body into a
//     focused "add" step (chips + one role + Share/Cancel) instead of leaving a
//     half-filled input hanging above the audit list.
//   • The people list IS the audit: one row per subject, each labelled with the
//     grant that explains it ("Added on this note" / "Inherited from x/").
//   • Drive's inheritance rule: an inherited role can be RAISED on the child
//     (that just writes a direct grant, and our effective level is the max) but
//     never lowered or removed here — you go to the folder it came from, or cut
//     the boundary with limited access.
//   • General access = Restricted ↔ Everyone in the space, plus the
//     limited-access boundary (Drive's "disable inherited permissions").
//   • As little prose as Drive: a row is a name, one muted line, and a role.
//     What a setting does is in its tooltip, not beside every control.
//
// All enforcement is server-side (/api/notes/access) — this dialog only
// renders what that endpoint says the caller may do.

import { useSpaceHref } from '@/features/shared/contexts/SpaceContext'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BotIcon, CheckIcon, ChevronDownIcon, Link2Icon, LockIcon, LockOpenIcon, UsersIcon, UsersRoundIcon, XIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey'
import { useCopied } from '@/features/shared/hooks/useCopied'
import { noteHref } from '@/lib/notes/entities'
import { humanizeFolderName } from '@/lib/notes/shared/indexNote'
import Avatar from '@/components/ui/Avatar'
import Toggle from '@/components/ui/Toggle'
import {
  ACCESS_LEVELS,
  levelDisplayLabel,
  type AccessLevelName,
} from '@/lib/notes/shared/authz'
import type { AccessRequest } from '@/lib/notes/shared/contextTypes'
import { notesApi, type PathAccessResponse } from '../lib/notesApi'
import { contextKeys, invalidateContextCache } from '../lib/contextPrefetch'

const PERSONAL_ID_PREFIX = 'me:'

/** A person or alias picked in the add-people input, waiting to be shared. */
interface PendingSubject {
  key: string // 'user:<id>' | 'alias:<id>'
  type: 'user' | 'alias'
  id: string
  name: string
  image: string | null
}

// role menu

/**
 * How many PickerMenus are open. Escape is layered: it must close the topmost
 * thing only, so while a menu is open the dialog's own Escape handler stands
 * down (both listen on `document`, so neither can stop the other).
 */
let openMenuCount = 0

/** Where a popover should sit, in viewport coordinates. */
interface AnchorPos {
  top?: number
  bottom?: number
  left?: number
  right?: number
  width?: number
  maxHeight: number
}

/** Smallest popover worth opening downwards before flipping above the anchor. */
const POPOVER_MIN_SPACE = 180
const POPOVER_MARGIN = 12

/**
 * Pins a popover to an anchor element in viewport coordinates. Both popovers in
 * this dialog have to escape the scrolling body — an absolutely positioned menu
 * would be clipped by it (and would stretch the dialog's own scrollbar), so they
 * render `fixed` through a portal and re-measure on scroll/resize instead.
 *
 * `align`: 'right' pins the popover's right edge to the anchor's (role menus),
 * 'stretch' matches the anchor's full width (the typeahead). The popover flips
 * above the anchor when there isn't room below, and always reports the height
 * it may occupy so it scrolls internally rather than running off-screen.
 */
function useAnchorPos(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  align: 'right' | 'left' | 'stretch',
): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - POPOVER_MARGIN
      const above = r.top - POPOVER_MARGIN
      // Flip up only when below is genuinely cramped AND above is roomier.
      const flip = below < POPOVER_MIN_SPACE && above > below
      const side = flip
        ? { bottom: window.innerHeight - r.top + 4, maxHeight: above }
        : { top: r.bottom + 4, maxHeight: below }
      const x =
        align === 'stretch'
          ? { left: r.left, width: r.width }
          : align === 'left'
            ? { left: r.left }
            : { right: window.innerWidth - r.right }
      setPos({ ...side, ...x })
    }
    place()
    window.addEventListener('resize', place)
    // `true` = capture, so scrolling any ancestor (the dialog body) re-places it.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [ref, open, align])

  return pos
}

/** Marks a popover open for the layered-Escape check while it is mounted. */
function useCountsAsOpenMenu(open: boolean) {
  useEffect(() => {
    if (!open) return
    openMenuCount += 1
    return () => {
      openMenuCount -= 1
    }
  }, [open])
}

interface MenuItem {
  value: string
  label: string
  hint?: string
  /** Rendered red and under a divider — "Remove access". */
  danger?: boolean
}

/**
 * Drive's picker: a text trigger that opens a menu of options with their hints
 * and a check on the current one. A native <select> can't show the hints and
 * can't be styled to match, so this is hand-rolled — positioned `fixed` off the
 * trigger's rect because the dialog body scrolls and would otherwise clip it.
 *
 * Used for both the per-row role menus and the General access picker so the two
 * read as the same control.
 */
function PickerMenu({
  current,
  items,
  onPick,
  disabled,
  /** Rendered instead of the current item's label. */
  label,
  /** Bigger, primary-coloured trigger — used by the General access row. */
  emphasis,
  align = 'right',
}: {
  current: string | null
  items: MenuItem[]
  onPick: (value: string) => void
  disabled?: boolean
  label?: string
  emphasis?: boolean
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pos = useAnchorPos(triggerRef, open, align)

  useEscapeKey(() => setOpen(false), open)
  useCountsAsOpenMenu(open)

  const currentLabel = label ?? items.find((i) => i.value === current)?.label ?? ''

  // Nothing to choose between: render the current value as plain text so a
  // read-only viewer doesn't get a dead-end control.
  if (items.length === 0) {
    return <span className="shrink-0 pr-1.5 text-sm text-fg-muted">{currentLabel}</span>
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 shrink-0 items-center gap-1 rounded-lg border border-transparent transition hover:border-line hover:bg-surface-subtle disabled:opacity-40 ${
          emphasis
            ? '-ml-2 px-2 text-sm font-medium text-fg'
            : 'px-2 text-sm text-fg-secondary'
        }`}
      >
        {currentLabel}
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[95]" onMouseDown={() => setOpen(false)} />
            <div
              role="menu"
              style={{ ...pos, maxHeight: Math.min(pos.maxHeight, 320) }}
              className="fixed z-[96] w-64 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface py-1 shadow-float"
            >
              {items.map((item, i) => (
                <div key={item.value}>
                  {item.danger && i > 0 && <div className="my-1 border-t border-line-subtle" />}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onPick(item.value)
                      setOpen(false)
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition hover:bg-surface-subtle"
                  >
                    <span className="w-4 shrink-0 pt-0.5">
                      {current === item.value && !item.danger && (
                        <CheckIcon className="h-4 w-4 text-accent" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-sm ${item.danger ? 'text-danger' : 'text-fg'}`}
                      >
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="block text-[11px] leading-snug text-fg-muted">
                          {item.hint}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

/** The level picker built on PickerMenu, with an optional "Remove access". */
function RoleMenu({
  current,
  levels,
  onLevel,
  onRemove,
  disabled,
}: {
  current: AccessLevelName | string | null
  levels: readonly AccessLevelName[]
  onLevel: (l: AccessLevelName) => void
  onRemove?: () => void
  disabled?: boolean
}) {
  const items: MenuItem[] = ACCESS_LEVELS.filter((l) => levels.includes(l.name)).map((l) => ({
    value: l.name,
    label: l.label,
    hint: l.hint,
  }))
  if (onRemove) items.push({ value: '__remove', label: 'Remove access', danger: true })

  return (
    <PickerMenu
      current={current}
      items={items}
      disabled={disabled}
      // Always the effective level: on an upgrade-only (inherited) row the
      // current level isn't among the offered items, so it can't be derived.
      label={levelDisplayLabel(current)}
      onPick={(v) => (v === '__remove' ? onRemove?.() : onLevel(v as AccessLevelName))}
    />
  )
}

// small shared bits

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 text-sm font-semibold text-fg">{children}</h4>
}

/** Avatar for a row: the shared square Avatar for people, a tile for aliases. */
function SubjectAvatar({
  type,
  name,
  image,
  size = 'md',
}: {
  type: string
  name: string
  image: string | null
  /** 'chip' for the compact pills in the add step. */
  size?: 'md' | 'chip'
}) {
  if (type === 'alias') {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-fg-muted ${
          size === 'chip' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9'
        }`}
      >
        <UsersRoundIcon className={size === 'chip' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </span>
    )
  }
  return <Avatar name={name} imageUrl={image} size={size} className="shrink-0" />
}

/** The icon tile used by the General access rows. Amber, not green, marks a
 *  cut boundary — green would read as "open", the opposite of what it means. */
function IconTile({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'brand' | 'red'
  children: React.ReactNode
}) {
  const tones = {
    muted: 'bg-surface-subtle text-fg-muted',
    brand: 'bg-accent/15 text-accent',
    red: 'bg-danger-bright/15 text-danger',
  }
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
      {children}
    </span>
  )
}

const ROW_CLASS = 'flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-surface-subtle'

const ALL_LEVELS = ACCESS_LEVELS.map((l) => l.name)

// the dialog

interface SharePanelProps {
  spaceId: string
  /** The note or folder the panel is about. */
  path: string
  kind: 'note' | 'folder'
  /** Overrides the derived display name (e.g. the admin-set context name for path ''). */
  title?: string
  /** One more section under the people — what sharing THIS thing also decides (an agent: who it runs for). */
  extra?: React.ReactNode
  onClose: () => void
}

export function SharePanel({ spaceId, path, kind, title, extra, onClose }: SharePanelProps) {
  const { joinedSpaces } = useSpace()
  const isPersonalSpace = spaceId.startsWith(PERSONAL_ID_PREFIX)
  const spaceName = joinedSpaces.find((c) => c.id === spaceId)?.name ?? 'the space'
  // A folder's index note is the folder, so it goes by the folder's name.
  const displayName =
    title ??
    (path === ''
      ? 'context root'
      : humanizeFolderName(
          (path.replace(/\/?index\.md$/i, '').split('/').pop() ?? path).replace(/\.md$/i, ''),
        ))

  const [access, setAccess] = useState<PathAccessResponse | null>(null)
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Add-people typeahead state. `pending.length > 0` puts the dialog in add mode.
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingSubject[]>([])
  const [pendingLevel, setPendingLevel] = useState<AccessLevelName>('view')
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const typeaheadRef = useRef<HTMLDivElement>(null)

  const [copied, copy] = useCopied()
  const spaceHref = useSpaceHref()

  const adding = pending.length > 0

  useEscapeKey(() => {
    if (!busy && openMenuCount === 0) onClose()
  })

  const reload = useCallback(() => {
    notesApi.getAccess(spaceId, path).then(setAccess).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to load access')
    })
    if (!isPersonalSpace) {
      // Best-effort: the endpoint returns everything the caller may see, and the
      // block below narrows it to open requests for THIS path.
      notesApi
        .listAccessRequests(spaceId)
        .then(({ requests: r }) => setRequests(r))
        .catch(() => setRequests([]))
    }
  }, [spaceId, path, isPersonalSpace])

  useEffect(() => {
    reload()
  }, [reload])

  const afterMutation = useCallback(() => {
    // Access changed: the caller's own read/write answers may have too.
    invalidateContextCache(
      contextKeys.access(spaceId, path),
      contextKeys.list(spaceId),
      contextKeys.tree(spaceId),
    )
    reload()
  }, [spaceId, path, reload])

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

  const grant = (
    subjectType: 'space' | 'alias' | 'user',
    subjectId: string,
    lvl: AccessLevelName,
  ) => notesApi.accessAction(spaceId, { action: 'grant', subjectType, subjectId, path, level: lvl })

  const cancelAdd = () => {
    setPending([])
    setQuery('')
    setPendingLevel('view')
    // Leaving the add step lands back on the list, not in the typeahead —
    // otherwise a stale focus flag reopens the suggestions over the results.
    setInputFocused(false)
    inputRef.current?.blur()
  }

  const sharePending = () =>
    run(async () => {
      for (const s of pending) await grant(s.type, s.id, pendingLevel)
      cancelAdd()
    }, `Shared with ${pending.length} ${pending.length === 1 ? 'person or alias' : 'people and aliases'}.`)

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending' && r.resourcePath === path),
    [requests, path],
  )

  const resolveRequest = (id: string, approve: boolean) =>
    run(() => notesApi.resolveAccessRequest(spaceId, id, approve), approve ? undefined : 'Request denied.')

  const revokeGrants = (grantIds: string[]) =>
    run(async () => {
      for (const id of grantIds) await notesApi.accessAction(spaceId, { action: 'revoke', grantId: id })
    })

  // The restriction boundary is the panel's own subject: a folder limits the
  // folder, a note makes itself private (authz's grantReaches doesn't care
  // which it is). Only the root ('') can never be restricted.
  const isRestricted = access?.restricted.includes(path) ?? false

  // The row's title stays put — the toggle carries the state, so it must not
  // read as a different setting depending on which way it is flipped.
  const restrictCopy = {
    note: {
      on: 'Access inherited from the folders above is cut off',
      off: 'People with access to the folders above can see this note',
    },
    folder: {
      on: 'Access inherited from the parent folders is cut off',
      off: 'People with access to the parent folders can see inside',
    },
  }[kind]

  const restrictRow = {
    title: 'Lock access',
    hint: isRestricted ? restrictCopy.on : restrictCopy.off,
  }

  const toggleRestrict = () =>
    run(() =>
      notesApi.accessAction(spaceId, {
        action: 'restrict',
        folderPath: path,
        restricted: !isRestricted,
      }),
    )

  // Locking is orthogonal to who can read: it freezes a folder against the AI
  // maintenance passes (review fixes, reorganize, enrichment). It lives here
  // because this panel is the one place a folder's settings are managed.
  const isLocked = access?.locked?.includes(path) ?? false

  const toggleLock = () =>
    run(() =>
      notesApi.accessAction(spaceId, {
        action: 'setLock',
        folderPath: path,
        locked: !isLocked,
      }),
    )

  const entries = useMemo(() => access?.entries ?? [], [access?.entries])
  const spaceEntry = entries.find((e) => e.subjectType === 'space') ?? null
  const myUserId = access?.me.userId

  // Drive's ordering: you first, then everyone granted right here, then the
  // inherited rows — so the list reads "this note" before "the folders above".
  const peopleEntries = useMemo(() => {
    const rows = entries.filter((e) => e.subjectType !== 'space')
    const rank = (e: (typeof rows)[number]) =>
      e.subjectType === 'user' && e.subjectId === myUserId ? 0 : e.via === path ? 1 : 2
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [entries, myUserId, path])

  // Typeahead suggestions: members and aliases matching the query, minus anyone
  // already picked. People already on the list can be re-picked to change role,
  // but the per-row menu is the cleaner path, so we leave them out too.
  const suggestions = useMemo(() => {
    if (!access?.subjects) return []
    const q = query.trim().toLowerCase()
    const taken = new Set([
      ...pending.map((p) => p.key),
      ...peopleEntries.map((e) => `${e.subjectType}:${e.subjectId}`),
    ])
    const aliases = access.subjects.aliases
      .filter((a) => !taken.has(`alias:${a.id}`) && (!q || a.name.toLowerCase().includes(q)))
      .map((a) => ({
        // Keyed by id, matching the grant rows — a rename must not make an
        // already-granted alias look un-granted.
        key: `alias:${a.id}`,
        type: 'alias' as const,
        id: a.id,
        name: a.name,
        sub: a.admin
          ? 'Alias · admin of the space'
          : `Alias · ${a.holderCount} ${a.holderCount === 1 ? 'person' : 'people'}`,
        image: null as string | null,
      }))
    const members = access.subjects.members
      .filter(
        (m) =>
          !taken.has(`user:${m.userId}`) &&
          (!q || m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)),
      )
      .map((m) => ({
        key: `user:${m.userId}`,
        type: 'user' as const,
        id: m.userId,
        name: m.name,
        sub: m.email ?? '',
        image: m.image,
      }))
    return [...aliases, ...members].slice(0, 8)
  }, [access?.subjects, query, pending, peopleEntries])

  // The typeahead results are a popover like the role menus — same escape hatch
  // out of the scrolling body, same layered-Escape bookkeeping.
  const suggestOpen = !adding && inputFocused && suggestions.length > 0
  const suggestPos = useAnchorPos(typeaheadRef, suggestOpen, 'stretch')
  useCountsAsOpenMenu(suggestOpen)
  useEscapeKey(() => {
    setInputFocused(false)
    inputRef.current?.blur()
  }, suggestOpen)

  const memberImage = (userId: string) =>
    access?.subjects?.members.find((m) => m.userId === userId)?.image ?? null

  /** Levels a manager may set on a row, per Drive's inheritance rule: a direct
   *  grant is fully editable; an inherited one may only be RAISED (which writes
   *  a direct grant here), never lowered or removed from this screen. */
  const editableLevels = (level: number, direct: boolean): AccessLevelName[] =>
    direct
      ? ALL_LEVELS
      : ACCESS_LEVELS.filter((l) => l.level > level).map((l) => l.name)

  const canManage = access?.canManage ?? false

  // rendering

  const addStep = (
    <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line px-2.5 py-2">
        {pending.map((p) => (
          <span
            key={p.key}
            className="flex items-center gap-1.5 rounded-full bg-surface-subtle py-0.5 pl-1 pr-1.5 text-sm text-fg"
          >
            <SubjectAvatar type={p.type} name={p.name} image={p.image} size="chip" />
            {p.name}
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}
              className="rounded-full p-0.5 text-fg-muted transition hover:text-fg"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-secondary">Role</span>
        <RoleMenu
          current={pendingLevel}
          levels={ALL_LEVELS}
          onLevel={setPendingLevel}
          disabled={busy}
        />
      </div>
    </>
  )

  const browseStep = access === null ? (
    <div className="animate-pulse space-y-2 py-2">
      <div className="h-4 w-2/3 rounded bg-surface-subtle" />
      <div className="h-4 w-1/2 rounded bg-surface-subtle" />
    </div>
  ) : (
    <>
      {/* Add people and aliases */}
      {canManage && access.subjects && (
        <div
          ref={typeaheadRef}
          className="flex min-h-[42px] items-center rounded-xl border border-line bg-surface px-3 py-1.5 transition focus-within:border-accent"
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setTimeout(() => setInputFocused(false), 150)}
            placeholder="Add people and aliases"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
        </div>
      )}

      {/* Waiting for access — requests filed against THIS path. Admin-only,
          like every other mutation here; it saves a trip to the console queue
          when you're already looking at the resource. */}
      {canManage && openRequests.length > 0 && (
        <section>
          <SectionHeading>Waiting for access ({openRequests.length})</SectionHeading>
          <div className="-mx-2">
            {openRequests.map((r) => (
              <div key={r.id} className={ROW_CLASS}>
                <SubjectAvatar type="user" name={r.requesterName ?? 'Member'} image={r.requesterImage ?? null} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">
                    {r.requesterName ?? 'Member'}
                  </div>
                  <div className="truncate text-[11px] text-fg-muted">
                    {r.message ? `“${r.message}”` : (r.requesterEmail ?? 'Asked for access')}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveRequest(r.id, true)}
                  className="h-7 shrink-0 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveRequest(r.id, false)}
                  className="h-7 shrink-0 rounded-lg border border-line px-2.5 text-xs font-semibold text-fg-secondary transition hover:bg-surface-subtle disabled:opacity-40"
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
        <SectionHeading>People with access</SectionHeading>
        <div className="-mx-2">
          {peopleEntries.map((entry) => {
            const directGrantIds = entry.grants.filter((g) => g.resourcePath === path).map((g) => g.id)
            const direct = entry.via === path && directGrantIds.length > 0
            const isMe = entry.subjectType === 'user' && entry.subjectId === myUserId
            const levels = canManage ? editableLevels(entry.level, direct) : []
            return (
              <div key={`${entry.subjectType}:${entry.subjectId}`} className={ROW_CLASS}>
                <SubjectAvatar
                  type={entry.subjectType}
                  name={entry.name}
                  image={entry.subjectType === 'user' ? memberImage(entry.subjectId) : null}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">
                    {entry.name}
                    {isMe && <span className="font-normal text-fg-muted"> (you)</span>}
                  </div>
                  <div className="truncate text-[11px] text-fg-muted">
                    {direct
                      ? entry.subjectType === 'alias' ? 'Alias' : entry.email ?? ''
                      : `via ${entry.via === '' ? spaceName : `${entry.via}/`}`}
                  </div>
                </div>
                <RoleMenu
                  current={entry.levelName}
                  levels={levels}
                  disabled={busy}
                  onLevel={(l) =>
                    void run(() => grant(entry.subjectType as 'alias' | 'user', entry.subjectId, l))
                  }
                  onRemove={direct && canManage ? () => void revokeGrants(directGrantIds) : undefined}
                />
              </div>
            )
          })}
          {peopleEntries.length === 0 && !spaceEntry && (
            <p className="px-2 py-1 text-sm text-fg-muted">Only space admins.</p>
          )}
        </div>
      </section>

      {/* General access */}
      <section>
        <SectionHeading>General access</SectionHeading>
        <div className={`-mx-2 ${ROW_CLASS}`}>
          <IconTile tone={spaceEntry ? 'brand' : 'muted'}>
            {spaceEntry ? <UsersIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
          </IconTile>
          <div className="min-w-0 flex-1">
            {canManage && (!spaceEntry || spaceEntry.via === path) ? (
              <PickerMenu
                align="left"
                emphasis
                disabled={busy}
                current={spaceEntry ? 'space' : 'restricted'}
                items={[
                  { value: 'restricted', label: 'Restricted' },
                  { value: 'space', label: `Everyone in ${spaceName}` },
                ]}
                onPick={(v) => {
                  if (v === 'space') {
                    if (!spaceEntry) void run(() => grant('space', '', 'view'))
                  } else if (spaceEntry) {
                    void revokeGrants(
                      spaceEntry.grants.filter((g) => g.resourcePath === path).map((g) => g.id),
                    )
                  }
                }}
              />
            ) : (
              <div className="text-sm font-medium text-fg">
                {spaceEntry ? `Everyone in ${spaceName}` : 'Restricted'}
              </div>
            )}
            <div className="truncate text-[11px] text-fg-muted">
              {spaceEntry
                ? spaceEntry.via === path
                  ? `Anyone in ${spaceName} can ${spaceEntry.levelName === 'view' ? 'view' : 'edit'}`
                  : `via ${spaceEntry.via === '' ? spaceName : `${spaceEntry.via}/`}`
                : 'Only people with access'}
            </div>
          </div>
          {spaceEntry && (
            <RoleMenu
              current={spaceEntry.levelName}
              levels={
                canManage
                  ? editableLevels(spaceEntry.level, spaceEntry.via === path)
                  : []
              }
              disabled={busy}
              onLevel={(l) => void run(() => grant('space', '', l))}
            />
          )}
        </div>

        {canManage && path !== '' && (
          <div className={`-mx-2 mt-0.5 ${ROW_CLASS}`}>
            <IconTile tone={isRestricted ? 'red' : 'muted'}>
              {isRestricted ? <LockIcon className="h-4 w-4" /> : <LockOpenIcon className="h-4 w-4" />}
            </IconTile>
            <div className="min-w-0 flex-1 text-sm font-medium text-fg" title={restrictRow.hint}>
              {restrictRow.title}
            </div>
            <Toggle
              checked={isRestricted}
              disabled={busy}
              aria-label={restrictRow.title}
              onChange={toggleRestrict}
              className="mr-1 shrink-0"
            />
          </div>
        )}

        {canManage && kind === 'folder' && path !== '' && (
          <div className={`-mx-2 mt-0.5 ${ROW_CLASS}`}>
            <IconTile tone="muted">
              <BotIcon className="h-4 w-4" />
            </IconTile>
            <div
              className="min-w-0 flex-1 text-sm font-medium text-fg"
              title="Maintenance passes — review fixes, reorganizing, enrichment — leave a frozen folder alone"
            >
              Freeze for AI
            </div>
            <Toggle
              checked={isLocked}
              disabled={busy}
              aria-label="Freeze for AI"
              onChange={toggleLock}
              className="mr-1 shrink-0"
            />
          </div>
        )}
      </section>
    </>
  )

  // Portalled to <body>: the ContextSidebar renders this from inside the
  // Sidebar's docked column, which animates with a transform — and a
  // transformed ancestor makes `fixed` resolve against it, trapping the dialog
  // in the sidebar instead of centring it over the viewport. Centred both ways;
  // the body caps at 70vh so it never outgrows the screen.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Share ${displayName}`}
          className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <div className="min-w-0">
              <h3 className="truncate text-[17px] font-semibold text-fg">
                {adding ? 'Share with people and aliases' : `Share “${displayName}”`}
              </h3>
              {!adding && kind === 'folder' && path !== '' && (
                <p className="truncate text-[11px] text-fg-muted">{path}/</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 shrink-0 rounded-full p-1.5 text-fg-muted transition hover:bg-surface-subtle hover:text-fg-secondary"
              aria-label="Close"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-3">
            {error && (
              <div className="border-l-2 border-danger-bright pl-3 py-1 text-sm text-danger-strong">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-xl border border-line-subtle bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">
                {notice}
              </div>
            )}

            {isPersonalSpace ? (
              <p className="text-sm text-fg-muted">Only you can see this — it lives in your personal context.</p>
            ) : adding ? (
              addStep
            ) : (
              <>
                {browseStep}
                {extra}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-5 py-3">
            {adding ? (
              <>
                <span />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelAdd}
                    disabled={busy}
                    className="h-9 rounded-lg px-4 text-sm font-medium text-fg-secondary transition hover:bg-surface-subtle disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void sharePending()}
                    className="h-9 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    Share
                  </button>
                </div>
              </>
            ) : (
              <>
                {kind === 'note' ? (
                  <button
                    type="button"
                    onClick={() => void copy(`${window.location.origin}${spaceHref(noteHref(path))}`)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-fg-secondary transition hover:bg-surface-subtle"
                  >
                    <Link2Icon className="h-4 w-4" />
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Typeahead results — pinned to the input's width, capped in height, and
          scrolling on their own so they never outgrow the dialog. */}
      {suggestOpen && suggestPos && (
        <div
          style={{ ...suggestPos, maxHeight: Math.min(suggestPos.maxHeight, 272) }}
          className="fixed z-[96] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface py-1 shadow-float"
        >
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPending((prev) => [
                  ...prev,
                  { key: s.key, type: s.type, id: s.id, name: s.name, image: s.image },
                ])
                setQuery('')
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-surface-subtle"
            >
              <SubjectAvatar type={s.type} name={s.name} image={s.image} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-fg">{s.name}</span>
                {s.sub && <span className="block truncate text-[11px] text-fg-muted">{s.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>,
    document.body,
  )
}
