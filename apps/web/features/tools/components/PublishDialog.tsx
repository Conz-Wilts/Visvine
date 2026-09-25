'use client';

import { useState } from 'react';
import { Button, Modal, Textarea } from '@visvine/ui';
import type { AuthoredToolView } from '@/lib/tools/api';
import type { CheckReport as CheckReportData } from '@/lib/tools/checks/findings';
import { blockedReport, publishTool } from '../lib/client';
import CheckReport from './CheckReport';
import PerimeterSummary from './PerimeterSummary';

/**
 * Publishing snapshots the working copy — its code and its declared reach — as
 * an immutable version of this space: approved as it lands when an admin
 * publishes, waiting on the space's admins otherwise. A dialog showing that
 * reach, not a button that fires.
 */
export default function PublishDialog({
  view,
  spaceId,
  onClose,
  onDone,
}: {
  view: AuthoredToolView;
  spaceId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<CheckReportData | null>(null);

  const { tool, versions } = view;
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publishTool(spaceId, tool.name, undefined, notes.trim() || undefined);
      onDone(
        res.warning ??
          (res.version.status === 'approved'
            ? `Published v${res.version.version} · approved in this space`
            : `Published v${res.version.version} · waiting on an admin`),
      );
    } catch (e) {
      const report = blockedReport(e);
      setBlocked(report);
      setError(report ? 'Checks blocked it' : e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Publish ${tool.title} v${nextVersion}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} loadingText="Publishing…">
            Publish
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4 text-sm">
        {tool.config ? (
          <div>
            <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Reach</p>
            <PerimeterSummary perimeter={tool.config.perimeter} />
          </div>
        ) : (
          <p className="border-l-2 border-danger-bright pl-3 text-[13px] text-danger-strong">The config does not parse.</p>
        )}

        <Textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="What changed"
          placeholder="What changed"
        />

        {error && <p className="border-l-2 border-danger-bright pl-3 text-[13px] text-danger-strong">{error}</p>}
        {blocked && <CheckReport report={blocked} />}
      </div>
    </Modal>
  );
}
