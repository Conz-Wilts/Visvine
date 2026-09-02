'use client';

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
 *
 * No model is chosen here, or written into the brief at all. A new agent runs
 * on the SPACE's model — the first `kind: model` connector it has — so the
 * only thing worth saying at this point is when there isn't one.
 */
export default function AgentDraftSetup({
  spaceId,
  templateId,
  onApplyTemplate,
  accent,
}: {
  spaceId: string | null;
  templateId: string | null;
  onApplyTemplate: (template: AgentTemplate | null) => void;
  accent: string;
}) {
  const { options } = useAgentOptions(spaceId);

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
        Write the brief below: what to read, what to produce, where to write it. Its tools and connectors are on its page. It does
        nothing until it is turned on — from its page, by anyone who can edit it.
      </p>

      {/* Said here rather than discovered at the switch: an agent in a space
          with no model is a brief that can be written and never run. It is not
          a blocker — the brief is still worth writing, and adding a model
          later needs no edit to it. */}
      {options?.noModels && (
        <p className="text-[13px] text-amber-700">
          {options.noModels} You can write the brief now — it will run once there is one.
        </p>
      )}
    </div>
  );
}
