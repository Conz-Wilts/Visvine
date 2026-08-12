'use client'

// The "Member" row under a person context's Type/Tags: shows which registered
// member this context is connected to, and manages the link. Connected = the
// node carries the member's Profile tab and userId-based ownership; nothing
// here touches the node's own name/fields — the connection is a separate,
// detachable link (see /api/data/nodes/[nodeId]/connection).
//
// Permissions mirror the API: admins connect anyone and disconnect; a member
// can claim ("This is me") or disconnect themself. Everyone else just reads.

import { useCallback, useEffect, useState } from 'react'
import { Chip, chipClass } from '@/components/ui'
import { useSession } from '@/features/auth/lib/auth-client'
import { useCommunity } from '@/features/shared/contexts/CommunityContext'

interface ConnectionInfo {
  userId: string
  name: string
  email: string
  isActive: boolean
}

interface MemberOption {
  userId: string
  name: string
  email: string
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted'

export function MemberConnectionRow({
  nodeId,
  communityId,
  accent,
}: {
  nodeId: string
  communityId: string
  accent?: string
}) {
  const { data: session } = useSession()
  const { isAdmin } = useCommunity()
  // undefined = still loading; null = definitely unconnected.
  const [connection, setConnection] = useState<ConnectionInfo | null | undefined>(undefined)
  const [members, setMembers] = useState<MemberOption[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endpoint = `/api/data/nodes/${encodeURIComponent(nodeId)}/connection`

  useEffect(() => {
    let cancelled = false
    setConnection(undefined)
    setPicking(false)
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : { connected: null }))
      .then((data) => { if (!cancelled) setConnection(data.connected ?? null) })
      .catch(() => { if (!cancelled) setConnection(null) })
    return () => { cancelled = true }
  }, [endpoint])

  const connect = useCallback(
    async (userId: string) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to connect')
        setConnection(data.connected ?? null)
        setPicking(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect')
      } finally {
        setBusy(false)
      }
    },
    [endpoint],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to disconnect')
      setConnection(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }, [endpoint])

  const openPicker = useCallback(() => {
    setPicking(true)
    if (members !== null) return
    fetch(`/api/communities/${encodeURIComponent(communityId)}/members`)
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((data: { members?: Array<{ userId: string; status: string; user: { name: string; email: string } }> }) => {
        setMembers(
          (data.members ?? [])
            .filter((m) => m.status === 'active')
            .map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email })),
        )
      })
      .catch(() => setMembers([]))
  }, [communityId, members])

  const viewerId = session?.user?.id ?? null
  const canManage = isAdmin || (!!connection && connection.userId === viewerId)

  const actionButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={chipClass({ tone: 'dashed', size: 'lg' })}
      style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
    >
      {label}
    </button>
  )

  // Nothing actionable and nothing to show: viewers who can't manage an
  // unconnected context don't need an empty "Member" label.
  if (connection === undefined) return null
  if (!connection && !isAdmin && !viewerId) return null

  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>Member</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {connection ? (
          <>
            <Chip size="lg">{connection.name}</Chip>
            {canManage && actionButton('Disconnect', () => void disconnect())}
          </>
        ) : picking ? (
          <select
            autoFocus
            disabled={busy || members === null}
            defaultValue=""
            onChange={(e) => { if (e.target.value) void connect(e.target.value) }}
            onBlur={() => setPicking(false)}
            className="rounded-md border border-border-default bg-surface-1 px-2 py-1 text-sm text-text-primary"
          >
            <option value="" disabled>
              {members === null ? 'Loading members…' : 'Connect to member…'}
            </option>
            {(members ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
        ) : isAdmin ? (
          actionButton('+ Connect to member', openPicker)
        ) : viewerId ? (
          actionButton('This is me', () => void connect(viewerId))
        ) : null}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}
