'use client';

// Starting a community of your own — provisioning a real Community row, its
// membership, a default space and a brain.
//
// This deliberately is NOT one of the `CreateableType`s. Those are things you
// write down *inside* the community you're in, and the create surfaces list
// them together because they're the same kind of act: name a thing, give it a
// note. Provisioning a whole community is a different act with a different
// destination — you leave where you are and land somewhere new — so it lives
// here, on the switcher that already owns "which community am I in".
//
// The directory's `community` type is the other thing entirely: recording that
// an organisation exists, as a node + note in the community you're already in.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Field, Input, Textarea, Button } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { fetchJsonBody } from '@/lib/fetchJson';

interface CreateResponse {
  community: { id: string; name: string };
}

export default function NewCommunityDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { refreshCommunity, setCurrentCommunity } = useCommunity();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
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
      const { community } = await fetchJsonBody<CreateResponse>('/api/communities', 'POST', {
        name: name.trim(),
        description: description.trim(),
        location: location.trim() || undefined,
        visibility: isPrivate ? 'private' : 'public',
      });
      // The switcher has to see it before we switch into it.
      await refreshCommunity();
      setCurrentCommunity(community.id);
      onClose();
      router.push('/directory');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create community');
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="New community"
      size="sm"
      footer={
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="pill-primary"
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
        <Field label="Name">
          <Input
            autoFocus
            placeholder="e.g. Web3 Builders"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </Field>
        <Field label="Description" hint="Becomes the starting text of the new community's own context note.">
          <Textarea
            rows={3}
            placeholder="What's this community about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Location">
          <Input
            placeholder="e.g. Global, Bay Area"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Visibility">
          {/* Binary setting — one switch under the line that says which side it's on. */}
          <div>
            <p className="text-sm font-medium text-text-primary">{isPrivate ? 'Private' : 'Public'}</p>
            <p className="text-xs text-text-muted">
              {isPrivate
                ? 'Hidden — join by invite link or admin add'
                : 'Anyone can find & join from Discover'}
            </p>
            <Toggle
              className="mt-2"
              checked={isPrivate}
              onChange={setIsPrivate}
              aria-label="Private community"
            />
          </div>
        </Field>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
}
