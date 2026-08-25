'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useResources } from '@/features/resources/hooks/useResources';
import ResourceUploadDialog from '@/features/resources/components/ResourceUploadDialog';
import ResourceDetailDrawer from '@/features/resources/components/ResourceDetailDrawer';
import { getPinned, togglePin } from '@/features/resources/components/resourceUi';
import {
  FileCard, FileRow, FolderRow, FolderTile, useDropTarget,
  type DragItem, type MenuAction,
} from '@/features/resources/components/driveItems';
import { MoveDialog, NameDialog } from '@/features/resources/components/driveDialogs';
import { driveApi } from '@/features/resources/lib/driveApi';
import { childFolders, folderPathLabel, folderTrail, subtree } from '@/features/resources/lib/tree';
import { ConfirmDialog, EmptyState, SearchInput, ViewToggle } from '@/components/ui';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';
import Dropdown, { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { ChevronRightIcon, FolderIcon, PlusIcon, UploadIcon } from '@/features/shared/icons';
import type { Resource, ResourceFolder } from '@/lib/types';

type View = 'grid' | 'list';
type TypeFilter = 'all' | 'docs' | 'sheets' | 'pdf' | 'image' | 'other';
/** Field and direction in one choice — the menu says what the order IS. */
type Sort = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

const TYPE_GROUP: Record<TypeFilter, (t: string) => boolean> = {
  all: () => true,
  docs: t => t === 'docx' || t === 'markdown' || t === 'text',
  sheets: t => t === 'xlsx' || t === 'csv',
  pdf: t => t === 'pdf',
  image: t => t === 'image',
  other: t => !['docx', 'markdown', 'text', 'xlsx', 'csv', 'pdf', 'image'].includes(t),
};

type Dialog =
  | { kind: 'newFolder' }
  | { kind: 'upload' }
  | { kind: 'renameFolder'; folder: ResourceFolder }
  | { kind: 'renameFile'; file: Resource }
  | { kind: 'moveFolder'; folder: ResourceFolder }
  | { kind: 'moveFile'; file: Resource }
  | { kind: 'deleteFolder'; folder: ResourceFolder }
  | { kind: 'deleteFile'; file: Resource };

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Crumb({
  label, active, onClick, onDropItem,
}: {
  label: string; active: boolean; onClick: () => void; onDropItem: (item: DragItem) => void;
}) {
  const { over, handlers } = useDropTarget(onDropItem, !active);
  return (
    <button
      type="button"
      onClick={onClick}
      {...handlers}
      className={`max-w-[220px] truncate rounded-lg px-2 py-1 text-sm font-medium leading-tight transition-colors ${
        active ? 'text-text-primary' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'
      } ${over ? 'bg-brand-green/10 text-text-primary ring-2 ring-brand-green' : ''}`}
    >
      {label}
    </button>
  );
}

// ─── "New" button ─────────────────────────────────────────────────────────────

function NewButton({ onFolder, onUpload }: { onFolder: () => void; onUpload: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-10 items-center gap-2 rounded-lg bg-brand-green pl-3 pr-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <PlusIcon className="h-4 w-4" />
        New
      </button>
      {open && (
        <div className={`${DROPDOWN_MENU_CLASS} min-w-[200px]`}>
          <button type="button" onClick={() => { setOpen(false); onFolder(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-surface-2">
            <FolderIcon className="h-4 w-4 text-text-muted" /> New folder
          </button>
          <button type="button" onClick={() => { setOpen(false); onUpload(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-surface-2">
            <UploadIcon className="h-4 w-4 text-text-muted" /> File upload
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const router = useRouter();
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { resources, folders, loading, refetch } = useResources(spaceId);

  const [folderId, setFolderId] = useState<string | null>(null);
  const [view, setView] = useState<View>('grid');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<Sort>('name-asc');
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [osDrop, setOsDrop] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { setPinned(getPinned()); }, []);
  // A new space starts at its root; a folder deleted under us falls back to it.
  useEffect(() => { setFolderId(null); }, [spaceId]);
  useEffect(() => {
    if (folderId && !loading && !folders.some(f => f.id === folderId)) setFolderId(null);
  }, [folderId, folders, loading]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
      throw e;
    } finally {
      refetch();
    }
  }, [refetch]);

  function handleTogglePin(id: string) {
    togglePin(id);
    setPinned(getPinned());
  }

  // ── What's on screen ──────────────────────────────────────────────────────

  const searching = search.trim().length > 0;
  const needle = search.trim().toLowerCase();

  // A folder shows everything it holds; Type is the only thing that narrows it.
  const matchesFilters = useCallback(
    (r: Resource) => TYPE_GROUP[typeFilter](r.fileType),
    [typeFilter],
  );

  const compare = useCallback((a: Resource, b: Resource) => {
    if (sort === 'name-asc' || sort === 'name-desc') {
      const v = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return sort === 'name-asc' ? v : -v;
    }
    const v = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sort === 'oldest' ? v : -v;
  }, [sort]);

  const visibleFolders = useMemo(() => {
    if (searching) return folders.filter(f => f.name.toLowerCase().includes(needle));
    return childFolders(folders, folderId);
  }, [folders, folderId, searching, needle]);

  const visibleFiles = useMemo(() => {
    const pool = searching
      ? resources.filter(r => r.name.toLowerCase().includes(needle))
      : resources.filter(r => r.folderId === folderId);
    return pool.filter(matchesFilters).sort(compare);
  }, [resources, folderId, searching, needle, matchesFilters, compare]);

  const trail = folderTrail(folders, folderId);
  const hereLabel = trail.length ? trail[trail.length - 1].name : 'Resources';

  // ── Moves (drag-and-drop and the Move dialog share one path) ─────────────

  const moveItem = useCallback((item: DragItem, targetFolderId: string | null) => {
    if (item.kind === 'file') {
      const file = resources.find(r => r.id === item.id);
      if (!file || file.folderId === targetFolderId) return;
      void act(() => driveApi.moveFile(item.id, targetFolderId)).catch(() => {});
    } else {
      const folder = folders.find(f => f.id === item.id);
      if (!folder || folder.parentId === targetFolderId) return;
      if (targetFolderId && subtree(folders, item.id).has(targetFolderId)) return;
      void act(() => driveApi.moveFolder(item.id, targetFolderId)).catch(() => {});
    }
  }, [resources, folders, act]);

  // ── Files dropped from the desktop land in the open folder ───────────────

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!spaceId || !files.length) return;
    setUploadingCount(files.length);
    const failures: string[] = [];
    for (const file of files) {
      try {
        await driveApi.upload(spaceId, file, folderId);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
      setUploadingCount(n => n - 1);
    }
    if (failures.length) setActionError(failures.join(' · '));
    refetch();
  }, [spaceId, folderId, refetch]);

  const onPageDragOver = (e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setOsDrop(true);
  };
  const onPageDrop = (e: DragEvent) => {
    setOsDrop(false);
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void uploadFiles(Array.from(e.dataTransfer.files));
  };

  // ── Menus ────────────────────────────────────────────────────────────────

  const folderActions = (folder: ResourceFolder): MenuAction[] => [
    { label: 'Open', onSelect: () => { setSearch(''); setFolderId(folder.id); } },
    { label: 'Rename', onSelect: () => setDialog({ kind: 'renameFolder', folder }) },
    { label: 'Move to…', onSelect: () => setDialog({ kind: 'moveFolder', folder }) },
    { label: 'Delete', danger: true, separator: true, onSelect: () => setDialog({ kind: 'deleteFolder', folder }) },
  ];

  const fileActions = (file: Resource): MenuAction[] => [
    { label: 'Preview', onSelect: () => setSelected(file) },
    { label: 'Open full page', onSelect: () => router.push(`/resources/${encodeURIComponent(file.id)}`) },
    ...(file.fileUrl ? [{ label: 'Download', onSelect: () => window.open(file.fileUrl!, '_blank', 'noopener') }] : []),
    { label: pinned.includes(file.id) ? 'Unpin' : 'Pin', onSelect: () => handleTogglePin(file.id) },
    { label: 'Rename', onSelect: () => setDialog({ kind: 'renameFile', file }) },
    { label: 'Move to…', onSelect: () => setDialog({ kind: 'moveFile', file }) },
    { label: 'Delete', danger: true, separator: true, onSelect: () => setDialog({ kind: 'deleteFile', file }) },
  ];

  if (!currentSpace) {
    return (
      <div className="flex h-[calc(100dvh-56px)] w-full items-center justify-center">
        <p className="text-text-muted">Select a space to view resources.</p>
      </div>
    );
  }

  const empty = !loading && !visibleFolders.length && !visibleFiles.length;

  return (
    <div
      className="relative w-full"
      // The drop surface fills the pane exactly, so a page holding three
      // folders has nothing to scroll: 64px navbar + <main>'s pt-4/pb-6 is
      // 104px, less the 16px the nav line's -mt-4 collapses back out of this
      // box's top.
      style={{ minHeight: 'calc(100dvh - 88px)' }}
      onDragOver={onPageDragOver}
      onDragLeave={e => { if (e.currentTarget === e.target) setOsDrop(false); }}
      onDrop={onPageDrop}
    >
      {/* ── Nav line ──────────────────────────────────────────────────
          The Directory's chrome, to the pixel: `-mt-4 -ml-6` cancels
          <main>'s own pt-4 / 24px gutter so the nav sits flush in the
          surface's top-left corner, and it sticks at -top-4 the way the
          pane tab bar does, so the row comes to rest with its bottom at
          32px — which is what the toolbar below sticks to. There is no page
          title: the sidebar says where you are, the breadcrumb says where
          you are inside it. */}
      <div className="sticky -top-4 z-20 -mt-4 -ml-6 flex items-center bg-glass pr-6">
        {/* Keeps the page scrollbar from running up beside the pinned bar. */}
        <PaneTopScrollbarMask />
        <ViewToggle<View>
          size="lg"
          value={view}
          onChange={setView}
          options={[
            { id: 'grid', label: 'Grid' },
            { id: 'list', label: 'List' },
          ]}
        />
        <div className="ml-auto">
          <NewButton
            onFolder={() => setDialog({ kind: 'newFolder' })}
            onUpload={() => setDialog({ kind: 'upload' })}
          />
        </div>
      </div>

      {/* ── Toolbar: breadcrumb, search, filters, count ────────────────
          Welded under the nav line at top-8 with the same -ml-6 bleed, pl-12
          inset and pt-9 / pb-2 rhythm the Directory's toolbar uses, so the row
          starts on the same vertical and sits the same 36px clear of the nav
          line above and the content below. Opaque: the grid scrolls under it.
          Nothing here may get overflow-hidden or the filter menus clip. */}
      <div className="sticky top-8 z-10 -ml-6 bg-glass pt-9 pb-2 pl-12 pr-6">

        {/* Breadcrumb only once there is somewhere to go back to — at the root
            it would be a one-word title of the page you can see you are on.
            The root crumb is a drop target, so a file can be dragged up. */}
        {(trail.length > 0 || searching) && (
          <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-0.5 pb-2">
            <Crumb
              label="Resources"
              active={false}
              onClick={() => { setSearch(''); setFolderId(null); }}
              onDropItem={item => moveItem(item, null)}
            />
            {trail.map((f, i) => (
              <span key={f.id} className="flex items-center gap-0.5">
                <ChevronRightIcon className="h-4 w-4 text-text-muted" />
                <Crumb
                  label={f.name}
                  active={i === trail.length - 1 && !searching}
                  onClick={() => { setSearch(''); setFolderId(f.id); }}
                  onDropItem={item => moveItem(item, f.id)}
                />
              </span>
            ))}
            {searching && (
              <span className="flex items-center gap-0.5">
                <ChevronRightIcon className="h-4 w-4 text-text-muted" />
                <span className="px-2 text-sm font-medium text-text-primary">Search results</span>
              </span>
            )}
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search all resources…"
            size="lg"
            className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
          />
          <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />
          <Dropdown<TypeFilter>
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            active={typeFilter !== 'all'}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'docs', label: 'Documents' },
              { value: 'sheets', label: 'Spreadsheets' },
              { value: 'pdf', label: 'PDFs' },
              { value: 'image', label: 'Images' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Dropdown<Sort>
            label="Sort"
            value={sort}
            onChange={setSort}
            menuWidthClass="min-w-[180px]"
            options={[
              { value: 'name-asc', label: 'Name A–Z' },
              { value: 'name-desc', label: 'Name Z–A' },
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
          {!loading && (
            <span className="ml-auto text-xs text-text-muted">
              {visibleFolders.length ? `${visibleFolders.length} ${visibleFolders.length === 1 ? 'folder' : 'folders'} · ` : ''}
              {visibleFiles.length} {visibleFiles.length === 1 ? 'file' : 'files'}
              {uploadingCount > 0 ? ` · uploading ${uploadingCount}…` : ''}
            </span>
          )}
        </div>
      </div>

      {actionError && (
        <p className="px-6 pb-2 text-xs text-red-600">{actionError}</p>
      )}

      {/* ── Contents ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-7 pb-8">
        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />)}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/4.2] animate-pulse rounded-xl bg-surface-2" />)}
            </div>
          </div>
        ) : empty ? (
          <EmptyState
            title={searching ? 'Nothing matches' : 'This folder is empty'}
            description={searching ? 'Try another name or clear the filters.' : 'Drop files anywhere on this page, or use New.'}
          />
        ) : view === 'grid' ? (
          <>
            {/* No "Folders" / "Files" headings: a folder pill and a file card
                are already nothing alike, so the words only added chrome. */}
            {visibleFolders.length > 0 && (
              <section className="mb-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {visibleFolders.map(f => (
                    <FolderTile
                      key={f.id}
                      folder={f}
                      actions={folderActions(f)}
                      onOpen={() => { setSearch(''); setFolderId(f.id); }}
                      onDropItem={item => moveItem(item, f.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {visibleFiles.length > 0 && (
              <section>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {visibleFiles.map(r => (
                    <FileCard
                      key={r.id}
                      resource={r}
                      selected={selected?.id === r.id}
                      pinned={pinned.includes(r.id)}
                      actions={fileActions(r)}
                      onOpen={() => setSelected(r)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div role="table">
            <div className="grid h-10 grid-cols-[minmax(0,1fr)_140px_100px_40px] items-center gap-4 border-b border-border-default px-3 text-xs font-semibold text-text-muted">
              <span>Name</span>
              <span>{searching ? 'Location' : 'Added'}</span>
              <span>Size</span>
              <span />
            </div>
            {visibleFolders.map(f => (
              <FolderRow
                key={f.id}
                folder={f}
                actions={folderActions(f)}
                onOpen={() => { setSearch(''); setFolderId(f.id); }}
                onDropItem={item => moveItem(item, f.id)}
              />
            ))}
            {visibleFiles.map(r => (
              <FileRow
                key={r.id}
                resource={r}
                selected={selected?.id === r.id}
                pinned={pinned.includes(r.id)}
                actions={fileActions(r)}
                onOpen={() => setSelected(r)}
                location={searching ? folderPathLabel(folders, r.folderId) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Desktop-drop overlay ─────────────────────────────────────────── */}
      {osDrop && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-green bg-brand-green/5">
          <p className="rounded-lg bg-surface-1 px-4 py-2 text-sm font-semibold text-text-primary shadow-float">
            Drop to upload to {hereLabel}
          </p>
        </div>
      )}

      {/* ── Detail drawer ───────────────────────────────────────────────── */}
      <ResourceDetailDrawer
        resource={selected}
        pinned={selected ? pinned.includes(selected.id) : false}
        onClose={() => setSelected(null)}
        onTogglePin={() => selected && handleTogglePin(selected.id)}
        onDelete={() => selected && setDialog({ kind: 'deleteFile', file: selected })}
      />

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      {dialog?.kind === 'upload' && (
        <ResourceUploadDialog
          spaceId={currentSpace.id}
          folderId={folderId}
          folderName={hereLabel}
          onClose={() => setDialog(null)}
          onUploaded={refetch}
        />
      )}
      {dialog?.kind === 'newFolder' && (
        <NameDialog
          title={`New folder in ${hereLabel}`}
          submitLabel="Create"
          onSubmit={name => act(() => driveApi.createFolder(currentSpace.id, name, folderId))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'renameFolder' && (
        <NameDialog
          title="Rename folder"
          initial={dialog.folder.name}
          submitLabel="Rename"
          onSubmit={name => act(() => driveApi.renameFolder(dialog.folder.id, name))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'renameFile' && (
        <NameDialog
          title="Rename file"
          initial={dialog.file.name}
          submitLabel="Rename"
          onSubmit={name => act(() => driveApi.renameFile(dialog.file.id, name))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'moveFolder' && (
        <MoveDialog
          folders={folders}
          itemName={dialog.folder.name}
          currentFolderId={dialog.folder.parentId}
          movingFolderId={dialog.folder.id}
          onMove={target => act(() => driveApi.moveFolder(dialog.folder.id, target))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'moveFile' && (
        <MoveDialog
          folders={folders}
          itemName={dialog.file.name}
          currentFolderId={dialog.file.folderId}
          onMove={target => act(() => driveApi.moveFile(dialog.file.id, target))}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === 'deleteFolder'}
        title={dialog?.kind === 'deleteFolder' ? `Delete “${dialog.folder.name}”?` : ''}
        body="Subfolders inside it are deleted too. Files inside are kept and moved up a level."
        confirmLabel="Delete folder"
        destructive
        onConfirm={async () => {
          if (dialog?.kind !== 'deleteFolder') return;
          const id = dialog.folder.id;
          setDialog(null);
          await act(() => driveApi.deleteFolder(id)).catch(() => {});
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteFile'}
        title={dialog?.kind === 'deleteFile' ? `Delete “${dialog.file.name}”?` : ''}
        body="The file, its comments and its search index are removed. This cannot be undone."
        confirmLabel="Delete file"
        destructive
        onConfirm={async () => {
          if (dialog?.kind !== 'deleteFile') return;
          const id = dialog.file.id;
          setDialog(null);
          if (selected?.id === id) setSelected(null);
          await act(() => driveApi.deleteFile(id)).catch(() => {});
        }}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
