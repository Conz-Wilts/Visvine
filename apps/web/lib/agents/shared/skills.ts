/**
 * What an agent has been taught.
 *
 * A skill is a note — `agents/<name>/skills/<slug>/index.md` — because this
 * platform's premise is that notes are how you direct an agent. Teaching one
 * writes a note; reviewing one is reading a diff; improving one is an edit. No
 * new storage, no new editor, and the same grants as everything else.
 *
 * This module is the pure half: what a skill note says, which skills a request
 * calls for, and what a skill is allowed to claim. Selection is the same
 * mechanism recipes use — a weighted term overlap over `keywords:`, so it is
 * deterministic, free, and survives the round trip through YAML. Nothing here
 * compiles a pattern supplied by content.
 *
 * The property that has to hold no matter what a skill says:
 *
 *   **A skill is advice, never authorization.** Its steps run through the same
 *   `runAction` gate, the same grants and the same egress policy as anything
 *   else. `hosts:` and `actions:` on a skill declare what it EXPECTS to need,
 *   so an admin approving it can see the reach they are approving — they do not
 *   grant it. A wrong or malicious skill costs a refusal, never an escape.
 */
import { scoreCandidates, type KeywordRule, type MatchCandidate } from '@/lib/actions/shared/match'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'

/** Where an agent's skills live, and what one is called. */
const SKILLS_FOLDER = 'skills'

export type SkillStatus = 'draft' | 'pending' | 'approved' | 'retired'

export interface SkillDoc {
  /** `agents/<agent>/skills/<slug>/index.md` */
  path: string
  agent: string
  slug: string
  title: string
  description: string
  status: SkillStatus
  /** What a request has to look like for this to be worth reading. */
  keywords: readonly KeywordRule[]
  /** Hosts the skill expects to reach. A claim an approver can read, never a grant. */
  hosts: readonly string[]
  /** Actions it expects to call. Same: a claim, checked against the registry. */
  actions: readonly string[]
  /** The image the skill was taught against, so a break can be attributed. */
  imageDigest: string | null
  /** Who demonstrated it, and in which run. */
  taughtBy: string | null
  taughtInRun: string | null
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `agents/<agent>/skills/<slug>/` — the folder a skill IS. */
function skillFolder(agent: string, slug: string): string {
  return `agents/${agent}/${SKILLS_FOLDER}/${slug}`
}

export function skillIndexPath(agent: string, slug: string): string {
  return `${skillFolder(agent, slug)}/index.md`
}

export function skillStepsPath(agent: string, slug: string): string {
  return `${skillFolder(agent, slug)}/steps.md`
}

/** The (agent, slug) a skill path names, or null when the path is not one. */
export function parseSkillPath(path: string): { agent: string; slug: string } | null {
  const match = /^agents\/([^/]+)\/skills\/([^/]+)\/index\.md$/.exec(path)
  if (!match) return null
  const [, agent, slug] = match
  return SLUG.test(slug) ? { agent, slug } : null
}

/** A slug from a title. Deterministic, so teaching the same thing twice collides rather than duplicates. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'skill'
}

function statusOf(raw: unknown): SkillStatus {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return value === 'approved' || value === 'pending' || value === 'retired' ? value : 'draft'
}

function strings(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit)
}

/**
 * `keywords:` is a list of phrases, and every word in a phrase must appear for
 * it to count — so "expense report" matches a request about expense reports and
 * not one that merely says "report". Weight is the phrase's length, because a
 * more specific phrase is a better reason to read a skill.
 */
export function parseKeywords(raw: unknown): KeywordRule[] {
  return strings(raw, 32)
    .map((phrase) => {
      const all = phrase
        .toLowerCase()
        .split(/[^a-z0-9'_-]+/)
        .filter(Boolean)
      return { all, score: all.length }
    })
    .filter((rule) => rule.all.length > 0)
}

/**
 * Read a skill note. Never throws: a malformed skill is one that does not get
 * selected, not one that breaks the agent that owns it.
 */
export function parseSkill(path: string, fm: NoteFrontmatter): SkillDoc | null {
  const ref = parseSkillPath(path)
  if (!ref) return null
  return {
    path,
    agent: ref.agent,
    slug: ref.slug,
    title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : ref.slug,
    description: typeof fm.description === 'string' ? fm.description.trim() : '',
    status: statusOf(fm.status),
    keywords: parseKeywords(fm.keywords),
    hosts: strings(fm.hosts, 32),
    actions: strings(fm.actions, 32),
    imageDigest: typeof fm.image_digest === 'string' ? fm.image_digest : null,
    taughtBy: typeof fm.taught_by === 'string' ? fm.taught_by : null,
    taughtInRun: typeof fm.taught_in_run === 'string' ? fm.taught_in_run : null,
  }
}

/**
 * Which skills a request calls for.
 *
 * Only approved skills are ever selected: a draft is someone's work in
 * progress and a pending one is waiting for an admin to say what reach it may
 * assume. The agent may still READ any of its skills — reading a note is not
 * running one — but nothing unapproved is put in front of it automatically.
 */
export function selectSkills(request: string, skills: readonly SkillDoc[], limit = 3): SkillDoc[] {
  const approved = skills.filter((skill) => skill.status === 'approved')
  const candidates: MatchCandidate[] = approved.map((skill) => ({ id: skill.path, keywords: skill.keywords }))
  const byPath = new Map(approved.map((skill) => [skill.path, skill]))
  return scoreCandidates(request, candidates)
    .filter((match) => match.score > 0)
    .slice(0, limit)
    .map((match) => byPath.get(match.id))
    .filter((skill): skill is SkillDoc => Boolean(skill))
}

/**
 * Publishing a skill follows the Tools rule exactly, because it is the same
 * question: an admin's publish lands approved (they are the approver), a
 * member's lands pending and waits. A re-publish supersedes the author's
 * earlier pending submission rather than being refused — the second attempt is
 * what they meant.
 */
export function statusOnPublish(byAdmin: boolean): SkillStatus {
  return byAdmin ? 'approved' : 'pending'
}

/**
 * What an approver is being shown. Reach a skill claims that the space does not
 * already permit is the interesting part of the diff — not because the skill
 * could take it, but because approving one that expects it is agreeing to add
 * it, and that should be a decision rather than a surprise.
 */
export function unmetReach(
  skill: SkillDoc,
  allowedHosts: readonly string[],
  knownActions: readonly string[],
): { hosts: string[]; actions: string[] } {
  const hosts = skill.hosts.filter((host) => !allowedHosts.includes(host.toLowerCase()))
  const actions = skill.actions.filter((action) => !knownActions.includes(action))
  return { hosts, actions }
}
