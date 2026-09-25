'use client';

import { useState } from 'react';
import { Button, Modal, Select, Textarea } from '@visvine/ui';
import { COMMON_LICENSES } from '@/lib/tools/shared/listing';
import type { ToolVersionSummary } from '@/lib/tools/registry';
import { listingAction } from '../lib/client';

/**
 * Going global from a Tool's tab: an admin asking Visvine to list a version
 * (`list` — co-signed in the same press when they wrote it, so the license is
 * asked then), and its author co-signing an admin's request (`cosign`).
 */
export default function ListingDialog({
  spaceId,
  version,
  mode,
  selfSigned,
  onClose,
  onDone,
}: {
  spaceId: string;
  version: Pick<ToolVersionSummary, 'id' | 'title' | 'version' | 'license' | 'manifest'>;
  mode: 'list' | 'cosign';
  /** The admin asking wrote the version: the license is theirs to choose now. */
  selfSigned: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const declared = version.manifest.license;
  const [license, setLicense] = useState<string>(declared ?? 'MIT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asksLicense = mode === 'cosign' || selfSigned;
  const options = (COMMON_LICENSES as readonly string[]).includes(license) ? COMMON_LICENSES : [license, ...COMMON_LICENSES];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'cosign'
          ? await listingAction(spaceId, version.id, { action: 'cosign', license })
          : await listingAction(spaceId, version.id, {
              action: 'list',
              ...(asksLicense ? { license } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
      onDone(
        res.version.listingState === 'awaiting_cosign'
          ? `v${version.version} waits for its author to co-sign`
          : `v${version.version} is with Visvine for review`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={mode === 'cosign' ? `Co-sign ${version.title}` : `List ${version.title}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy}>
            {mode === 'cosign' ? 'Co-sign' : 'List'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4 text-sm">
        {asksLicense && (
          <label className="flex items-center justify-between gap-4">
            <span className="text-fg">License</span>
            <Select className="w-48" value={license} onChange={(e) => setLicense(e.target.value)}>
              {options.map((id) => (
                <option key={id} value={id}>
                  {id === 'proprietary' ? 'Proprietary' : id}
                </option>
              ))}
            </Select>
          </label>
        )}
        {mode === 'list' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-fg">Note</span>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
