'use client';

import { useState } from 'react';
import { Input } from '@visvine/ui';
import { TOOL_CATALOG, type CatalogEntry } from '@/lib/tools/catalog';

/**
 * The kit, as the Workbench's Components panel: every component and hook a
 * Tool can import, what it is for, and — pressed — its snippet dropped into
 * ui.tsx at the caret with its import merged in. The same catalog an
 * authoring AI is handed (lib/tools/catalog.ts).
 */
export default function ComponentsPanel({ onInsert }: { onInsert: (entry: CatalogEntry) => void }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? TOOL_CATALOG.filter((entry) => `${entry.name} ${entry.what} ${entry.when}`.toLowerCase().includes(needle))
    : TOOL_CATALOG;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line-subtle px-5 py-3">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter components" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {(['component', 'hook'] as const).map((kind) => {
          const entries = shown.filter((entry) => entry.kind === kind);
          if (entries.length === 0) return null;
          return (
            <section key={kind} className="pb-3">
              <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {kind === 'component' ? 'Components' : 'Hooks'}
              </h3>
              <ul>
                {entries.map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => onInsert(entry)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle"
                    >
                      <span className="font-mono text-[13px] text-fg">{entry.name}</span>
                      <span className="text-xs text-fg-muted">{entry.what}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
