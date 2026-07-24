// Teams of a community (lib/notes/teams.ts): named member groups that grants
// can target. Any member may LIST teams (they're organizational, not secret);
// community admins create/rename/delete; admins or team LEADS manage a team's
// membership.
//   GET  ?communityId=                                   → { teams }
//   POST { communityId, action, ... }:
//        'create'       { name, description? }            — community admin
//        'update'       { teamId, name?, description? }   — community admin
//        'delete'       { teamId }                        — community admin (grants go too)
//        'setMember'    { teamId, userId, role? }         — admin or team lead
//        'removeMember' { teamId, userId }                — admin or team lead

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import {
  canManageTeam,
  createTeam,
  deleteTeam,
  listTeams,
  removeTeamMember,
  setTeamMember,
  updateTeam,
} from '@/lib/notes/teams'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  return NextResponse.json({ teams: await listTeams(brain.communityId) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.isPersonalSpace) return fail('Personal spaces have no teams')
  const action = typeof body.action === 'string' ? body.action : null
  const actor = { userId: brain.actor.id, name: brain.actor.name }

  try {
    if (action === 'create' || action === 'update' || action === 'delete') {
      if (!brain.isAdmin) return fail('Only a community admin can manage teams', 403)
      if (action === 'create') {
        const name = typeof body.name === 'string' ? body.name : ''
        const description = typeof body.description === 'string' ? body.description : undefined
        return NextResponse.json({ team: await createTeam(brain.communityId, { name, description }, actor) })
      }
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      if (!teamId) return fail('teamId is required')
      if (action === 'update') {
        await updateTeam(brain.communityId, teamId, {
          name: typeof body.name === 'string' ? body.name : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
        })
        return NextResponse.json({ ok: true })
      }
      await deleteTeam(brain.communityId, teamId, actor)
      return NextResponse.json({ ok: true })
    }

    if (action === 'setMember' || action === 'removeMember') {
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      const userId = typeof body.userId === 'string' ? body.userId : null
      if (!teamId || !userId) return fail('teamId and userId are required')
      if (!(await canManageTeam(teamId, brain.actor.id, brain.isAdmin))) {
        return fail('Only a community admin or a team lead can manage team members', 403)
      }
      if (action === 'setMember') {
        const role = body.role === 'lead' ? 'lead' : 'member'
        await setTeamMember(brain.communityId, teamId, userId, role, actor)
      } else {
        await removeTeamMember(brain.communityId, teamId, userId)
      }
      return NextResponse.json({ ok: true })
    }

    return fail('Unknown action')
  } catch (err) {
    return failFromError(err)
  }
}
