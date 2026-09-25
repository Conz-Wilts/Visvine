'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, Select } from '@visvine/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import type { SpaceListing } from '@/lib/tools/api';
import { fetchSpaceListings, moveListing } from '../lib/client';

/**
 * Offering a listed Tool to another publisher space. The other space's admins
 * accept it (Console → Tools), naming the Tool there that carries it on; its
 * installs keep receiving upgrades either way.
 */
export default function TransferDialog({
  spaceId,
  listingId,
  onClose,
  onDone,
}: {
  spaceId: string;
  listingId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { spaces } = useSpace();
  const others = spaces.filter((space) => space.id !== spaceId);
  const [listing, setListing] = useState<SpaceListing | null>(null);
  const [to, setTo] = useState<string>(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchSpaceListings(spaceId, ctl.signal)
      .then((res) => setListing(res.listings.find((l) => l.listingId === listingId) ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, [spaceId, listingId]);

  const act = async (toSpaceId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await moveListing(spaceId, { action: 'offer', listingId, toSpaceId });
      const name = others.find((space) => space.id === toSpaceId)?.name ?? toSpaceId;
      onDone(toSpaceId ? `Offered to ${name}` : 'Offer taken back');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
      setBusy(false);
    }
  };

  const offered = listing?.transferTo ?? null;
  return (
    <Modal
      onClose={onClose}
      title={`Transfer ${listing?.title ?? 'listing'}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          {offered ? (
            <Button variant="ghost" size="sm" onClick={() => act(null)} loading={busy}>
              Take back
            </Button>
          ) : (
            <Button variant="brand" size="sm" onClick={() => act(to)} loading={busy} disabled={!to}>
              Offer
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4 text-sm">
        {offered ? (
          <p className="text-fg">Offered to {offered.name ?? offered.id}</p>
        ) : (
          <label className="flex items-center justify-between gap-4">
            <span className="text-fg">To</span>
            <Select className="w-56" value={to} onChange={(e) => setTo(e.target.value)}>
              {others.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
