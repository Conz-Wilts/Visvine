'use client';

import { useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';
import type { ColumnDTO } from '../lib/types';

const SWATCHES = [
  '#94a3b8', // slate
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
];

interface ColumnModalProps {
  /** Existing column = edit; null = create. */
  column: ColumnDTO | null;
  onSave: (name: string, color: string) => Promise<void>;
  onClose: () => void;
}

export default function ColumnModal({ column, onSave, onClose }: ColumnModalProps) {
  const [name, setName] = useState(column?.name ?? '');
  const [color, setColor] = useState(column?.color ?? SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim(), color);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save column');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={column ? 'Edit column' : 'Add column'}
      size="sm"
      footer={
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <Button variant="pill-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="pill-primary"
            onClick={() => void submit()}
            disabled={!name.trim()}
            loading={busy}
            loadingText="Saving…"
          >
            {column ? 'Save' : 'Add column'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-4">
        <Field label="Name" error={error}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. In review"
            maxLength={60}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>
        <Field label="Color">
          <div className="flex gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                onClick={() => setColor(swatch)}
                className={`h-7 w-7 rounded-full transition-transform ${
                  color === swatch ? 'ring-2 ring-brand-green ring-offset-2 scale-110' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
