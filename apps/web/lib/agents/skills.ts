/**
 * Reading an agent's skills at run time.
 *
 * The I/O half of `shared/skills.ts`: load the notes, choose the ones this run
 * calls for, and render them into something the model reads before it starts.
 *
 * Selection is deterministic and free — a keyword overlap, the same mechanism
 * recipes use — so which skills a run gets is answerable after the fact from
 * the brief and the trigger alone, without replaying a model call.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { parseSkill, selectSkills, skillStepsPath, type SkillDoc } from '@/lib/agents/shared/skills'

const SHARED = 'shared'

/** Every skill note this agent has, in any status. */
export async function loadSkills(spaceId: string, agent: string): Promise<SkillDoc[]> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED,
      deletedAt: null,
      path: { startsWith: `agents/${agent}/skills/`, endsWith: '/index.md' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  return rows
    .map((row) => parseSkill(row.path, parseFrontmatter(row.content)))
    .filter((skill): skill is SkillDoc => Boolean(skill))
}

export interface ChosenSkill {
  slug: string
  title: string
  steps: string
}

/**
 * The skills this run should have in front of it, with their procedures.
 *
 * `request` is what the run is about — the brief, plus whatever triggered it.
 * Only approved skills are selected; the agent may still read any other with
 * the ordinary note tools, because reading a note is not running one.
 */
export async function skillsForRun(
  spaceId: string,
  agent: string,
  request: string,
  limit = 3,
): Promise<ChosenSkill[]> {
  const chosen = selectSkills(request, await loadSkills(spaceId, agent), limit)
  if (chosen.length === 0) return []

  const steps = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED,
      deletedAt: null,
      path: { in: chosen.map((skill) => skillStepsPath(agent, skill.slug)) },
    },
    select: { path: true, content: true },
  })
  const byPath = new Map(steps.map((row) => [row.path, row.content]))
  return chosen.map((skill) => ({
    slug: skill.slug,
    title: skill.title,
    steps: byPath.get(skillStepsPath(agent, skill.slug))?.trim() ?? '',
  }))
}

/**
 * What the model is told. Framed as things it was TAUGHT rather than
 * instructions to obey: a skill is advice, every step still runs through the
 * same gates, and a procedure that no longer works should be reported rather
 * than forced through.
 */
export function skillsMessage(skills: readonly ChosenSkill[]): string | null {
  if (skills.length === 0) return null
  const blocks = skills.map((skill) => `## ${skill.title}\n\n${skill.steps || '(no steps were written down)'}`)
  return [
    'You have been taught how to do things like this before. Follow these where they fit, and say so if one no',
    'longer matches what you find — the world moves and a skill can go stale.',
    '',
    ...blocks,
  ].join('\n')
}
