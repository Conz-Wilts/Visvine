'use client';

import { useCallback, useMemo, useState } from 'react';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { noteHref } from '@/lib/notes/entities';
import { newIndexContent } from '@/lib/notes/shared/indexNote';
import { availableFolderPath, noteFileSlug } from '@/lib/notes/shared/newContext';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { FolderPicker, PathPreview, useContextFolderTree } from '../ContextDestination';
import { FormFooter, fieldClass, useAutoFocus, useCreateSubmit, type InlineFormProps } from './shared';

/**
 * A folder in the context: a name and where it goes. A folder IS its index
 * note (lib/notes/shared/indexNote.ts), so this writes that note and lands on
 * it.
 */
export default function FolderForm({ spaceId, contextName, folder: initialFolder, onDone }: InlineFormProps) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(initialFolder ?? '');
  const tree = useContextFolderTree(spaceId, true);
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  const folderPaths = useMemo(() => new Set(tree.folders.map((f) => f.path)), [tree.folders]);
  const usable = noteFileSlug(name) !== 'untitled' || name.trim().toLowerCase() === 'untitled';
  const path = usable ? availableFolderPath(parent, name, folderPaths) : '';

  const run = useCallback(async () => {
    const { indexPath } = await notesApi.createFolder(spaceId, path, newIndexContent({ title: name.trim() }));
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    return noteHref(indexPath);
  }, [spaceId, path, name]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        ref={nameRef}
        className={fieldClass}
        placeholder="Folder name"
        aria-label="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FolderPicker folders={tree.folders} value={parent} onChange={setParent} contextName={contextName} />
      {path && <PathPreview path={`${path}/`} />}
      <FormFooter ready={usable} saving={saving} error={error} />
    </form>
  );
}
