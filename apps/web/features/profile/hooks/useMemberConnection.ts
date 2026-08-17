'use client'

// Which registered member a person node is connected to, and the actions that
// manage the link. Connected = the node carries that member's profile and
// userId-based ownership; nothing here touches the node's own name/fields — the
// connection is a separate, detachable link (/api/data/nodes/[nodeId]/connection).
//
// Permissions mirror the API: admins connect anyone and disconnect; a member can
// claim ("This is me") or disconnect themself. Everyone else just reads.
//
// The caller owns cache coherence: `onChange` fires after a successful
// connect/disconnect so the profile page can patch the cached node
// (connected_user_id — the gate that decides profile vs connect prompt) and
// refetch /api/profile. Without it the page would keep the stale view for the
// length of useNodeProfile's 60s TTL.

import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/features/auth/lib/auth-client'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson'

export interface MemberConnectionInfo {
  userId: string
  name: string
  email: string
  isActive: boolean
}

export interface MemberOption {
  userId: string
  name: string
  email: string
}

export function useMemberConnection({
  nodeId,
  spaceId,
  onChange,
}: {
  nodeId: string
  spaceId: string | null
  onChange?: (userId: string | null) => void
}) {
  const { data: session } = useSession()
  const { isAdmin } = useSpace()
  // undefined = still loading; null = definitely unconnected.
  const [connection, setConnection] = useState<MemberConnectionInfo | null | undefined>(undefined)
  // The endpoint could not answer at all — no Node row for this id (a Person-row
  // id reached directly), a space the viewer can't read, or a transient
  // failure. Distinct from a clean "no member behind this node": callers must
  // not read a failed request as an invitation to connect one.
  const [unavailable, setUnavailable] = useState(false)
  const [members, setMembers] = useState<MemberOption[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endpoint = `/api/data/nodes/${encodeURIComponent(nodeId)}/connection`

  useEffect(() => {
    let cancelled = false
    setConnection(undefined)
    setUnavailable(false)
    setPicking(false)
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : { connected: null, unavailable: true }))
      .then((data) => {
        if (cancelled) return
        setConnection(data.connected ?? null)
        setUnavailable(!!data.unavailable)
      })
      .catch(() => { if (!cancelled) { setConnection(null); setUnavailable(true) } })
    return () => { cancelled = true }
  }, [endpoint])

  const connect = useCallback(
    async (userId: string) => {
      setBusy(true)
      setError(null)
      try {
        const data = await fetchJsonBody<{ connected?: MemberConnectionInfo | null }>(endpoint, 'PUT', { userId })
        setConnection(data.connected ?? null)
        setUnavailable(false)
        setPicking(false)
        onChange?.(data.connected?.userId ?? userId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect')
      } finally {
        setBusy(false)
      }
    },
    [endpoint, onChange],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await fetchJson(endpoint, { method: 'DELETE' })
      setConnection(null)
      setUnavailable(false)
      onChange?.(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }, [endpoint, onChange])

  const openPicker = useCallback(() => {
    setPicking(true)
    if (members !== null || !spaceId) return
    fetch(`/api/communities/${encodeURIComponent(spaceId)}/members`)
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((data: { members?: Array<{ userId: string; status: string; user: { name: string; email: string } }> }) => {
        setMembers(
          (data.members ?? [])
            .filter((m) => m.status === 'active')
            .map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email })),
        )
      })
      .catch(() => setMembers([]))
  }, [spaceId, members])

  const cancelPicking = useCallback(() => setPicking(false), [])

  const viewerId = session?.user?.id ?? null
  const canManage = isAdmin || (!!connection && connection.userId === viewerId)

  return {
    connection, unavailable, members, picking, busy, error,
    connect, disconnect, openPicker, cancelPicking,
    viewerId, isAdmin, canManage,
  }
}
