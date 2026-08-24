'use client';

// Starting a space of your own — provisioning a real Space row, its
// membership and a context.
//
// Name and nothing else. Description, location and visibility are all optional
// server-side and all editable straight afterwards in Console → Settings, so
// asking for them here only stands between you and the space you came to
// make.
//
// This deliberately is NOT one of the `CreateableType`s. Those are things you
// write down *inside* the space you're in, and the create surfaces list
// them together because they're the same kind of act: name a thing, give it a
// note. Provisioning a whole space is a different act with a different
// destination — you leave where you are and land somewhere new — so it lives
// here, on the switcher that already owns "which space am I in".
//
// With `parent` the space is created INSIDE the one you're in (docs/sub-spaces.md):
// it starts visible to that space's members, and the parent's context gets a
// record of it — the same `space` node + note the directory's Create → Space
// writes, which provisions a space of its own when none is linked.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Input, Button } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ensureRootIndexNote } from '@/features/notes/lib/rootIndex';
import { fetchJsonBody } from '@/lib/fetchJson';

interface CreateResponse {
  space: { id: string; name: string };
}

export default function NewSpaceDialog({
  onClose,
  parent = null,
}: {
  onClose: () => void;
  parent?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const { refreshSpace, setCurrentSpace } = useSpace();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length > 0;

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Any signed-in user may do this; the server derives a unique id from the
      // name and makes the creator an admin. (POST /api/data/communities is the
      // separate super-admin bulk path.)
      // Name only — the server defaults the description to '', location to
      // null, visibility to private and the tools to Directory only.
      const { space } = await fetchJsonBody<CreateResponse>('/api/communities', 'POST', {
        name: name.trim(),
        ...(parent ? { parentId: parent.id } : {}),
      });
      // The switcher has to see it before we switch into it.
      await refreshSpace();
      // …and the space's context has to exist before you can be standing in it.
      // The server seeds the root index best-effort, so the space can land
      // without one; opening Context then wrote it on the spot, which is why a
      // brand-new space could show a "request access" card or an empty note for
      // a beat. Waiting here — inside "Creating…", where a wait reads as the
      // space being built — means the Context tab has somewhere to go from the
      // first click.
      await ensureRootIndexNote(space.id, space.name);
      setCurrentSpace(space.id);
      onClose();
      router.push('/directory');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create space');
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={parent ? `New subspace inside ${parent.name}` : 'New space'}
      size="sm"
      footer={
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={submit}
            disabled={!ready}
            loading={saving}
            loadingText="Creating…"
          >
            Create
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        {/* The placeholder is the label — one field needs no heading above it. */}
        <Input
          autoFocus
          aria-label="Space name"
          placeholder="Space name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        {parent && (
          <p className="text-xs text-text-muted">
            Visible to {parent.name}&rsquo;s members to start. You&rsquo;ll be its admin; {parent.name}&rsquo;s admins can manage it too.
          </p>
        )}
        {error && (
          <div className="border-l-2 border-red-500 pl-3 py-1 text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
}
