'use client';
// The Resources tab of the Directory: a space's Drive — folder tiles, file
// cards, upload by dropping onto the page, preview in a drawer. The toolbar is
// the search box and the breadcrumb and nothing else. It renders inside the
// directory pane under the Grid / Context / Resources tab bar
// (app/(auth)/directory/page.tsx), so its toolbar sits exactly where the
// Directory's own does; `/resources/<id>` is still a file's full page, and
// `/resources` sends you here.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useResources } from '@/features/resources/hooks/useResources';
import ResourceDetailDrawer from '@/features/resources/components/ResourceDetailDrawer';
import { getPinned, togglePin } from '@/features/resources/components/resourceUi';
import {
  FileCard, FolderTile, useDropTarget,
  type DragItem, type MenuAction,
} from '@/features/resources/components/driveItems';
import { MoveDialog, NameDialog } from '@/features/resources/components/driveDialogs';
import { driveApi } from '@/features/resources/lib/driveApi';
import { childFolders, folderTrail, subtree } from '@/features/resources/lib/tree';
import { ConfirmDialog, EmptyState, SearchInput } from '@/components/ui';
import ContentReveal from '@/components/ui/ContentReveal';
import { ChevronRightIcon } from '@/features/shared/icons';
import type { Resource, ResourceFolder } from '@/lib/types';

/** Tiles and cards share one column track, so they line up and neither
    stretches to half the screen on a wide monitor. */
const DRIVE_GRID = 'grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]';

type Dialog =
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

interface ResourcesBrowserProps {
  /** The tab panel's id and role, when this is a Directory view. */
  id?: string;
  role?: string;
}

export default function ResourcesBrowser({ id, role }: ResourcesBrowserProps = {}) {
  const router = useRouter();
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { resources, folders, loading, refetch } = useResources(spaceId);

  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [osDrop, setOsDrop] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const visibleFolders = useMemo(() => {
    if (searching) return folders.filter(f => f.name.toLowerCase().includes(needle));
    return childFolders(folders, folderId);
  }, [folders, folderId, searching, needle]);

  const visibleFiles = useMemo(() => {
    const pool = searching
      ? resources.filter(r => r.name.toLowerCase().includes(needle))
      : resources.filter(r => r.folderId === folderId);
    // Newest first, always — there is no order to choose.
    return [...pool].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [resources, folderId, searching, needle]);

  const trail = folderTrail(folders, folderId);
  /** The open folder, named for the drop overlay. */
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
    setUploading(true);
    const failures: string[] = [];
    for (const file of files) {
      try {
        await driveApi.upload(spaceId, file, folderId);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
    setUploading(false);
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

  if (!currentSpace) return null;

  const empty = !loading && !visibleFolders.length && !visibleFiles.length;

  return (
    // The drop target is the whole box and never moves — a page you can drag a
    // file onto must not be sliding while you aim at it. The reveal is the
    // content inside it, gated on the Drive's own fetch so the entrance plays
    // over files rather than over their skeletons.
    <div
      className="relative w-full"
      id={id}
      role={role}
      onDragOver={onPageDragOver}
      onDragLeave={e => { if (e.currentTarget === e.target) setOsDrop(false); }}
      onDrop={onPageDrop}
    >
      <ContentReveal ready={!loading}>
      {/* ── Toolbar: search and breadcrumb ──────────────────────────────
          The Directory toolbar's chrome to the pixel — sticky flush under
          the shell band's strip, the same -ml-6 bleed, pl-12 inset and pt-1 / pb-2
          rhythm — so switching Grid → Resources moves nothing but the content.
          The search box comes first, where it sits on every other tab; the
          breadcrumb follows it. Opaque: the grid scrolls under it. */}
      <div className="sticky top-0 z-10 -ml-6 bg-glass pt-1 pb-2 pl-12 pr-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search all resources…"
            size="lg"
            className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
          />
          {uploading && <span className="text-xs text-text-muted">Uploading…</span>}
        </div>

        {/* Breadcrumb only once there is somewhere to go back to — at the root
            it would be a one-word title of the page you can see you are on.
            The root crumb is a drop target, so a file can be dragged up. */}
        {(trail.length > 0 || searching) && (
          <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-0.5 pt-2">
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
      </div>

      {actionError && (
        <p className="px-6 pb-2 text-xs text-red-600">{actionError}</p>
      )}

      {/* ── Contents ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-7 pb-8">
        {loading ? (
          <div className="space-y-6">
            <div className={DRIVE_GRID}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />)}
            </div>
            <div className={DRIVE_GRID}>
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/4.2] animate-pulse rounded-xl bg-surface-2" />)}
            </div>
          </div>
        ) : empty ? (
          <EmptyState
            title={searching ? 'Nothing matches' : 'This folder is empty'}
            description={searching ? 'Try another name.' : 'Drop files anywhere on this page to upload them.'}
          />
        ) : (
          <>
            {/* No "Folders" / "Files" headings: a folder pill and a file card
                are already nothing alike, so the words only added chrome. */}
            {visibleFolders.length > 0 && (
              <section className="mb-6">
                <div className={DRIVE_GRID}>
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
                <div className={DRIVE_GRID}>
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
      </ContentReveal>
    </div>
  );
}
