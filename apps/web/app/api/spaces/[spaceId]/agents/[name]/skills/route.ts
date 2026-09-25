import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { loadSkills } from '@/lib/agents/skills';
import { getSession } from '@/lib/session';
import { splitFrontmatter } from '@/lib/notes/shared/markdown';
import { writeGated } from '@/lib/notes/contextService';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { skillIndexPath, unmetReach } from '@/lib/agents/shared/skills';
import { agentMachinePolicy } from '@/lib/agents/machineReach';
import { agentFolderIn } from '@/lib/agents/location';
import { agentHomeFolder } from '@/lib/agents/shared/folder';
import { allActions } from '@/lib/actions/registry';

const SHARED = 'shared';

/**
 * What an agent has been taught, and what is waiting to be approved.
 *
 * A member can see the list — a skill is a note in their space and they can
 * read it anyway — and the unmet reach beside each pending one, which is what
 * an approver is actually deciding about.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;

  const skills = await loadSkills(spaceId, name);
  // The agent's OWN reach — its declared connectors' hosts, not the space's
  // whole list — because that is what its machine will actually be held to.
  const policy = await agentMachinePolicy(spaceId, name);
  const actions = allActions().map((a) => a.name);
  const allowed = policy?.policy.allow ?? [];

  return NextResponse.json({
    isAdmin: resolved.isAdmin,
    skills: skills.map((skill) => ({
      slug: skill.slug,
      title: skill.title,
      description: skill.description,
      status: skill.status,
      path: skill.path,
      taughtBy: skill.taughtBy,
      keywords: skill.keywords.map((rule) => rule.all.join(' ')),
      unmet: unmetReach(skill, allowed, actions),
    })),
  });
}

const patchSchema = z.object({
  slug: z.string().min(1),
  status: z.enum(['approved', 'retired', 'pending']),
});

/**
 * Approve, retire, or send a skill back.
 *
 * Only approved skills are ever put in front of the agent, so this is the gate:
 * approving one is agreeing that its procedure — and the reach it claims — is
 * something this space's agent may act on. The status lives in the note, so the
 * decision is visible where the skill is, and an edit to the note is an edit to
 * the decision.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'slug and status are required' }, { status: 400 });
  const { slug, status } = parsed.data;

  const path = skillIndexPath((await agentFolderIn(spaceId, name)) ?? agentHomeFolder(name), slug);
  const note = await prisma.contextNote.findUnique({
    where: { note_identity: { spaceId, ownerKey: SHARED, path } },
    select: { content: true },
  });
  if (!note) return NextResponse.json({ error: 'No such skill.' }, { status: 404 });

  // Rewrite only the status line: the rest of the note is the author's, and an
  // approval must not quietly reformat what it approved.
  const { frontmatter, body } = splitFrontmatter(note.content);
  // A skill note without frontmatter is not a skill; refusing beats inventing one.
  if (!frontmatter) return NextResponse.json({ error: 'That note is not a skill.' }, { status: 422 });
  const next = /^status:.*$/m.test(frontmatter)
    ? frontmatter.replace(/^status:.*$/m, `status: ${status}`)
    : `${frontmatter.trimEnd()}\nstatus: ${status}`;
  const content = `---\n${next.trim()}\n---\n${body}`;

  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  const result = await writeGated(await principalOf(resolved), { spaceId, ownerKey: SHARED }, path, content, 'edit');
  if (result.status !== 'applied') return NextResponse.json({ error: result.reason }, { status: 403 });

  return NextResponse.json({ slug, status });
}
