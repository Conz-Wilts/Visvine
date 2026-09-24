/**
 * The one brief-note key the agent's Config screen writes: `tags:` — the
 * roster's groups, which stay in the note because they classify what the
 * agent IS (every note's tags reach its node the same way). Everything else
 * the screen edits is the record (shared/agentConfig.ts). Pure: string in,
 * string out; the body and every other key are untouched.
 */
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'

/** The brief's `tags:`, as the Group field shows them. */
export function briefTags(content: string): string[] {
  const raw: unknown = parseFrontmatter(content).tags
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return [...new Set(list.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean))]
}

/** The brief with its `tags:` replaced — dropped when empty. */
export function withBriefTags(content: string, tags: string[]): string {
  const { body } = splitFrontmatter(content)
  const fm: NoteFrontmatter = { ...parseFrontmatter(content) }
  const next = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  if (next.length) fm.tags = next
  else delete fm.tags
  return joinFrontmatter(fm, body)
}
