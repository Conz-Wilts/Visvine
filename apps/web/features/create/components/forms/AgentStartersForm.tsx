'use client';

import { AGENT_TEMPLATES } from '@/lib/agents/templates';
import { draftHref } from '@/lib/create/rows';
import type { InlineFormProps } from './shared';

/**
 * An agent's brief is prose, written on the draft surface. The panel only
 * picks where that prose starts: blank, or one of the starter briefs
 * (lib/agents/templates.ts). Picking one goes straight to the draft.
 */
export default function AgentStartersForm({ onDone }: InlineFormProps) {
  const rows: { id: string | null; title: string; hint: string }[] = [
    { id: null, title: 'Blank', hint: 'Start from nothing' },
    ...AGENT_TEMPLATES.map((t) => ({ id: t.id, title: t.title, hint: t.trigger })),
  ];
  return (
    <div role="listbox" aria-label="Start from" className="flex flex-col">
      {rows.map((row) => (
        <button
          key={row.id ?? 'blank'}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onDone(row.id ? `${draftHref('agent')}&template=${encodeURIComponent(row.id)}` : draftHref('agent'))}
          className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
        >
          <span className="text-sm text-text-primary">{row.title}</span>
          <span className="text-[11px] text-text-muted">{row.hint}</span>
        </button>
      ))}
    </div>
  );
}
