/**
 * Starter briefs for the create surface. Pure: a template is the title,
 * description, tool extras and body a new brief begins with — nothing here
 * decides when it runs (that is the activation note, admin-written) or which
 * model (the picker's default, keyed by which provider has a key stored).
 *
 * Every template must round-trip through `newAgentNote` → `parseAgentBrief`;
 * tests/agents-templates.test.ts holds that line. The `trigger` field is
 * advice for the person turning it on, shown on the setup checklist, never
 * written anywhere.
 */
import type { AgentToolExtra } from './config'

export interface AgentTemplate {
  id: string
  title: string
  description: string
  tools: AgentToolExtra[]
  /** The schedule or trigger this brief is written for — shown as a hint, not applied. */
  trigger: string
  body: string
}

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'weekly-digest',
    title: 'Weekly digest',
    description: 'Summarises the week into reports/weekly.md',
    tools: [],
    trigger: 'Weekly, Monday morning',
    body: `Each run, read every note under updates/ that changed in the last seven days and write a short digest to reports/weekly.md.

The digest is for people who were away all week: lead with what changed, name who was involved with a link to their note, and keep it under 300 words. Group by theme rather than by note. If nothing changed, say so in one line rather than inventing content.

Overwrite the previous digest; the history is in the note's revisions.`,
  },
  {
    id: 'person-enrichment',
    title: 'New person enrichment',
    description: 'Fills in a new person note from what the context and the web already know',
    tools: ['web'],
    trigger: 'When a note under people/** is created',
    body: `When a person note is created under people/, research them and fill in what the note is missing.

Start with the context: search for the person's name, their organisation and any linked notes, and read what is already known. Then check the public web for their current role, company and location. Only add facts you can source; for each fact from the web, add the URL in parentheses.

Append a "## Background" section to their note with what you found. Never rewrite what a person wrote about them, and never add contact details that were not already in the context.`,
  },
  {
    id: 'channel-briefing',
    title: 'Morning briefing',
    description: 'Posts a short daily briefing to a channel',
    tools: ['messages'],
    trigger: 'Daily at 08:00',
    body: `Every morning, post a briefing to the #general channel.

Read the notes that changed since the previous run and any events under events/ happening in the next two days. Write three to five bullets: what changed, who to follow up with, what is on today. Link each bullet to the note it came from.

Keep it under 120 words. If nothing changed and nothing is on, post one line saying so.`,
  },
  {
    id: 'inbox-triage',
    title: 'Connector sync',
    description: 'Pulls new records from a connector into the directory',
    tools: ['directory'],
    trigger: 'Every hour',
    body: `Each run, call the connector named in this brief's connectors list to list records created or updated since the previous run — the previous run's high-water mark is kept in agents/state/connector-sync.md, which you read at the start and rewrite at the end.

For every new record, create a matching person or organisation in the directory if none exists, and write what the connector knows to its note. For every updated record, append the change to the existing note; never overwrite what a person wrote.

Stop after 50 records and note where you got to.`,
  },
]

export function agentTemplateById(id: string | null | undefined): AgentTemplate | null {
  if (!id) return null
  return AGENT_TEMPLATES.find((t) => t.id === id) ?? null
}
