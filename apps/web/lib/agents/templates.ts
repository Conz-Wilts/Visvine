/**
 * Starter briefs for the create surface. Pure: a template is the title,
 * description and body a new brief note begins with, plus the tool extras its
 * RECORD starts with — nothing here decides when it runs (that is activation,
 * on the record, when a person switches it on) or which model (the space's).
 *
 * Every template's note must parse as a brief with its tools applied to a
 * fresh record; tests/agents-templates.test.ts holds that line. The `trigger`
 * field is advice for the person turning it on, shown on the setup checklist,
 * never written anywhere.
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
    description: 'Summarises the week into a dated note in its own folder',
    tools: [],
    trigger: 'Weekly, Monday morning',
    body: `Each run, read every note that changed in the last seven days and write a digest as a dated note in your own folder (agents/<your name>/YYYY-MM-DD.md).

The digest is for people who were away all week: an H1 with the week, then "## What changed" grouped by theme rather than by note, then "## People" — everyone involved, each linked to their note. Keep it under 300 words. If nothing changed, say so in one line rather than inventing content.

Each week is its own note, so the folder is the history.`,
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
    id: 'inbox-triage',
    title: 'Connector sync',
    description: 'Pulls new records from a connector into the directory',
    tools: ['directory'],
    trigger: 'Every hour',
    body: `Each run, call the connector named in this brief's connectors list to list records created or updated since the previous run — the previous run's high-water mark is in your memory under "What I know"; remember the new one before you finish.

For every new record, create a matching person or organisation in the directory if none exists, and write what the connector knows to its note. For every updated record, append the change to the existing note; never overwrite what a person wrote.

Stop after 50 records and note where you got to.`,
  },
]

export function agentTemplateById(id: string | null | undefined): AgentTemplate | null {
  if (!id) return null
  return AGENT_TEMPLATES.find((t) => t.id === id) ?? null
}
