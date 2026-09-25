'use client';

import { useState } from 'react';
import { Button, Modal, Textarea } from '@visvine/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import type { BridgeTarget } from '@/lib/tools/protocol';

/** Report a Tool: a note to the people who review it, recorded as an incident. */
export default function ToolReport({
  target,
  title,
  onClose,
  onDone,
}: {
  target: BridgeTarget;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody('/api/tools/incidents', 'POST', { target, kind: 'report', note: note.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Report ${title}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={send} loading={busy} disabled={!note.trim()}>
            Report
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-6 py-4">
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} aria-label="What is wrong" placeholder="What is wrong" />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
