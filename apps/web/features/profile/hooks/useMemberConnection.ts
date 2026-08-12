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
import { useCommunity } from '@/features/shared/contexts/CommunityContext'

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
  communityId,
  onChange,
}: {
  nodeId: string
  communityId: string | null
  onChange?: (userId: string | null) => void
}) {
  const { data: session } = useSession()
  const { isAdmin } = useCommunity()
  // undefined = still loading; null = definitely unconnected.
  const [connection, setConnection] = useState<MemberConnectionInfo | null | undefined>(undefined)
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
      const res = await fetch(endpoint, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to disconnect')
      setConnection(null)
      onChange?.(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }, [endpoint, onChange])

  const openPicker = useCallback(() => {
    setPicking(true)
    if (members !== null || !communityId) return
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

  const cancelPicking = useCallback(() => setPicking(false), [])

  const viewerId = session?.user?.id ?? null
  const canManage = isAdmin || (!!connection && connection.userId === viewerId)

  return {
    connection, members, picking, busy, error,
    connect, disconnect, openPicker, cancelPicking,
    viewerId, isAdmin, canManage,
  }
}
