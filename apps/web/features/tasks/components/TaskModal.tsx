'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, ConfirmDialog, Field, Input, Modal, Textarea } from '@/components/ui';
import type { BoardMember, TaskDTO, TaskDraft } from '../lib/types';
import AssigneePicker from './AssigneePicker';

interface TaskModalProps {
  /** Existing task = edit; null = create (into `columnName`'s column). */
  task: TaskDTO | null;
  columnName: string;
  members: BoardMember[];
  onSave: (draft: TaskDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/** ISO datetime → the yyyy-mm-dd a date input wants (local date). */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TaskModal({ task, columnName, members, onSave, onDelete, onClose }: TaskModalProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const [dueDate, setDueDate] = useState(toDateInput(task?.dueDate ?? null));
  const [labels, setLabels] = useState<string[]>(task?.labels ?? []);
  const [labelInput, setLabelInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addLabel = () => {
    const label = labelInput.trim();
    if (!label || labels.includes(label) || labels.length >= 20) return;
    setLabels([...labels, label]);
    setLabelInput('');
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        description,
        assigneeId,
        // Midnight local, serialized as ISO — the card only ever shows the date.
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        labels,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={task ? 'Edit task' : `New task in "${columnName}"`}
      footer={
        <div className="flex items-center gap-2 border-t border-gray-100 px-6 py-4">
          {task && onDelete && (
            <Button variant="danger-text" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete task
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="pill-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="pill-primary"
              onClick={() => void submit()}
              disabled={!title.trim()}
              loading={busy}
              loadingText="Saving…"
            >
              {task ? 'Save' : 'Create task'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-4">
        <Field label="Title" error={error}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add more detail…"
            rows={4}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Assignee">
            <AssigneePicker members={members} value={assigneeId} onChange={setAssigneeId} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Labels" hint="Press Enter to add a label.">
          <div>
            {labels.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-light-bg px-2.5 py-1 text-xs font-medium text-brand-green"
                  >
                    {label}
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => setLabels(labels.filter((l) => l !== label))}
                      className="hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="e.g. design"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
          </div>
        </Field>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        body="The task will be permanently deleted."
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          if (!onDelete) return;
          await onDelete();
          setConfirmDelete(false);
          onClose();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Modal>
  );
}
