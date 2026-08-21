'use client';

import { useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { agentFolderProblem, normaliseAgentFolder } from '@/lib/agents/config';
import { newIndexContent } from '@/lib/notes/shared/indexNote';
import { slugify } from '@/lib/eventUtils';

/**
 * A folder of agents is an index note at `agents/<folder>/index.md` — this
 * writes one. The name becomes the folder's title; the slug, its path.
 */
export default function NewAgentFolderDialog({
  spaceId,
  parent,
  onClose,
  onCreated,
}: {
  spaceId: string;
  /** The folder it goes inside, relative to `agents/`; '' for the top. */
  parent: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = slugify(title).slice(0, 64);
  const rel = [normaliseAgentFolder(parent), slug].filter(Boolean).join('/');
  const problem = slug ? agentFolderProblem(rel) : null;

  const submit = async () => {
    if (!slug || problem) return;
    setBusy(true);
    setError(null);
    try {
      await notesApi.createFolder(spaceId, `agents/${rel}`, newIndexContent({ title: title.trim() }));
      invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the folder');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="New folder of agents"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} disabled={!slug || !!problem}>
            Create
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input
            autoFocus
            placeholder="e.g. Reports"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>
        <p className="font-mono text-xs text-text-muted">agents/{rel || '…'}/index.md</p>
        {(problem || error) && <p className="text-xs text-red-600">{problem ?? error}</p>}
      </div>
    </Modal>
  );
}
