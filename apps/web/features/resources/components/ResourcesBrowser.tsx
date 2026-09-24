'use client';

/**
 * Every resource a place holds — the space's Resources, or one channel's
 * Files — the way Slack's Files browser holds every file shared anywhere.
 * One list read (lib/resources/list.ts) behind kind, channel, person, date,
 * search and sort; a list or a grid (an image-first grid for pictures); bulk
 * select; the trash. Opening anything opens the viewer, walking this list.
 * Nothing is added here: a resource comes in over MCP (`upload_file`,
 * `add_context` with a url), so its note is written with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Checkbox,
  ConfirmDialog,
  FileTypeIcon,
  IconButton,
  Menu,
  ResourceCard,
  ResourceGrid,
  ResourceRow,
  SearchInput,
  type FileKind,
  type MenuItem,
} from '@visvine/ui';
import FilterBar from '@/features/resources/components/FilterBar';
import FilterMenu from '@/features/resources/components/FilterMenu';
import {
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  Share2Icon,
  Trash2Icon,
  XIcon,
} from '@/features/shared/icons';
import { fetchJson } from '@/lib/fetchJson';
import type { ChannelDirectoryEntry } from '@/lib/messages/types';
import type { ListKind, ListQuery, ListSort } from '@/lib/resources/shared/listQuery';
import type { ResourceView } from '@/lib/resources/shared/view';
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

/** The glyph a kind's row wears; `all` and `files` are no one kind. */
const KIND_ICON: Partial<Record<ListKind, FileKind>> = {
  image: 'image',
  pdf: 'pdf',
  doc: 'doc',
  sheet: 'sheet',
  slides: 'slides',
  video: 'video',
  audio: 'audio',
  link: 'link',
}

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

export default function ResourcesBrowser({
  spaceId,
  channelId = null,
}: {
  spaceId: string;
  /** A channel's Files tab: only what was shared there. */
  channelId?: string | null;
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
  const [sharing, setSharing] = useState<ResourceView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ResourceView[] | null>(null);
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Toolbar: the Directory's shape — search, then one dropdown per filter. */}
      <div className={clsx('flex flex-col gap-3', inChannel ? 'px-4 pt-3' : 'pr-6 pt-1')}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={inChannel ? 'Search files…' : 'Search resources…'}
            size="lg"
            className={clsx('w-full flex-1', inChannel ? 'max-w-[320px] sm:min-w-[200px]' : 'max-w-[420px] sm:min-w-[280px]')}
          />
          <div className="hidden h-6 w-px shrink-0 bg-line-subtle sm:block" aria-hidden="true" />
          <FilterMenu
            label="Types"
            value={trash ? 'trash' : kind}
            onChange={(id) => {
              setTrash(id === 'trash');
              if (id !== 'trash') setKind(id as ListKind);
            }}
            options={[
              ...kinds.map((k) => ({
                id: k.id,
                label: k.id === 'all' ? 'All types' : k.label,
                leading: KIND_ICON[k.id] ? <FileTypeIcon kind={KIND_ICON[k.id]!} size="xs" /> : undefined,
              })),
              ...(inChannel ? [] : [{ id: 'trash', label: 'Trash', leading: <Trash2Icon className="h-3.5 w-3.5" /> }]),
            ]}
          />
          <FilterBar
            fields={[
              {
                id: 'people',
                label: 'Added by',
                value: mine ? 'mine' : 'anyone',
                onChange: (id) => setMine(id === 'mine'),
                options: [
                  { id: 'anyone', label: 'Anyone' },
                  { id: 'mine', label: 'Me' },
                ],
              },
              ...(!inChannel && channels.length > 0
                ? [{
                    id: 'channel',
                    label: 'Channel',
                    value: channel ?? 'any',
                    onChange: (id: string) => setChannel(id === 'any' ? null : id),
                    options: [
                      { id: 'any', label: 'All channels' },
                      ...channels.map((c) => ({ id: c.id, label: `#${c.name}` })),
                    ],
                  }]
                : []),
              {
                id: 'date',
                label: 'Added',
                verb: 'in',
                value: since,
                onChange: setSince,
                options: SINCE.map((s) => ({ id: s.id, label: s.label })),
              },
              {
                id: 'sort',
                label: 'Sorted by',
                verb: '',
                value: sort,
                onChange: (id) => setSort(id as ListSort),
                options: SORTS.map((s) => ({ id: s.id, label: s.label })),
              },
            ]}
          />

          <div className="ml-auto flex items-center gap-2">
            <div role="radiogroup" aria-label="Layout" className="flex min-h-10 items-stretch rounded-lg bg-surface-muted p-0.5 ring-1 ring-line-subtle">
              {(['list', 'grid'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={layout === l}
                  onClick={() => setLayout(l)}
                  className={clsx(
                    'rounded-md px-3 text-sm font-semibold capitalize transition-colors',
                    layout === l ? 'bg-surface text-fg ring-1 ring-line' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
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
