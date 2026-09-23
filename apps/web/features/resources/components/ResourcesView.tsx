'use client';

// The Directory's Resources tab: every file and link the space holds, in one
// list — the way Slack's Files browser holds every file shared anywhere.
// A file dropped here, or pasted, goes into the Drive; a link pasted here
// becomes a resource wearing its preview. Files and links shared in channels
// arrive on their own (lib/resources/library.ts is the read).

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Link from '@/features/shared/components/SpaceLink';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { invalidateRequestCachePrefix, swrFetch } from '@/features/shared/lib/requestCache';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import { formatBytes } from '@/lib/utils';
import { isHttpUrl } from '@/lib/links/shared/unfurl';
import type { LibraryFilter, LibraryItem, LibraryPage } from '@/lib/resources/shared/library';
import { FILE_LABEL, FileTypeIcon } from '@/features/resources/components/resourceUi';
import ContentReveal from '@/components/ui/ContentReveal';
import SearchInput from '@/components/ui/SearchInput';
import ViewToggle from '@/components/ui/ViewToggle';
import { GlobeIcon, UploadIcon } from '@/features/shared/icons';

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Links' },
];

const cacheKey = (spaceId: string, filter: LibraryFilter, q: string) => `resources:${spaceId}:${filter}:${q}`;

function libraryUrl(spaceId: string, filter: LibraryFilter, q: string, before?: string | null): string {
  const params = new URLSearchParams({ filter });
  if (q) params.set('q', q);
  if (before) params.set('before', before);
  return `/api/spaces/${encodeURIComponent(spaceId)}/resources?${params.toString()}`;
}

/** The one muted line under a row's name: what it is, who, where, when. */
function stateLine(item: LibraryItem): string {
  const parts: string[] = [];
  if (item.kind === 'file') {
    if (item.source === 'event') parts.push('Event image');
    else parts.push(FILE_LABEL[item.fileType ?? ''] ?? item.fileType ?? 'File');
    const size = formatBytes(item.fileSize ?? undefined);
    if (size) parts.push(size);
  } else if (item.siteName) {
    parts.push(item.siteName);
  }
  if (item.addedBy) parts.push(item.addedBy);
  if (item.channel) {
    parts.push(item.shares > 1 ? `#${item.channel.name} ×${item.shares}` : `#${item.channel.name}`);
  }
  parts.push(timeAgo(item.createdAt, { style: 'compact' }));
  return parts.join(' · ');
}

function Thumb({ item }: { item: LibraryItem }) {
  const [broken, setBroken] = useState(false);
  if (item.thumbUrl && !broken) {
    return (
      <img
        src={item.thumbUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-lg bg-surface-subtle object-cover"
      />
    );
  }
  if (item.kind === 'link') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-fg-muted">
        {item.faviconUrl && !broken ? (
          <img src={item.faviconUrl} alt="" className="h-5 w-5" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <GlobeIcon className="h-5 w-5" />
        )}
      </span>
    );
  }
  return <FileTypeIcon type={item.fileType ?? ''} className="h-10 w-10 shrink-0" />;
}

function Row({ item }: { item: LibraryItem }) {
  const body = (
    <>
      <Thumb item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{item.name}</span>
        <span className="block truncate text-xs text-fg-muted">{stateLine(item)}</span>
      </span>
    </>
  );
  const className = 'flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-surface-subtle';
  if (item.href) {
    return <Link href={item.href} className={className}>{body}</Link>;
  }
  return (
    <a href={item.url ?? '#'} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  );
}

export default function ResourcesView() {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    if (!spaceId) return;
    swrFetch<LibraryPage>(cacheKey(spaceId, filter, q), () => fetchJson<LibraryPage>(libraryUrl(spaceId, filter, q)), setPage)
      .catch(() => setProblem('Resources could not be loaded'));
  }, [spaceId, filter, q]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    if (!spaceId) return;
    invalidateRequestCachePrefix(`resources:${spaceId}:`);
    invalidateRequestCachePrefix(`drive:files:${spaceId}`);
    load();
  }, [spaceId, load]);

  const loadMore = useCallback(async () => {
    if (!spaceId || !page?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchJson<LibraryPage>(libraryUrl(spaceId, filter, q, page.nextBefore));
      setPage((prev) => {
        const seen = new Set(prev?.items.map((i) => i.key));
        return { items: [...(prev?.items ?? []), ...next.items.filter((i) => !seen.has(i.key))], nextBefore: next.nextBefore };
      });
    } catch {
      setProblem('More resources could not be loaded');
    } finally {
      setLoadingMore(false);
    }
  }, [spaceId, page, filter, q, loadingMore]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!spaceId || !files.length) return;
    setBusy(true);
    setProblem(null);
    const failed: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('spaceId', spaceId);
      try {
        const res = await fetch('/api/resources/upload', { method: 'POST', body: form });
        if (!res.ok) failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    if (failed.length) setProblem(`Couldn't add ${failed.join(', ')}`);
    setBusy(false);
    refresh();
  }, [spaceId, refresh]);

  const addLink = useCallback(async (url: string) => {
    if (!spaceId || !isHttpUrl(url)) {
      setProblem('A link starts with http:// or https://');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await fetchJsonBody('/api/resources/links', 'POST', { spaceId, url });
      setLink('');
      refresh();
    } catch (err) {
      setProblem((err as Error).message || "Couldn't add that link");
    } finally {
      setBusy(false);
    }
  }, [spaceId, refresh]);

  // Paste anywhere on the tab that is not a text field: files upload, a link is added.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void uploadFiles(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (isHttpUrl(text)) {
        e.preventDefault();
        void addLink(text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFiles, addLink]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      void uploadFiles(files);
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (isHttpUrl(text?.trim())) void addLink(text.trim());
  };

  const items = useMemo(() => page?.items ?? [], [page]);

  return (
    <div
      className="relative w-full"
      style={{ minHeight: 'calc(100dvh - 112px)' }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface/80 text-sm font-medium text-accent">
          Drop to add
        </div>
      )}

      {/* The same sticky band the Directory grid's toolbar rides. */}
      <div className="sticky top-0 z-10 -ml-6 flex flex-wrap items-center gap-3 bg-glass pt-1 pb-2 pl-12 pr-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search resources…"
          size="lg"
          className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
        />
        <ViewToggle options={FILTERS} value={filter} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-2">
          <form
            onSubmit={(e) => { e.preventDefault(); void addLink(link.trim()); }}
            className="flex h-9 items-center rounded-lg bg-surface px-3 ring-1 ring-line-subtle focus-within:ring-line"
          >
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a link"
              aria-label="Add link"
              disabled={busy}
              className="w-44 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
            />
          </form>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-secondary ring-1 ring-line-subtle transition-colors hover:bg-surface-subtle hover:text-fg disabled:opacity-50"
          >
            {busy
              ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              : <UploadIcon className="h-4 w-4" />}
            Upload
          </button>
        </div>
      </div>

      <ContentReveal ready={page !== null} id="panel-resources" role="tabpanel">
        <div className="w-full px-4 pt-4 pb-8">
          {problem && <p className="px-2 pb-2 text-sm text-danger">{problem}</p>}
          {items.length > 0 && (
            <div className="flex flex-col divide-y divide-line-subtle">
              {items.map((item) => <Row key={item.key} item={item} />)}
            </div>
          )}
          {page?.nextBefore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-3 px-2 text-sm font-medium text-fg-secondary hover:text-fg disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'More'}
            </button>
          )}
        </div>
      </ContentReveal>
    </div>
  );
}
