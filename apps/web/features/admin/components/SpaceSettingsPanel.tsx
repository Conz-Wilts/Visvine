'use client';

import { useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { Trash2Icon } from '@/features/shared/icons';
import { Space } from '@/lib/types';
import type { SpaceVisibility } from '@/lib/spaces/publicName';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { Alert, Button, ConfirmDialog, Field, Input, Textarea, inputBaseClass } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useConsoleAction, useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import { FetchJsonError, fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import SpaceImageUpload from '@/features/spaces/components/SpaceImageUpload';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { SPACE_DESCRIPTION_MAX_WORDS, clampWords, countWords } from '@/lib/spaces/shared/description';
import RegionAutocomplete from '@/features/spaces/components/RegionAutocomplete';
import RoomDials from '@/features/spaces/components/RoomDials';
import NightlySection from '@/features/admin/components/NightlySection';

interface Props {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const iconProps = {
  className: 'h-5 w-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
} as const;

const GlobeIcon = () => (
  <svg {...iconProps} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5-2.4 3.75-5.4 3.75-9S14.5 5.4 12 3m0 18c-2.5-2.4-3.75-5.4-3.75-9S9.5 5.4 12 3M3.6 9h16.8M3.6 15h16.8" />
  </svg>
);
const LockIcon = () => (
  <svg {...iconProps} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5z" />
  </svg>
);

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function SpaceSettingsPanel({ space, onSaved }: Props) {
  const router = useSpaceRouter();
  const { refreshSpace, spaces } = useSpace();
  // A sub-space names its parent; a top-level space lists its sub-spaces.
  // Nesting is one level, so a space is one or the other (docs/sub-spaces.md).
  const parent = space.parentId ? (spaces.find((s) => s.id === space.parentId) ?? null) : null;
  const isSubspace = Boolean(space.parentId);
  const subspaceCount = spaces.filter((s) => s.parentId === space.id).length;

  const [name, setName] = useState(space.name);
  const [nameError, setNameError] = useState('');
  const [description, setDescription] = useState(space.description);
  const [location, setLocation] = useState(space.location ?? '');
  const [imageUrl, setImageUrl] = useState(space.imageUrl ?? '');
  const [visibility, setVisibility] = useState<SpaceVisibility>(
    space.visibility === 'private' ? 'private' : 'public'
  );
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [visibilityError, setVisibilityError] = useState('');

  const runAction = useConsoleAction();

  const saveSettings = async (patch: Record<string, unknown>) => {
    const data = await fetchJsonBody<{ space: Partial<Space> }>(`/api/spaces/${space.id}/settings`, 'PUT', patch);
    onSaved(data.space);
  };

  // Every edit saves itself: text fields debounce, pickers persist instantly.
  const { queue, flush } = useConsoleAutosave(async (patch) => {
    try {
      await saveSettings(patch);
    } catch (err) {
      // The queue only reports "Couldn't save" — a rejected name needs to say
      // WHY, on the field the admin has to change. Re-thrown so the console
      // pill still shows the failure and offers its retry.
      if (err instanceof FetchJsonError && err.code === 'name_taken' && patch.name !== undefined) {
        setNameError(err.message);
      }
      throw err;
    }
  });

  const handleNameChange = (value: string) => {
    setName(value);
    if (!value.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    queue({ name: value.trim() }, { debounceMs: 800 });
  };

  const handleDelete = async () => {
    setDeleteError('');
    try {
      await fetchJson(`/api/data/spaces?id=${space.id}`, { method: 'DELETE' });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete space');
      setConfirmDelete(false);
      return;
    }
    setConfirmDelete(false);
    await refreshSpace();
    router.replace('/directory');
  };

  const isPrivate = visibility !== 'public';

  // Not the autosave queue like the other fields: going public can be REFUSED
  // (a public space's name must be free — lib/spaces/publicName.ts), and
  // the queue swallows the server's message. useConsoleAction reports into the
  // same console pill but re-throws, so the toggle can undo itself and say why.
  const applyVisibility = async (next: SpaceVisibility) => {
    const previous = visibility;
    setVisibilityError('');
    setVisibility(next);
    try {
      await runAction(() => saveSettings({ visibility: next }));
    } catch (err) {
      setVisibility(previous);
      setVisibilityError(err instanceof Error ? err.message : 'Failed to change visibility');
    }
  };

  // Going public exposes everything in here to anyone, so it asks first.
  // Going private is the safe direction and applies straight away.
  const handleVisibilityToggle = (nextIsPrivate: boolean) => {
    if (nextIsPrivate) void applyVisibility('private');
    else setConfirmPublic(true);
  };

  return (
    <div className="w-full space-y-8">
      {/* Avatar, name, blurb and where it is — one block, no heading: the field
          labels already say what each one is. Visibility rides on the avatar
          row: it's the setting with consequences for who sees the rest, so it
          stays at the top rather than getting buried below the form. */}
      <section>
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            {/* A sub-space wears its parent's mark (spaceMark), so there is
                nothing here to upload: one house, one picture, and the name
                below is what tells the rooms apart. */}
            {isSubspace ? (
              <div className="flex items-center gap-3">
                <SpaceAvatar
                  name={parent?.name ?? space.name}
                  imageUrl={parent?.imageUrl}
                  size="xl"
                />
                <p className="text-xs text-text-muted">
                  Wears {parent ? <span className="font-medium text-text-secondary">{parent.name}</span> : 'its parent'}&apos;s picture
                </p>
              </div>
            ) : (
              <SpaceImageUpload
                space={{ ...space, imageUrl }}
                onUploadComplete={url => {
                  setImageUrl(url);
                  onSaved({ imageUrl: url });
                }}
                size="xl"
              />
            )}
            {/* A room's listing replaces the Private/Public toggle: who can
                see it is one of three answers, set with the rest of its dials
                below (RoomDials). A top-level space keeps the toggle. */}
            {!isSubspace && (
              <div className="flex flex-col items-end text-right">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <span className={isPrivate ? 'text-brand-dark-green' : 'text-text-muted'}>
                    {isPrivate ? <LockIcon /> : <GlobeIcon />}
                  </span>
                  {isPrivate ? 'Private' : 'Public'}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {isPrivate ? 'Invite or admin only' : 'Anyone can find and join'}
                </p>
                <Toggle
                  className="mt-3"
                  checked={isPrivate}
                  onChange={handleVisibilityToggle}
                  aria-label="Private space"
                />
              </div>
            )}
          </div>
          {/* A refused publish (name already taken by another public space)
              leaves the toggle back where it was — this says why, and the fix
              is the Name field right below. */}
          {visibilityError && <Alert variant="error">{visibilityError}</Alert>}
          {isSubspace && (
            <p className="text-sm text-text-muted">
              A sub-space of <span className="font-medium text-text-secondary">{parent?.name ?? space.parentId}</span> —
              its own members, admins and tools. What it shows the house, who may walk in and who holds its keys are its own to set, below.
            </p>
          )}
          <div className="space-y-5">
            <Field label="Name" error={nameError}>
              <Input
                type="text"
                required
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                onBlur={flush}
                placeholder="Space name"
              />
            </Field>
            <Field label="Description">
              <div className="relative">
                <Textarea
                  rows={3}
                  value={description}
                  onChange={e => {
                    const next = clampWords(e.target.value);
                    setDescription(next);
                    queue({ description: next }, { debounceMs: 800 });
                  }}
                  onBlur={flush}
                  className="pb-7"
                />
                <span
                  aria-live="polite"
                  className={`pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums ${
                    countWords(description) >= SPACE_DESCRIPTION_MAX_WORDS ? 'text-red-500' : 'text-text-muted'
                  }`}
                >
                  {countWords(description)}/{SPACE_DESCRIPTION_MAX_WORDS} words
                </span>
              </div>
            </Field>
            <Field label="Location">
              <RegionAutocomplete
                value={location}
                onType={label => {
                  setLocation(label);
                  queue({ location: label }, { debounceMs: 800 });
                }}
                onPick={label => {
                  setLocation(label);
                  queue({ location: label });
                }}
                onBlur={flush}
                className={inputBaseClass}
              />
            </Field>
          </div>
        </div>
      </section>

      {isSubspace && (
        <RoomDials
          space={space}
          parentName={parent?.name ?? 'the parent space'}
          save={(patch) => runAction(() => saveSettings(patch))}
        />
      )}

      <NightlySection key={space.id} spaceId={space.id} />

      {/* The button names the action, so it stands alone — no heading, no label row. */}
      <section>
        {deleteError && <Alert variant="error" className="mb-4">{deleteError}</Alert>}
        <Button
          variant="danger"
          className="inline-flex items-center gap-2 text-base"
          onClick={() => { setDeleteError(''); setConfirmDelete(true); }}
        >
          <Trash2Icon size={18} aria-hidden />
          Delete this space
        </Button>
      </section>

      <ConfirmDialog
        open={confirmPublic}
        title="Make this space public?"
        body={
          <>
            Anyone will be able to find <span className="font-semibold">{space.name}</span> in
            Discover and join it without an invite.
            {isSubspace && (
              <> Its context will also show in <span className="font-semibold">{parent?.name ?? 'the parent space'}</span>, read-only, to everyone there.</>
            )}
          </>
        }
        confirmLabel="Make public"
        onConfirm={() => {
          void applyVisibility('public');
          setConfirmPublic(false);
        }}
        onClose={() => setConfirmPublic(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete space"
        body={
          <>
            This permanently deletes <span className="font-semibold">{space.name}</span> — every
            record, connection, note, post and membership in it
            {subspaceCount > 0 && (
              <>, and its {subspaceCount === 1 ? 'sub-space' : `${subspaceCount} sub-spaces`} with everything in {subspaceCount === 1 ? 'it' : 'them'}</>
            )}. This cannot be undone.
          </>
        }
        confirmLabel="Delete space"
        destructive
        confirmText={space.name}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
