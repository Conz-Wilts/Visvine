'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
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
      overlayClassName="items-center justify-center bg-black/40"
      maxWidth="max-w-sm"
      panelClassName="bg-surface-1 rounded-xl shadow-float p-6"
    >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Propose Change — {cellRef}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-muted">✕</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted block mb-1">Your name</label>
            <input className="w-full border border-border-default rounded px-2 py-1 text-sm" value={proposedBy} onChange={e => setProposedBy(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">Current value</label>
            <p className="text-sm bg-surface-2 rounded px-2 py-1 border border-border-subtle">{originalValue || '(empty)'}</p>
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">Proposed value</label>
            <input className="w-full border border-border-default rounded px-2 py-1 text-sm" value={proposedValue} onChange={e => setProposedValue(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">Reason (optional)</label>
            <textarea className="w-full border border-border-default rounded px-2 py-1 text-sm resize-none" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Propose Change'}
          </button>
        </div>
    </Modal>
  );
}
