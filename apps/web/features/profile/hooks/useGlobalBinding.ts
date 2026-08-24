'use client'

// A person node's binding to its Visvine global record — read, bind (follow
// or fork), detach, unbind — over /api/nodes/[nodeId]/global. State and
// permissions only; ProfileConnectBar renders it.

import { useCallback, useEffect, useState } from 'react'
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson'

export type GlobalMode = 'follow' | 'fork'

export interface GlobalBindingState {
  identityId: string | null
  mode: GlobalMode | null
  record: { identityId: string; nodeId: string; path: string; name: string; subtitle: string | null; imageUrl: string | null; userId: string | null } | null
}

export function useGlobalBinding(nodeId: string, onChange?: () => void) {
  const [state, setState] = useState<GlobalBindingState | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/nodes/${encodeURIComponent(nodeId)}/global`

  useEffect(() => {
    let cancelled = false
    setState(undefined)
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setState(data ?? null) })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [endpoint])

  const run = useCallback(async (work: () => Promise<GlobalBindingState>) => {
    setBusy(true)
    setError(null)
    try {
      setState(await work())
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }, [onChange])

  const bind = useCallback(
    (identityId: string, mode: GlobalMode) => run(() => fetchJsonBody<GlobalBindingState>(endpoint, 'PUT', { identityId, mode })),
    [endpoint, run],
  )
  const setMode = useCallback(
    (mode: GlobalMode) => run(() => fetchJsonBody<GlobalBindingState>(endpoint, 'PUT', { mode })),
    [endpoint, run],
  )
  const detach = useCallback(() => run(() => fetchJson<GlobalBindingState>(`${endpoint}?keep=1`, { method: 'DELETE' })), [endpoint, run])
  const unbind = useCallback(() => run(() => fetchJson<GlobalBindingState>(endpoint, { method: 'DELETE' })), [endpoint, run])

  return { state, busy, error, bind, setMode, detach, unbind }
}
