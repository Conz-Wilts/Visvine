/**
 * Splitting a Tool's index note into prose and facts, and putting them back
 * together — the pure half of lib/tools/toolFacts.ts, kept free of the
 * database so the build (reached from the note store) can use it.
 */
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { MANIFEST_FACT_KEYS } from '@visvine/tool-protocol/manifest'

/** Every frontmatter key that is a fact, not prose. */
export const TOOL_FACT_KEYS: readonly string[] = ['surfaces', 'perimeter', ...MANIFEST_FACT_KEYS]

export type ToolFacts = Record<string, unknown>

/** An index note as written, split into the note to store and the facts for the row (null when it declares none). */
export function splitToolIndex(content: string): { note: string; facts: ToolFacts | null } {
  const { body } = splitFrontmatter(content)
  const frontmatter = parseFrontmatter(content) as Record<string, unknown>
  const facts: ToolFacts = {}
  const prose: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (TOOL_FACT_KEYS.includes(key)) facts[key] = value
    else prose[key] = value
  }
  if (Object.keys(facts).length === 0) return { note: content, facts: null }
  return { note: joinFrontmatter(prose, body), facts }
}

/** The note with the row's facts rendered back into its frontmatter — what every reader parses. The row wins. */
export function composeToolIndex(note: string, facts: ToolFacts | null): string {
  if (!facts || Object.keys(facts).length === 0) return note
  const { body } = splitFrontmatter(note)
  const frontmatter = parseFrontmatter(note) as Record<string, unknown>
  const prose = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !TOOL_FACT_KEYS.includes(key)))
  return joinFrontmatter({ ...prose, ...facts }, body)
}
