'use client';

import Link from '@/features/shared/components/SpaceLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chip } from '@/components/ui';
import ImageCropper from '@/features/directory/components/data/ImageCropper';
import { useNodeSearch, type NodeSearchResult } from '@/features/shared/hooks/useNodeSearch';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { primeNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { clearContextCache } from '@/features/notes/hooks/useSpaceContextData';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fieldsForType, type TypeFieldDef } from '@/lib/create/typeFields';
import { fetchJsonBody } from '@/lib/fetchJson';
import { uploadCroppedImage, validateImageFile } from '@/lib/imageUpload';
import type { NBNode, SpaceAlias } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import { resourceNameOf } from '@/lib/resources/shared/fileNode';
import { formatBytes } from '@/lib/utils';
import MatchPanel from '../MatchPanel';
import { LocationAutocomplete } from '../LocationAutocomplete';
import { fieldClass, SetupSection, useDraftCommit, type DraftKindProps } from './shared';

export type EntityKind = 'person' | 'space' | 'resource';

const SECTION_LABEL: Record<EntityKind, string> = {
  person: 'Who they are',
  space: 'What it is',
  resource: 'What this is',
};

/** The Drive's per-file ceiling (lib/resources/service.ts#MAX_RESOURCE_BYTES). */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Where the new thing opens: a person on their profile, a resource holding a
 * file on that file, the rest on the note.
 */
function createdHref(type: EntityKind, nodeId: string, hasFile: boolean): string {
  const id = encodeURIComponent(nodeId);
  return type === 'person' || hasFile ? `/directory/${id}` : `/directory/${id}?tab=context`;
}

/**
 * A person, a space record or a resource, drafted as its own context note:
 * the title above is the name and the editor below is the prose the note
 * opens with, so this surface owns only what a directory card needs beside
 * them — the photo, the rows the type shows (lib/create/typeFields.ts, one
 * schema for this, the profile and the Directory table) and the alias it
 * wears.
 *
 * Matches from other spaces appear under the name as it is typed; taking one
 * fills the rows and binds the card to that identity. One POST writes both the
 * node and its note (/api/directory/entities).
 */
