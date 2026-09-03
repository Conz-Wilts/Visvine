'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chip } from '@/components/ui';
import ImageCropper from '@/features/directory/components/data/ImageCropper';
import { useNodeSearch, type NodeSearchResult } from '@/features/shared/hooks/useNodeSearch';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { primeNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { clearContextCache } from '@/features/notes/hooks/useSpaceContextData';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fieldsForType, type TypeFieldDef } from '@/lib/create/typeFields';
import { fetchJsonBody } from '@/lib/fetchJson';
import { uploadCroppedImage, validateImageFile } from '@/lib/imageUpload';
import type { NBNode, SpaceAlias } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import MatchPanel from '../MatchPanel';
import { LocationAutocomplete } from '../LocationAutocomplete';
import { FormFooter, fieldClass, splitTags, useCreateSubmit, type InlineFormProps } from './shared';

type EntityKind = 'person' | 'space' | 'resource';

const NAME_PLACEHOLDER: Record<EntityKind, string> = {
  person: 'Full name',
  space: 'Name',
  resource: 'Name',
};

/** Where the new thing opens: a person on their profile, the rest on the note. */
function createdHref(type: EntityKind, nodeId: string): string {
  const id = encodeURIComponent(nodeId);
  return type === 'person' ? `/directory/${id}` : `/directory/${id}?tab=context`;
}

/**
 * A person, a space record or a resource: the name, the rows the type shows
 * on its note (lib/create/typeFields.ts — one schema for the create form, the
 * profile and the Directory table), tags, and an alias when the space has any
 * for the type. Matches from other spaces appear under the name as you type;
 * taking one fills the rows and binds the card to that identity.
 */
function EntityForm({ type, spaceId, accent, onDone }: InlineFormProps & { type: EntityKind }) {
  const { currentSpace } = useSpace();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  const [alias, setAlias] = useState<string | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [followGlobal, setFollowGlobal] = useState(false);
  const [pickedSpace, setPickedSpace] = useState<{ ref: string; name: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [conflict, setConflict] = useState<{ nodeId: string | null } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), DOCK_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const defs = fieldsForType(type);
  const imageDef = defs.find((f) => f.kind === 'image');
  const rows = defs.filter((f) => f.kind !== 'image');
  const aliases = aliasesForType((currentSpace?.aliases as SpaceAlias[] | undefined) ?? [], type);

  const search = useNodeSearch(name, type, fields.email ?? '');
  const showMatches = !dismissed && name.trim().length >= 2 && (search.results.length > 0 || search.loading);

  // Any edit by hand detaches from a picked identity: the server resolves the
  // (now possibly different) person from scratch.
  const edit = (next: () => void) => { setIdentityId(null); setFollowGlobal(false); next(); };

  const takeMatch = useCallback((r: NodeSearchResult) => {
    const meta = r.metadata ?? {};
    setName(r.name);
    setFields((prev) => {
      const out = { ...prev };
      for (const def of rows) {
        const v = def.target === 'column' && def.column ? r[def.column as 'subtitle' | 'location'] : meta[def.key];
        if (typeof v === 'string' && v) out[def.key] = v;
      }
      return out;
    });
    if (r.tags?.length) setTags(r.tags.join(', '));
    if (r.image_url && !photo) setFields((prev) => ({ ...prev, image_url: r.image_url as string }));
    setIdentityId(r.identity_id ?? null);
    setFollowGlobal(!!r.global && !!r.identity_id);
    const ref = typeof meta.spaceRef === 'string' ? meta.spaceRef : null;
    setPickedSpace(ref ? { ref, name: r.name } : null);
    setDismissed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const run = useCallback(async () => {
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
        tags: splitTags(tags),
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
      // A failed photo is not a failed person: the card exists, the photo can be added on it.
      const url = await uploadCroppedImage('card', node.id, photo.blob).catch(() => null);
      if (url) {
        await fetchJsonBody(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', { image_url: url }).catch(() => undefined);
        node.image_url = url;
      }
    }
    primeNodeProfile(node.id, node);
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    // The directory grid, the graph and the `[[ ]]` picker all read a cache.
    clearContextCache(spaceId);
    return createdHref(type, node.id);
  }, [spaceId, type, name, alias, identityId, followGlobal, pickedSpace, fields, tags, photo]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  const usable = name.trim().length > 0;
  const preview = photo?.preview ?? fields.image_url ?? null;

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="relative flex items-center gap-2">
        {imageDef && (
          <PhotoButton
            label={imageDef.label}
            preview={preview}
            round={type === 'person'}
            onPick={(file) => setCropping(file)}
            onClear={() => { setPhoto(null); setFields((p) => { const { image_url: _drop, ...rest } = p; return rest; }); }}
          />
        )}
        <input
          ref={nameRef}
          className={fieldClass}
          placeholder={NAME_PLACEHOLDER[type]}
          aria-label={NAME_PLACEHOLDER[type]}
          value={name}
          onChange={(e) => edit(() => { setName(e.target.value); setDismissed(false); })}
          onKeyDown={(e) => { if (e.key === 'Escape' && showMatches) { e.stopPropagation(); setDismissed(true); } }}
          autoComplete="off"
        />
        {showMatches && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-default bg-surface-1 shadow-float">
            <MatchPanel results={search.results} loading={search.loading} onSelect={takeMatch} />
          </div>
        )}
      </div>

      {pickedSpace && pickedSpace.name.trim() === name.trim() && (
        <p className="px-0.5 text-xs text-text-muted">Links to the space “{pickedSpace.name}”</p>
      )}

      {rows.map((def) => (
        <Row
          key={def.key}
          def={def}
          value={fields[def.key] ?? ''}
          onChange={(v) => edit(() => setFields((p) => ({ ...p, [def.key]: v })))}
        />
      ))}

      <input
        className={fieldClass}
        placeholder="Tags"
        aria-label="Tags"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />

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

      <FormFooter ready={usable} saving={saving} error={error} />
      {conflict?.nodeId && (
        <a
          href={`/directory/${encodeURIComponent(conflict.nodeId)}`}
          className="-mt-1 text-xs text-text-secondary underline-offset-2 hover:underline"
          style={{ color: accent }}
        >
          Open it
        </a>
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
    </form>
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

/** The photo (or logo) beside the name: a square you drop or pick a file into. */
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
        className={`flex h-9 w-9 items-center justify-center overflow-hidden ${shape} bg-surface-2 text-text-muted transition-colors hover:text-text-primary`}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

export function PersonForm(props: InlineFormProps) { return <EntityForm {...props} type="person" />; }
export function SpaceRecordForm(props: InlineFormProps) { return <EntityForm {...props} type="space" />; }
export function ResourceForm(props: InlineFormProps) { return <EntityForm {...props} type="resource" />; }
