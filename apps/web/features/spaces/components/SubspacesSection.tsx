'use client';

// The Sub-spaces section of a space's console (docs/sub-spaces.md): the
// spaces that live under this one, and the one act only this space's admins
// can perform — creating another. A sub-space is its own tenant from the
// moment it exists (own members, own admins, own tools), so a row here is a
// listing, not a control: what an admin of THIS space can do to one is see
// it, open it if they are in it, and know whether its context flows up.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Modal } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { ensureRootIndexNote } from '@/features/notes/lib/rootIndex';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { PlusIcon } from '@/features/shared/icons';

interface SubspaceDto {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  visibility: 'public' | 'private';
  memberCount: number;
}

export default function SubspacesSection({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const router = useRouter();
  const { joinedSpaces, refreshSpace, setCurrentSpace } = useSpace();
  const [rows, setRows] = useState<SubspaceDto[] | null>(null);
  const [creating, setCreating] = useState(false);

  // Through the shared request cache: a return to General paints the last
  // list at once. A write here drops the key first, so it reads fresh.
  const key = `spaces:subspaces:${spaceId}`;
  const load = useCallback(async (fresh = false) => {
    if (fresh) invalidateRequestCache(key);
    try {
      await swrFetch(
        key,
        () => fetchJson<{ subspaces: SubspaceDto[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/subspaces`),
        (data) => setRows(data.subspaces),
      );
    } catch {
      setRows([]);
    }
  }, [key, spaceId]);

  useEffect(() => { void load(); }, [load]);

  const joined = (id: string) => joinedSpaces.some((s) => s.id === id);

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Sub-spaces</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Spaces that live under this one, each with its own members, admins and tools. A public
            sub-space&rsquo;s context shows in this space&rsquo;s Context under <span className="font-mono text-[13px]">spaces/</span>;
            a private one stays its own.
          </p>
        </div>
        <Button variant="neutral" size="sm" className="inline-flex shrink-0 items-center gap-1.5" onClick={() => setCreating(true)}>
          <PlusIcon size={16} aria-hidden />
          New sub-space
        </Button>
      </div>

      {rows === null ? null : rows.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No sub-spaces yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-subtle">
          {rows.map((sub) => (
            <li key={sub.id} className="flex items-center gap-3 py-3">
              <SpaceAvatar name={sub.name} imageUrl={sub.imageUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-text-primary">{sub.name}</div>
                <p className="truncate text-[13px] text-text-muted">
                  {sub.visibility === 'public' ? 'Public · context flows up' : 'Private'}
                  {' · '}
                  {sub.memberCount} {sub.memberCount === 1 ? 'member' : 'members'}
                </p>
              </div>
              {joined(sub.id) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCurrentSpace(sub.id);
                    router.push('/directory');
                  }}
                >
                  Open
                </Button>
              ) : (
                <span className="text-xs text-text-muted">Not a member</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewSubspaceDialog
          parentId={spaceId}
          parentName={spaceName}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await Promise.all([refreshSpace(), load(true)]);
          }}
        />
      )}
    </section>
  );
}

function NewSubspaceDialog({
  parentId,
  parentName,
  onClose,
  onCreated,
}: {
  parentId: string;
  parentName: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { space } = await fetchJsonBody<{ space: { id: string; name: string } }>('/api/spaces', 'POST', {
        name: name.trim(),
        parentId,
        visibility: isPublic ? 'public' : 'private',
      });
      // The context has to exist before anyone opens it — the same wait the
      // top-level create makes (NewSpaceDialog).
      await ensureRootIndexNote(space.id, space.name);
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sub-space');
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`New sub-space of ${parentName}`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="brand" onClick={submit} disabled={!ready} loading={saving} loadingText="Creating…">
            Create
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <Input
          autoFocus
          aria-label="Sub-space name"
          placeholder="Sub-space name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-text-primary">{isPublic ? 'Public' : 'Private'}</div>
            <p className="mt-0.5 text-xs text-text-muted">
              {isPublic
                ? `Anyone can find and join it, and its context shows in ${parentName}'s Context.`
                : `Members of ${parentName} see its name with a lock and can ask to join. Its context stays closed.`}
            </p>
          </div>
          <Toggle checked={isPublic} onChange={setIsPublic} aria-label="Public sub-space" />
        </div>
        <p className="text-xs text-text-muted">
          You become its admin. It starts with every optional tool off and its own member list.
        </p>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