export default function EntitySetup({
  type,
  initialAlias,
  shared,
  onReadyChange,
  registerCommit,
}: DraftKindProps & { type: EntityKind; initialAlias: string | null }) {
  const { currentSpace } = useSpace();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alias, setAlias] = useState<string | null>(initialAlias);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [followGlobal, setFollowGlobal] = useState(false);
  const [pickedSpace, setPickedSpace] = useState<{ ref: string; name: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [conflict, setConflict] = useState<{ nodeId: string | null } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const { spaceId, title: name, accent, setTitle, setTags } = shared;

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const defs = fieldsForType(type);
  const imageDef = defs.find((f) => f.kind === 'image');
  const rows = defs.filter((f) => f.kind !== 'image');
  const aliases = aliasesForType((currentSpace?.aliases as SpaceAlias[] | undefined) ?? [], type);

  const search = useNodeSearch(name, type, fields.email ?? '');
  const showMatches = !dismissed && name.trim().length >= 2 && (search.results.length > 0 || search.loading);

  // Any edit by hand detaches from a picked identity: the server resolves the
  // (now possibly different) person from scratch. The title is the draft's,
  // not this surface's, so a name change is watched rather than intercepted.
  const edit = (next: () => void) => { setIdentityId(null); setFollowGlobal(false); next(); };
  const lastName = useRef(name);
  useEffect(() => {
    if (name === lastName.current) return;
    lastName.current = name;
    setIdentityId(null);
    setFollowGlobal(false);
    setDismissed(false);
  }, [name]);

  const takeMatch = useCallback((r: NodeSearchResult) => {
    const meta = r.metadata ?? {};
    setTitle(r.name);
    lastName.current = r.name;
    setFields((prev) => {
      const out = { ...prev };
      for (const def of rows) {
        const v = def.target === 'column' && def.column ? r[def.column as 'subtitle' | 'location'] : meta[def.key];
        if (typeof v === 'string' && v) out[def.key] = v;
      }
      if (typeof r.image_url === 'string' && r.image_url && !photo) out.image_url = r.image_url;
      return out;
    });
    // Tags belong to the draft's own row, not to this surface.
    if (r.tags?.length) setTags(r.tags);
    setIdentityId(r.identity_id ?? null);
    setFollowGlobal(!!r.global && !!r.identity_id);
    const ref = typeof meta.spaceRef === 'string' ? meta.spaceRef : null;
    setPickedSpace(ref ? { ref, name: r.name } : null);
    setDismissed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, setTitle, setTags]);

  const commit = useCallback(async () => {
    setConflict(null);
    const res = await fetch('/api/directory/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId,
        type,
        name: name.trim(),
        alias,
        identityId,
        followGlobal,
        spaceRef: pickedSpace && pickedSpace.name.trim() === name.trim() ? pickedSpace.ref : null,
        fields,
        // The prose written on the draft IS the note's body — the reason this
        // is made here rather than in a form that only ever collected rows.
        body: shared.body(),
        tags: shared.tags,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setConflict({ nodeId: data.existingNodeId ?? null });
      throw new Error(data.error ?? 'That already exists');
    }
    if (!res.ok) throw new Error(data.error || 'Failed to create');

    const node = data.node as NBNode;
    if (photo) {
      // A failed photo is not a failed person: the card exists, and the photo
      // can be added on it.
      const url = await uploadCroppedImage('card', node.id, photo.blob).catch(() => null);
      if (url) {
        await fetchJsonBody(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', { image_url: url }).catch(() => undefined);
        node.image_url = url;
      }
    }
    let attached = false;
    if (file) {
      // The file is the resource's content: stored, indexed and bound to this
      // node in one call. A failed upload leaves the resource, which can take a
      // file again.
      const form = new FormData();
      form.append('file', file);
      form.append('spaceId', spaceId);
      form.append('nodeId', node.id);
      const upload = await fetch('/api/resources/upload', { method: 'POST', body: form }).catch(() => null);
      if (upload?.ok) {
        const uploaded = (await upload.json().catch(() => null)) as { id?: string } | null;
        if (uploaded?.id) {
          node.metadata = { ...(node.metadata ?? {}), fileId: uploaded.id };
          attached = true;
        }
      }
    }
    primeNodeProfile(node.id, node);
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    // The directory grid, the graph and the `[[ ]]` picker all read a cache.
    clearContextCache(spaceId);
    return createdHref(type, node.id, attached);
  }, [spaceId, type, name, alias, identityId, followGlobal, pickedSpace, fields, photo, file, shared]);

  useDraftCommit({ onReadyChange, registerCommit }, name.trim().length > 0, commit);

  const preview = photo?.preview ?? fields.image_url ?? null;

  return (
    <SetupSection label={SECTION_LABEL[type]}>
      {showMatches && (
        <div className="overflow-hidden rounded-lg border border-border-default bg-surface-1 shadow-float">
          <MatchPanel results={search.results} loading={search.loading} onSelect={takeMatch} />
        </div>
      )}

      {pickedSpace && pickedSpace.name.trim() === name.trim() && (
        <p className="px-0.5 text-xs text-text-muted">Links to the space “{pickedSpace.name}”</p>
      )}

      <div className="flex items-start gap-3">
        {imageDef && (
          <PhotoButton
            label={imageDef.label}
            preview={preview}
            round={type === 'person'}
            onPick={(file) => setCropping(file)}
            onClear={() => { setPhoto(null); setFields((p) => { const { image_url: _drop, ...rest } = p; return rest; }); }}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((def) => (
            <Row
              key={def.key}
              def={def}
              value={fields[def.key] ?? ''}
              onChange={(v) => edit(() => setFields((p) => ({ ...p, [def.key]: v })))}
            />
          ))}
          {type === 'resource' && (
            <FileRow
              file={file}
              onPick={(picked) => {
                setFile(picked);
                if (!name.trim()) setTitle(resourceNameOf(picked.name));
              }}
              onClear={() => setFile(null)}
            />
          )}
        </div>
      </div>

      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-0.5" role="radiogroup" aria-label="Alias">
          {aliases.map((a) => (
            <Chip
              key={a.id ?? a.name}
              size="sm"
              tone={alias === a.name ? 'solid' : 'muted'}
              color={alias === a.name ? a.color : null}
              onClick={() => setAlias(alias === a.name ? null : a.name)}
            >
              {a.name}
            </Chip>
          ))}
        </div>
      )}

      {conflict?.nodeId && (
        <Link
          href={`/directory/${encodeURIComponent(conflict.nodeId)}`}
          className="text-xs text-text-secondary underline-offset-2 hover:underline"
          style={{ color: accent }}
        >
          Open it
        </Link>
      )}

      {cropping && typeof document !== 'undefined' &&
        createPortal(
          <ImageCropper
            imageFile={cropping}
            onCrop={(blob) => {
              if (photo) URL.revokeObjectURL(photo.preview);
              setPhoto({ blob, preview: URL.createObjectURL(blob) });
              setCropping(null);
            }}
            onCancel={() => setCropping(null)}
            shape={type === 'person' ? 'circle' : 'square'}
            outputWidth={400}
            outputHeight={400}
            previewName={name || undefined}
            previewColor={accent}
          />,
          document.body,
        )}
    </SetupSection>
  );
}

function Row({ def, value, onChange }: { def: TypeFieldDef; value: string; onChange: (v: string) => void }) {
  if (def.kind === 'location') {
    return <LocationAutocomplete value={value} onChange={onChange} placeholder={def.label} className={fieldClass} />;
  }
  return (
    <input
      className={fieldClass}
      type={def.kind === 'number' ? 'number' : def.kind === 'date' ? 'date' : 'text'}
      inputMode={def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : undefined}
      placeholder={def.label}
      aria-label={def.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The photo (or logo) beside the rows: a square to drop or pick a file into. */
function PhotoButton({
  label,
  preview,
  round,
  onPick,
  onClear,
}: {
  label: string;
  preview: string | null;
  round: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const take = (file: File | undefined) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setProblem(err); return; }
    setProblem(null);
    onPick(file);
  };
  const shape = round ? 'rounded-full' : 'rounded-lg';
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => (preview ? onClear() : inputRef.current?.click())}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }}
        aria-label={preview ? `Remove ${label.toLowerCase()}` : label}
        title={problem ?? undefined}
        className={`flex h-[68px] w-[68px] items-center justify-center overflow-hidden ${shape} bg-surface-2 text-text-muted transition-colors hover:text-text-primary`}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

/** A resource's file: picked or dropped, shown by name until it is created. */
function FileRow({ file, onPick, onClear }: {
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const take = (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) { setProblem(`Over ${formatBytes(MAX_FILE_BYTES)}`); return; }
    setProblem(null);
    onPick(picked);
  };
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }}
      className={`${fieldClass} flex items-center justify-between gap-2`}
    >
      {file ? (
        <>
          <span className="min-w-0 truncate text-text-primary">
            {file.name} <span className="text-text-muted">· {formatBytes(file.size)}</span>
          </span>
          <button type="button" onClick={onClear} aria-label="Remove file" className="shrink-0 text-text-muted hover:text-text-primary">
            ×
          </button>
        </>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="w-full text-left text-text-muted hover:text-text-primary">
          {problem ?? 'File'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
