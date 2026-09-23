'use client';

import { useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';

interface Row {
  id: number;
  name: string;
  state: 'sending' | 'done' | 'failed';
  error?: string;
}

/** One file per request, so each row settles on its own and one refusal stops nothing else. */
export function DropZone({ token }: { token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const nextId = useRef(0);

  const send = async (files: File[]) => {
    for (const file of files) {
      const id = nextId.current++;
      setRows((prev) => [...prev, { id, name: file.name, state: 'sending' }]);
      const settle = (patch: Partial<Row>) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      const body = new FormData();
      body.append('file', file);
      try {
        await fetchJson(`/api/uploads/${encodeURIComponent(token)}`, { method: 'POST', body });
        settle({ state: 'done' });
      } catch (err) {
        settle({ state: 'failed', error: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(Array.from(e.dataTransfer.files));
        }}
        className={`flex h-40 w-full items-center justify-center rounded-lg border border-dashed text-sm transition-colors ${
          over ? 'border-brand-green bg-brand-green/5 text-text-primary' : 'border-border-default text-text-muted hover:bg-surface-2'
        }`}
      >
        Drop files or choose
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void send(files);
        }}
      />
      {rows.length > 0 && (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate text-text-primary">{r.name}</span>
              <span
                className={`shrink-0 text-xs ${
                  r.state === 'failed' ? 'text-red-600 dark:text-red-400' : r.state === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'
                }`}
                title={r.error}
              >
                {r.state === 'sending' ? 'Sending…' : r.state === 'done' ? 'Added' : r.error ?? 'Failed'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
