'use client';

import { useState } from 'react';
import { Button, Modal, Select } from '@visvine/ui';
import { isBuiltInType } from '@/lib/tools/typePages';
import type { ToolVersionSummary } from '@/lib/tools/registry';
import { installToolVersion } from '../lib/client';
import PerimeterSummary from './PerimeterSummary';

/**
 * Adding a Tool to the space's shape: where its row goes on the rail, which
 * type pages or tabs it takes, then Install. Opened from Approvals right after
 * approving, and from a Tool's own tab. Placement afterwards stays in
 * Console → Tools, which drags, locks and tucks rows.
 */
export default function InstallSheet({
  spaceId,
  version,
  onClose,
  onInstalled,
}: {
  spaceId: string;
  version: Pick<ToolVersionSummary, 'id' | 'title' | 'version' | 'surfaces' | 'perimeter'>;
  onClose: () => void;
  /** The sentence to show once it is in, naming anything the admin should know. */
  onInstalled: (message: string) => void;
}) {
  const rail = version.surfaces.rail;
  const [placement, setPlacement] = useState<'rail' | 'more'>('rail');
  const [claims, setClaims] = useState<Record<string, 'page' | 'tab' | 'none'>>(() =>
    Object.fromEntries(version.surfaces.types.map((t) => [t.type, t.mode])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await installToolVersion(spaceId, {
        versionId: version.id,
        ...(rail ? { placement } : {}),
        ...(version.surfaces.types.length ? { typeClaims: claims } : {}),
      });
      const notes = [
        ...res.conflicts.map((c) => `${c.type}'s page is ${c.heldBy}'s`),
        ...res.downgraded.map((t) => `${t} is a tab — built-in pages stay built in`),
        ...(res.install.degraded ? ['it runs degraded until the space has what it names'] : []),
      ];
      onInstalled(`${version.title} installed${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not install');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Install ${version.title}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={install} loading={busy} loadingText="Installing…">
            Install
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-4 text-sm">
        <PerimeterSummary perimeter={version.perimeter} />

        {rail && (
          <label className="flex items-center justify-between gap-4">
            <span className="text-fg">{rail.label}</span>
            <Select className="w-40" value={placement} onChange={(e) => setPlacement(e.target.value as 'rail' | 'more')}>
              <option value="rail">On the rail</option>
              <option value="more">In More</option>
            </Select>
          </label>
        )}

        {version.surfaces.types.map((surface) => (
          <label key={surface.type} className="flex items-center justify-between gap-4">
            <span className="text-fg">{surface.type}</span>
            <Select
              className="w-40"
              value={claims[surface.type] ?? surface.mode}
              onChange={(e) => setClaims((c) => ({ ...c, [surface.type]: e.target.value as 'page' | 'tab' | 'none' }))}
            >
              {!isBuiltInType(surface.type) && <option value="page">Its page</option>}
              <option value="tab">A tab</option>
              <option value="none">Neither</option>
            </Select>
          </label>
        ))}

        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
