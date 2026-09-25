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
import { pickByMeaning, ROUTE_CONFIDENCE } from '@/lib/judge/route'
import { parseSkill, selectSkills, type SkillDoc } from '@/lib/agents/shared/skills'
import { agentFolderIn } from './location'
import { agentHomeFolder } from './shared/folder'

const SHARED = 'shared'

/** Every skill note this agent has, in any status. */
export async function loadSkills(spaceId: string, agent: string): Promise<SkillDoc[]> {
  const folder = (await agentFolderIn(spaceId, agent)) ?? agentHomeFolder(agent)
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED,
      deletedAt: null,
      path: { startsWith: `${folder}/skills/`, endsWith: '/index.md' },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  return rows
    .map((row) => parseSkill(row.path, parseFrontmatter(row.content)))
    .filter((skill): skill is SkillDoc => Boolean(skill))
}

/** A skill's steps note sits beside its index. */
const stepsOf = (skill: SkillDoc) => skill.path.replace(/index\.md$/, 'steps.md')

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
  // Keywords pick what the author predicted a request would say; the judge
  // picks the skill the request MEANS, in whatever words. Only approved skills
  // are candidates for either, and the judged pick leads.
  const all = await loadSkills(spaceId, agent)
  const approved = all.filter((skill) => skill.status === 'approved')
  const picked = await pickByMeaning(
    request,
    approved.map((skill) => ({ id: skill.path, about: `${skill.title} — ${skill.description}` })),
    'Which skill, if any, is a procedure for what this run is asked to do?',
  )
  const judged = picked?.id && picked.confidence >= ROUTE_CONFIDENCE ? approved.filter((skill) => skill.path === picked.id) : []
  const chosen = [...judged, ...selectSkills(request, all, limit).filter((skill) => skill.path !== judged[0]?.path)].slice(0, limit)
  if (chosen.length === 0) return []

  const steps = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED,
      deletedAt: null,
      path: { in: chosen.map(stepsOf) },
    },
    select: { path: true, content: true },
  })
  const byPath = new Map(steps.map((row) => [row.path, row.content]))
  return chosen.map((skill) => ({
    slug: skill.slug,
    title: skill.title,
    steps: byPath.get(stepsOf(skill))?.trim() ?? '',
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
