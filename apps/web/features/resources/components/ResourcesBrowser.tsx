'use client';

/**
 * Every resource a place holds — the space's Resources, or one channel's
 * Files — the way Slack's Files browser holds every file shared anywhere.
 * One list read (lib/resources/list.ts) behind kind, channel, person, date,
 * search and sort; a list or a grid (an image-first grid for pictures); bulk
 * select; the trash. Opening anything opens the viewer, walking this list.
 * Files dropped or pasted here are uploaded; a pasted link is added.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  Checkbox,
  ConfirmDialog,
  IconButton,
  Menu,
  ResourceCard,
  ResourceGrid,
  ResourceRow,
  SearchInput,
  type MenuItem,
} from '@visvine/ui';
import {
  ChevronDownIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LayoutGridIcon,
  ListIcon,
  RotateCcwIcon,
  Share2Icon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from '@/features/shared/icons';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { isHttpUrl } from '@/lib/links/shared/unfurl';
import type { ChannelDirectoryEntry } from '@/lib/messages/types';
import type { ListKind, ListQuery, ListSort } from '@/lib/resources/shared/listQuery';
import type { ResourceView } from '@/lib/resources/shared/view';
import { uploadResourceFile } from '@/features/resources/lib/upload';
import { invalidateResourceLists, useResourceList } from '@/features/resources/hooks/useResourceList';
import { useResourceViewer } from '@/features/resources/viewer/ResourceViewerContext';
import { resourceMeta } from '@/features/resources/viewer/meta';
import ShareDialog from '@/features/resources/viewer/ShareDialog';

const KIND_FILTERS: Array<{ id: ListKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'doc', label: 'Docs' },
  { id: 'sheet', label: 'Sheets' },
  { id: 'slides', label: 'Slides' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'link', label: 'Links' },
];

const CHANNEL_KIND_FILTERS: Array<{ id: ListKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'files', label: 'Files' },
  { id: 'link', label: 'Links' },
];

const SORTS: Array<{ id: ListSort; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
];

const SINCE: Array<{ id: string; label: string; days: number | null }> = [
  { id: 'any', label: 'Any time', days: null },
  { id: '7', label: 'Past week', days: 7 },
  { id: '30', label: 'Past month', days: 30 },
  { id: '365', label: 'Past year', days: 365 },
];

type Layout = 'list' | 'grid';

function storedLayout(key: string): Layout | null {
  try {
    const v = localStorage.getItem(key);
    return v === 'grid' || v === 'list' ? v : null;
  } catch {
    return null;
  }
}

function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'h-8 shrink-0 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
        active ? 'bg-surface-muted text-fg' : 'text-fg-muted hover:bg-surface-subtle hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function DropdownFilter({ label, value, active, items }: { label: string; value: string; active: boolean; items: MenuItem[] }) {
  return (
    <Menu
      label={label}
      align="start"
      items={items}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={clsx(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-subtle',
            active ? 'bg-surface-muted text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {value}
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      )}
    />
  );
}

export default function ResourcesBrowser({
  spaceId,
  channelId = null,
  canAddToSpace = true,
}: {
  spaceId: string;
  /** A channel's Files tab: only what was shared there; uploads post there. */
  channelId?: string | null;
  canAddToSpace?: boolean;
}) {
  const inChannel = Boolean(channelId);
  const layoutKey = `vv:resources:layout:${inChannel ? 'channel' : 'space'}`;
  const [layout, setLayout] = useState<Layout>('list');
  const [kind, setKind] = useState<ListKind>('all');
  const [q, setQ] = useState('');
  const [query, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<ListSort>('recent');
  const [mine, setMine] = useState(false);
  const [since, setSince] = useState('any');
  const [channel, setChannel] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [channels, setChannels] = useState<ChannelDirectoryEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ loaded: number; total: number; count: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ResourceView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ResourceView[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const viewer = useResourceViewer();

  useEffect(() => {
    const saved = storedLayout(layoutKey);
    if (saved) setLayout(saved);
  }, [layoutKey]);
  useEffect(() => {
    try {
      localStorage.setItem(layoutKey, layout);
    } catch {
      /* private mode */
    }
  }, [layout, layoutKey]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (inChannel) return;
    fetchJson<{ channels: ChannelDirectoryEntry[] }>(`/api/messages/channels?spaceId=${encodeURIComponent(spaceId)}`)
      .then(({ channels: all }) => setChannels(all.filter((c) => c.isMember)))
      .catch(() => setChannels([]));
  }, [spaceId, inChannel]);

  const sinceDays = SINCE.find((s) => s.id === since)?.days ?? null;
  const listQuery: Partial<ListQuery> = useMemo(
    () => ({
      kind,
      q: query || null,
      sort,
      by: mine ? 'me' : null,
      channelId: channelId ?? channel,
      since: sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10) : null,
      trash,
    }),
    [kind, query, sort, mine, channelId, channel, sinceDays, trash],
  );
  const { items, loadMore, hasMore, loadingMore } = useResourceList(spaceId, listQuery);
  const ids = useMemo(() => (items ?? []).map((r) => r.id), [items]);
  const imageGrid = kind === 'image' && layout === 'grid';

  useEffect(() => setSelected(new Set()), [listQuery]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && void loadMore(), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const refresh = useCallback(() => invalidateResourceLists(spaceId), [spaceId]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setProblem(null);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      let done = 0;
      setUploading({ loaded: 0, total, count: files.length });
      const failed: string[] = [];
      const uploaded: string[] = [];
      for (const file of files) {
        try {
          const result = await uploadResourceFile(file, {
            spaceId,
            conversationId: channelId,
            onProgress: (loaded) => setUploading({ loaded: done + loaded, total, count: files.length }),
          });
          uploaded.push(result.id);
        } catch (err) {
          failed.push(`${file.name}${err instanceof Error && err.message ? ` (${err.message})` : ''}`);
        }
        done += file.size;
      }
      // Dropped into a channel's Files, they are shared there as a message.
      if (channelId && uploaded.length) {
        await fetchJsonBody(`/api/messages/conversations/${encodeURIComponent(channelId)}/messages`, 'POST', {
          text: '',
          fileIds: uploaded,
        }).catch(() => failed.push('sharing them in the channel'));
      }
      setUploading(null);
      if (failed.length) setProblem(`Couldn't add ${failed.join(', ')}`);
      refresh();
    },
    [spaceId, channelId, refresh],
  );

  const addLink = useCallback(
    async (url: string) => {
      setProblem(null);
      try {
        if (channelId) {
          await fetchJsonBody(`/api/messages/conversations/${encodeURIComponent(channelId)}/messages`, 'POST', { text: url });
        } else {
          await fetchJsonBody('/api/resources/links', 'POST', { spaceId, url });
        }
        refresh();
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'Could not add the link');
      }
    },
    [spaceId, channelId, refresh],
  );

  // Paste a file or a link anywhere on the page (not into a field).
  useEffect(() => {
    if (trash) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void upload(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (isHttpUrl(text) && (canAddToSpace || channelId)) {
        e.preventDefault();
        void addLink(text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload, addLink, trash, canAddToSpace, channelId]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void upload(files);
  };

  const toggle = (id: string, range: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && prev.size) {
        const last = [...prev].pop()!;
        const [a, b] = [ids.indexOf(last), ids.indexOf(id)].sort((x, y) => x - y);
        for (const each of ids.slice(a, b + 1)) next.add(each);
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = (items ?? []).filter((r) => selected.has(r.id));

  const restore = async (list: ResourceView[]) => {
    for (const r of list) await fetch(`/api/resources/${encodeURIComponent(r.id)}/restore`, { method: 'POST' });
    setSelected(new Set());
    refresh();
  };

  const remove = async (list: ResourceView[]) => {
    for (const r of list) {
      await fetch(`/api/resources?id=${encodeURIComponent(r.id)}${trash ? '&forever=1' : ''}`, { method: 'DELETE' });
    }
    setSelected(new Set());
    refresh();
  };

  const rowActions = (r: ResourceView) => {
    if (trash) {
      return (
        <>
          <IconButton size="sm" label="Restore" icon={<RotateCcwIcon />} onClick={() => void restore([r])} />
          <IconButton size="sm" label="Delete forever" icon={<Trash2Icon />} onClick={() => setConfirmDelete([r])} />
        </>
      );
    }
    const menu: MenuItem[] = [
      { id: 'share', label: 'Share', icon: <Share2Icon />, onSelect: () => setSharing(r) },
      ...(r.canManage ? [{ id: 'delete', label: 'Delete', icon: <Trash2Icon />, danger: true, onSelect: () => setConfirmDelete([r]) }] : []),
    ];
    return (
      <>
        {r.source === 'link' && r.url ? (
          <IconButton size="sm" label={`Open in ${r.providerLabel}`} icon={<ExternalLinkIcon />} onClick={() => window.open(r.url!, '_blank', 'noopener,noreferrer')} />
        ) : r.downloadUrl ? (
          <IconButton size="sm" label="Download" icon={<DownloadIcon />} onClick={() => download(r.downloadUrl!)} />
        ) : null}
        <Menu
          label="More"
          items={menu}
          trigger={({ open, toggle: t }) => <IconButton size="sm" label="More" icon={<EllipsisIcon />} active={open} onClick={t} />}
        />
      </>
    );
  };

  const checkbox = (r: ResourceView) => (
    <span
      className={clsx(selected.size ? 'flex' : 'hidden group-hover:flex', 'items-center')}
      onClick={(e) => {
        if (e.shiftKey) {
          e.preventDefault();
          toggle(r.id, true);
        }
      }}
    >
      <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id, false)} aria-label={`Select ${r.name}`} />
    </span>
  );

  const open = (r: ResourceView) => viewer.open(r.id, ids);
  const kinds = inChannel ? CHANNEL_KIND_FILTERS : KIND_FILTERS;
  const pct = uploading && uploading.total ? Math.round((uploading.loaded / uploading.total) * 100) : 0;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (trash || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* Toolbar */}
      <div className={clsx('flex flex-col gap-3', inChannel ? 'px-4 pt-3' : 'pr-6 pt-1')}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchInput value={q} onChange={setQ} placeholder={inChannel ? 'Search files' : 'Search resources'} size={inChannel ? 'sm' : 'md'} />
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton label="List" icon={<ListIcon />} active={layout === 'list'} onClick={() => setLayout('list')} />
            <IconButton label="Grid" icon={<LayoutGridIcon />} active={layout === 'grid'} onClick={() => setLayout('grid')} />
          </div>
          {!trash && (canAddToSpace || inChannel) && (
            <>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <UploadIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Upload</span>
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void upload(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>

        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
          {kinds.map((k) => (
            <FilterButton key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </FilterButton>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-line-subtle" aria-hidden="true" />
          <FilterButton active={mine} onClick={() => setMine((m) => !m)}>
            Mine
          </FilterButton>
          {!inChannel && channels.length > 0 && (
            <DropdownFilter
              label="Channel"
              active={channel !== null}
              value={channel ? `#${channels.find((c) => c.id === channel)?.name ?? 'channel'}` : 'Any channel'}
              items={[
                { id: 'any', label: 'Any channel', onSelect: () => setChannel(null) },
                ...channels.map((c) => ({ id: c.id, label: `#${c.name}`, onSelect: () => setChannel(c.id) })),
              ]}
            />
          )}
          <DropdownFilter
            label="When"
            active={since !== 'any'}
            value={SINCE.find((s) => s.id === since)!.label}
            items={SINCE.map((s) => ({ id: s.id, label: s.label, onSelect: () => setSince(s.id) }))}
          />
          <DropdownFilter
            label="Sort"
            active={sort !== 'recent'}
            value={SORTS.find((s) => s.id === sort)!.label}
            items={SORTS.map((s) => ({ id: s.id, label: s.label, onSelect: () => setSort(s.id) }))}
          />
          {!inChannel && (
            <FilterButton active={trash} onClick={() => setTrash((t) => !t)}>
              Trash
            </FilterButton>
          )}
        </div>

        {uploading && (
          <div className="flex items-center gap-3 text-xs text-fg-muted" aria-live="polite">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular-nums">
              {uploading.count} · {pct}%
            </span>
          </div>
        )}
        {problem && <p className="text-xs text-danger">{problem}</p>}
      </div>

      {/* The list */}
      <div className={clsx('mt-3 min-h-0 flex-1 overflow-y-auto', inChannel ? 'px-2 pb-6' : 'pb-24 pr-6')}>
        {items === null ? (
          <div className="space-y-1">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <span className="h-9 w-9 animate-pulse rounded-lg bg-surface-muted" />
                <span className="h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
              </div>
            ))}
          </div>
        ) : layout === 'grid' ? (
          <ResourceGrid variant={imageGrid ? 'image' : 'file'}>
            {items.map((r) => (
              <ResourceCard
                key={r.id}
                name={r.name}
                kind={r.kind}
                meta={resourceMeta(r, { channel: !inChannel })}
                thumbUrl={r.thumbUrl}
                variant={imageGrid ? 'image' : 'file'}
                selected={selected.has(r.id)}
                select={checkbox(r)}
                actions={rowActions(r)}
                onOpen={() => (selected.size ? toggle(r.id, false) : open(r))}
              />
            ))}
          </ResourceGrid>
        ) : (
          <div className="divide-y divide-line-subtle">
            {items.map((r) => (
              <ResourceRow
                key={r.id}
                name={r.name}
                kind={r.kind}
                meta={resourceMeta(r, { channel: !inChannel })}
                thumbUrl={r.kind === 'image' || r.source === 'link' ? r.thumbUrl : null}
                selected={selected.has(r.id)}
                select={checkbox(r)}
                actions={rowActions(r)}
                onOpen={() => (selected.size ? toggle(r.id, false) : open(r))}
              />
            ))}
          </div>
        )}
        {hasMore && <div ref={sentinel} className="h-12">{loadingMore && <span className="sr-only">Loading</span>}</div>}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line-subtle bg-surface py-1 pl-3 pr-1 shadow-float">
            <span className="pr-2 text-sm font-medium tabular-nums text-fg">{selected.size} selected</span>
            {trash ? (
              <>
                <IconButton label="Restore" icon={<RotateCcwIcon />} onClick={() => void restore(selectedItems)} />
                <IconButton label="Delete forever" icon={<Trash2Icon />} onClick={() => setConfirmDelete(selectedItems)} />
              </>
            ) : (
              <>
                {selectedItems.length === 1 && (
                  <IconButton label="Share" icon={<Share2Icon />} onClick={() => setSharing(selectedItems[0])} />
                )}
                <IconButton
                  label="Download"
                  icon={<DownloadIcon />}
                  onClick={() => selectedItems.forEach((r, i) => r.downloadUrl && setTimeout(() => download(r.downloadUrl!), i * 400))}
                />
                {selectedItems.every((r) => r.canManage) && (
                  <IconButton label="Delete" icon={<Trash2Icon />} onClick={() => setConfirmDelete(selectedItems)} />
                )}
              </>
            )}
            <IconButton label="Clear selection" icon={<XIcon />} onClick={() => setSelected(new Set())} />
          </div>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-xl border-2 border-dashed border-accent bg-accent-soft/60" />
      )}

      {sharing && (
        <ShareDialog
          resource={sharing}
          open
          onClose={() => setSharing(null)}
          onShared={() => {
            setSharing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete?.length === 1
            ? `${trash ? 'Delete' : 'Move'} ${confirmDelete[0].name}${trash ? ' forever' : ' to the trash'}?`
            : `${trash ? 'Delete' : 'Move'} ${confirmDelete?.length ?? 0} ${trash ? 'forever' : 'to the trash'}?`
        }
        confirmLabel={trash ? 'Delete forever' : 'Delete'}
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          await remove(confirmDelete ?? []);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
