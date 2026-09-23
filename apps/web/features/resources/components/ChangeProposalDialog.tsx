'use client';
import { useState } from 'react';
import { Button, Input, Modal, Textarea } from '@visvine/ui';
import { fetchJsonBody } from '@/lib/fetchJson';

export default function ChangeProposalDialog({
  resourceId,
  cellRef,
  originalValue,
  onClose,
  onProposed,
}: {
  resourceId: string;
  cellRef: string;
  originalValue: string;
  onClose: () => void;
  onProposed: () => void;
}) {
  const [proposedValue, setProposedValue] = useState(originalValue);
  const [reason, setReason] = useState('');
  const [proposedBy, setProposedBy] = useState('Anonymous');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!proposedValue.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/resources/${resourceId}/changes`, 'POST', { cellRef, originalValue, proposedValue, reason, proposedBy });
      onProposed();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to propose change');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      closeOnEscape={false}
      title={`Propose change · ${cellRef}`}
      maxWidth="max-w-sm"
    >
        <div className="space-y-3 p-6">
          <div>
            <label className="text-xs text-fg-muted block mb-1">Name</label>
            <Input value={proposedBy} onChange={e => setProposedBy(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-fg-muted block mb-1">Current</label>
            <p className="text-sm text-fg-secondary">{originalValue || '—'}</p>
          </div>
          <div>
            <label className="text-xs text-fg-muted block mb-1">Proposed</label>
            <Input value={proposedValue} onChange={e => setProposedValue(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-fg-muted block mb-1">Reason</label>
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && <p className="text-xs text-danger-bright">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submit} loading={submitting} loadingText="Sending…">
              Propose
            </Button>
          </div>
        </div>
    </Modal>
  );
}
