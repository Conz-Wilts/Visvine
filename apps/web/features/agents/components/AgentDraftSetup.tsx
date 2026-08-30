'use client';

import { useEffect, useRef } from 'react';
import { Chip } from '@/components/ui';
import { AGENT_TEMPLATES, type AgentTemplate } from '@/lib/agents/templates';
import { useAgentOptions } from '../lib/useAgentOptions';

/**
 * The agent half of the create surface: a row of starter briefs, and nothing
 * else. Connecting a service asks for a name and a key and leaves the rest to
 * the note; writing an agent asks for a title and a brief. Model, tools,
 * connectors and the roster line are frontmatter, editable under Settings on
 * the agent's own page the moment it exists — so asking for them in front of a
 * brief nobody has written yet is asking too early.
 *
 * Picking a template is a one-shot fill (title, body, tools, roster line), not
 * a mode: the person edits freely from there, and the chip only shows as
 * selected until they change something.
 */
export default function AgentDraftSetup({
  spaceId,
  templateId,
  onApplyTemplate,
  onDefaultModel,
  accent,
}: {
  spaceId: string | null;
  templateId: string | null;
  onApplyTemplate: (template: AgentTemplate | null) => void;
  /** The model the brief is scaffolded on, once the space's options are known. */
  onDefaultModel: (model: string) => void;
  accent: string;
}) {
  const { options } = useAgentOptions(spaceId);

  // `defaultModel` is the first provider the space actually holds a key for,
  // so the usual agent needs no model decision at all — and the one that does
  // makes it on its own page. Once per draft: a later re-render must not undo
  // a model set anywhere else.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !options?.defaultModel) return;
    seeded.current = true;
    onDefaultModel(options.defaultModel);
  }, [options, onDefaultModel]);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip size="lg" color={templateId === null ? accent : undefined} onClick={() => onApplyTemplate(null)}>
          Blank
        </Chip>
        {AGENT_TEMPLATES.map((t) => (
          <Chip key={t.id} size="lg" color={templateId === t.id ? accent : undefined} onClick={() => onApplyTemplate(t)} title={t.description}>
            {t.title}
          </Chip>
        ))}
      </div>

      <p className="text-[13px] text-text-muted">
        Write the brief below: what to read, what to produce, where to write it. Its model, tools and connectors are on its page. It does
        nothing until it is turned on — from its page, by anyone who can edit it.
      </p>
    </div>
  );
}
