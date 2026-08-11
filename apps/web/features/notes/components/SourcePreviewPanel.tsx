'use client'

// The standalone Context Source view (/directory/source/<path>): metadata,
// ingestion status, and the extracted text of a non-note source (uploaded
// csv/markdown/txt). Sources aren't editable — this surface previews, offers
// the original file for download (signed URL), retries failed ingestions, and
// deletes. Reads go through the gated /api/notes/sources pipeline, so folder
// visibility and write denials come free.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/features/shared/contexts/CommunityContext'
import type { ContextSourceMeta } from '@/lib/notes/shared/sourceTypes'
import { notesApi } from '../lib/notesApi'

const PAGE_CHARS = 20_000

export function SourcePreviewPanel({ path }: { path: string }) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null

  const [source, setSource] = useState<ContextSourceMeta | null>(null)
  const [text, setText] = useState('')
  const [totalChars, setTotalChars] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      const r = await notesApi.readSource(communityId, path, { maxChars: PAGE_CHARS })
      setSource(r.source)
      setText(r.text)
      setTotalChars(r.totalChars)
      setDownloadUrl(r.downloadUrl)
    } catch (err) {
      setSource(null)
      setError(err instanceof Error ? err.message : 'Failed to load source')
    } finally {
      setLoading(false)
    }
  }, [communityId, path])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    if (!communityId) return
    try {
      const r = await notesApi.readSource(communityId, path, {
        offset: text.length,
        maxChars: PAGE_CHARS,
      })
      setText((t) => t + r.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more')
    }
  }

  const reingest = async () => {
    if (!communityId) return
    setBusy(true)
    setError(null)
    try {
      await notesApi.reingestSource(communityId, path)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!communityId) return
    if (!window.confirm(`Delete source "${source?.name ?? path}"? This cannot be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      await notesApi.deleteSource(communityId, path)
      router.push('/directory/note/index.md')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  if (!communityId || loading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-3 py-6">
        <div className="h-4 w-2/3 rounded bg-surface-2" />
        <div className="h-4 w-full rounded bg-surface-2" />
        <div className="h-4 w-1/2 rounded bg-surface-2" />
      </div>
    )
  }

  if (!source) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <p className="text-base font-semibold text-text-secondary">Source not found.</p>
        <p className="text-sm text-text-muted">
          {error ?? 'It may have been deleted, or you may not have access to it.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-7 pb-10 pt-10">
      <h2 className="min-w-0 truncate text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary font-open-sauce">
        {source.name}
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <StatusBadge status={source.status} />
        <span>{source.kind}</span>
        <span>·</span>
        <span>{formatBytes(source.sizeBytes)}</span>
        {source.chunkCount > 0 && (
          <>
            <span>·</span>
            <span>{source.chunkCount} indexed chunks</span>
          </>
        )}
        {source.truncated && (
          <span
            className="rounded-full bg-amber-100 px-2 py-px text-[11px] font-semibold text-amber-700"
            title="The file exceeded the indexing caps — only its head is searchable."
          >
            partially indexed
          </span>
        )}
      </div>

      {source.status === 'failed' && source.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Ingestion failed: {source.error}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={source.name}
            className="rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-surface-2"
          >
            Download original
          </a>
        )}
        {source.status === 'failed' && (
          <button
            type="button"
            disabled={busy}
            onClick={reingest}
            className="rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? 'Retrying…' : 'Retry ingestion'}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {text ? (
        <pre className="mt-6 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border-default bg-surface-1 p-4 text-[13px] leading-relaxed text-text-primary">
          {text}
        </pre>
      ) : (
        <p className="mt-6 text-sm text-text-muted">No extracted text.</p>
      )}
      {text.length < totalChars && (
        <button
          type="button"
          onClick={loadMore}
          className="mt-3 rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-surface-2"
        >
          Show more ({formatBytes(totalChars - text.length)} remaining)
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ContextSourceMeta['status'] }) {
  const styles =
    status === 'ready'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'failed'
        ? 'bg-red-100 text-red-700'
        : 'bg-surface-2 text-text-muted'
  return (
    <span className={`rounded-full px-2 py-px text-[11px] font-semibold uppercase tracking-wide ${styles}`}>
      {status}
    </span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
