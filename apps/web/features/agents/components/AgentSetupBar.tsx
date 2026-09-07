'use client';

import {
  BlocksIcon,
  CodeIcon,
  GlobeIcon,
  HammerIcon,
  MessageSquareIcon,
  UsersIcon,
  SparklesIcon,
} from '@/features/shared/icons';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { modelCatalogEntryFor } from '@/lib/models/catalog';
import type { AgentSummary } from '@/lib/agents/service';

/**
 * What the agent runs on and what it can reach, as marks rather than words:
 * the model's chip, then a bar of the connectors it declares (each under its
 * service's logo) and the tools it has (each under an icon). Hover a mark for
 * its name. It sits at the top right of the agent's page, opposite the title,
 * so the setup is read at a glance and never as a paragraph.
 */

const TOOL_MARK: Record<string, { label: string; Icon: (props: { className?: string }) => React.ReactNode }> = {
  web: { label: 'Web', Icon: GlobeIcon },
  actions: { label: 'Actions', Icon: BlocksIcon },
  sandbox: { label: 'Sandbox', Icon: CodeIcon },
  machine: { label: 'Machine', Icon: HammerIcon },
  messages: { label: 'Messages', Icon: MessageSquareIcon },
  directory: { label: 'Directory', Icon: UsersIcon },
};

function Mark({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span title={title} aria-label={title} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2">
      {children}
    </span>
  );
}

export default function AgentSetupBar({ agent }: { agent: AgentSummary }) {
  const model = agent.modelEffective;
  const provider = model ? model.split('/')[0] : null;
  const modelEntry = provider ? modelCatalogEntryFor(null, provider) : null;
  const modelId = model ? model.slice(model.indexOf('/') + 1) : null;
  const marks = [...agent.connectors.map((c) => ({ kind: 'connector' as const, id: c })), ...agent.tools.map((t) => ({ kind: 'tool' as const, id: t }))];

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span
        title={model ?? 'No model'}
        className="flex h-9 max-w-[14rem] items-center gap-2 rounded-lg border border-border-subtle bg-surface-1 p-0.5 pr-2.5 text-[12px]"
      >
        <ConnectorLogo entry={modelEntry} size="sm" />
        <span className={`truncate font-mono ${model ? 'text-text-secondary' : 'text-amber-700'}`}>{modelId ?? 'no model'}</span>
      </span>
      {marks.length > 0 && (
        <div className="flex h-9 items-center gap-1 rounded-lg border border-border-subtle bg-surface-1 p-0.5">
          {marks.map((m) =>
            m.kind === 'connector' ? (
              <span key={`c:${m.id}`} title={m.id} aria-label={m.id} className="shrink-0">
                <ConnectorLogo name={m.id} size="sm" />
              </span>
            ) : (
              <Mark key={`t:${m.id}`} title={TOOL_MARK[m.id]?.label ?? m.id}>
                {(TOOL_MARK[m.id]?.Icon ?? SparklesIcon)({ className: 'h-4 w-4 text-text-secondary' })}
              </Mark>
            ),
          )}
        </div>
      )}
    </div>
  );
}
