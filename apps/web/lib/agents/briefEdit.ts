/**
 * Editing a brief's settings without touching its prose. The settings form on
 * the agent page and the create surface both hold the same handful of
 * frontmatter keys; this is the one place they are written, so the shape the
 * parser reads (`lib/agents/config.ts#parseAgentBrief`) and the shape the UI
 * writes cannot drift. Pure: string in, string out.
 *
 * Keys not named in the patch — `title`, `type`, `agents`, anything a person
 * added by hand — survive untouched, and so does the body. A key set to its
 * default (`dry_run: false`, empty `tools`) is dropped rather than written,
 * so a brief someone wrote by hand does not grow lines they never typed.
 */
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { AGENT_TOOL_EXTRAS, type AgentToolExtra } from './config'

export interface BriefSettings {
  model: string
  description: string
  connectors: string[]
  tools: AgentToolExtra[]
  dryRun: boolean
  maxTurns: number | null
}

export type BriefSettingsPatch = Partial<BriefSettings>

/** The settings a brief's frontmatter currently holds, as the form reads them. */
export function readBriefSettings(content: string): BriefSettings {
  const fm = parseFrontmatter(content)
  const list = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : typeof raw === 'string'
        ? raw.split(',').map((v) => v.trim()).filter(Boolean)
        : []
  const tools = list(fm.tools)
    .map((t) => t.toLowerCase())
    .filter((t): t is AgentToolExtra => (AGENT_TOOL_EXTRAS as readonly string[]).includes(t))
  const maxTurns = typeof fm.max_turns === 'number' ? fm.max_turns : Number(fm.max_turns)
  return {
    model: typeof fm.model === 'string' ? fm.model.trim() : '',
    description: typeof fm.description === 'string' ? fm.description.trim() : '',
    connectors: list(fm.connectors),
    tools: [...new Set(tools)],
    dryRun: fm.dry_run === true || (typeof fm.dry_run === 'string' && fm.dry_run.trim().toLowerCase() === 'true'),
    maxTurns: Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null,
  }
}

/** The brief with `patch` applied to its frontmatter and its body untouched. */
export function updateBriefSettings(content: string, patch: BriefSettingsPatch): string {
  const { body } = splitFrontmatter(content)
  const fm: NoteFrontmatter = { ...parseFrontmatter(content), type: 'agent' }
  if (patch.model !== undefined) fm.model = patch.model.trim()
  if (patch.description !== undefined) {
    if (patch.description.trim()) fm.description = patch.description.trim()
    else delete fm.description
  }
  if (patch.connectors !== undefined) fm.connectors = [...new Set(patch.connectors.map((c) => c.trim()).filter(Boolean))]
  if (patch.tools !== undefined) {
    const tools = [...new Set(patch.tools)]
    if (tools.length) fm.tools = tools
    else delete fm.tools
  }
  if (patch.dryRun !== undefined) {
    if (patch.dryRun) fm.dry_run = true
    else delete fm.dry_run
  }
  if (patch.maxTurns !== undefined) {
    if (patch.maxTurns === null) delete fm.max_turns
    else fm.max_turns = patch.maxTurns
  }
  return joinFrontmatter(fm, body)
}
