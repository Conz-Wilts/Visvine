'use client';

// People & access → Teams: teams are the community's roles for context access.
// Each card manages BOTH sides in one place — who is on the team, and what the
// team can see (its grants, editable inline). Onboarding someone into a team is
// one action that opens everything the team can reach.

import { useMemo, useState } from 'react';
import { Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Avatar, Button, ConfirmDialog, Input, SettingsSection } from '@/components/ui';
import { notesApi } from '@/features/notes/lib/notesApi';
import type { TeamInfo } from '@/lib/notes/teams';
import {
  GrantEditor,
  type CommunityMember,
  type OverviewGrant,
  type PeopleData,
} from './shared';

interface Props {
  communityId: string;
  data: PeopleData;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}

export default function TeamsTab({ communityId, data, busy, run }: Props) {
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TeamInfo | null>(null);

  const activeMembers = useMemo(
    () => data.members.filter((m) => m.status === 'active'),
    [data.members],
  );

  const createTeam = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    await run(() => notesApi.teamAction(communityId, { action: 'create', name }));
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Teams">
        <div className="mb-5 flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New team name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTeam();
            }}
          />
          <Button
            variant="pill-primary"
            onClick={() => void createTeam()}
            disabled={busy || !newName.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> Create
          </Button>
        </div>

        {data.teams.length === 0 ? (
          <p className="text-sm text-text-muted">No teams yet.</p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {data.teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                members={activeMembers}
                grants={(data.overview?.grants ?? []).filter(
                  (g) => g.subjectType === 'team' && g.subjectId === team.id,
                )}
                paths={data.paths}
                contextName={data.contextName}
                busy={busy}
                communityId={communityId}
                run={run}
                onDelete={() => setDeleteTarget(team)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete team "${deleteTarget?.name ?? ''}"`}
        body="The team and every grant that targets it are removed — its members immediately lose whatever access came through it. Their direct grants and other teams are untouched."
        confirmLabel="Delete team"
        destructive
        onConfirm={() => {
          const team = deleteTarget;
          setDeleteTarget(null);
          if (team) void run(() => notesApi.teamAction(communityId, { action: 'delete', teamId: team.id }));
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function TeamCard({ team, members, grants, paths, contextName, busy, communityId, run, onDelete }: {
  team: TeamInfo;
  members: CommunityMember[];
  grants: OverviewGrant[];
  paths: PeopleData['paths'];
  contextName: string;
  busy: boolean;
  communityId: string;
  run: Props['run'];
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(team.name);
  const [editDescription, setEditDescription] = useState(team.description ?? '');

  const inTeam = useMemo(() => new Set(team.members.map((m) => m.userId)), [team.members]);
  const addable = useMemo(() => members.filter((m) => !inTeam.has(m.userId)), [members, inTeam]);

  const addMember = (userId: string) => {
    setAdding('');
    if (!userId) return;
    void run(() =>
      notesApi.teamAction(communityId, { action: 'setMember', teamId: team.id, userId, role: 'member' }),
    );
  };

  const saveEdit = () => {
    const name = editName.trim();
    if (!name) return;
    setEditing(false);
    void run(() =>
      notesApi.teamAction(communityId, {
        action: 'update',
        teamId: team.id,
        name,
        description: editDescription.trim() || undefined,
      }),
    );
  };

  return (
    <div className="py-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        {editing ? (
          <div className="min-w-0 flex-1 space-y-2">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Team name" />
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
            />
            <div className="flex gap-2">
              <Button variant="pill-primary" onClick={saveEdit} disabled={busy || !editName.trim()} className="!px-3 !py-1.5 !text-xs">
                Save
              </Button>
              <Button variant="pill-secondary" onClick={() => setEditing(false)} className="!px-3 !py-1.5 !text-xs">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-text-primary">{team.name}</h4>
            <p className="text-xs text-text-muted">
              {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
              {team.description ? <> · {team.description}</> : null}
            </p>
          </div>
        )}
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Rename team"
              onClick={() => {
                setEditName(team.name);
                setEditDescription(team.description ?? '');
                setEditing(true);
              }}
              disabled={busy}
              className="rounded p-1.5 text-text-muted transition hover:text-text-primary disabled:opacity-40"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Delete team"
              onClick={onDelete}
              disabled={busy}
              className="rounded p-1.5 text-text-muted transition hover:text-red-500 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        {team.members.map((member) => (
          <div key={member.userId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
            <Avatar name={member.name} imageUrl={member.image} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-text-primary">{member.name}</span>
                {member.role === 'lead' && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    <ShieldCheck className="h-3 w-3" /> lead
                  </span>
                )}
              </div>
              {member.email && <div className="truncate text-[11px] text-text-muted">{member.email}</div>}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  notesApi.teamAction(communityId, {
                    action: 'setMember',
                    teamId: team.id,
                    userId: member.userId,
                    role: member.role === 'lead' ? 'member' : 'lead',
                  }),
                )
              }
              className="shrink-0 text-[11px] font-medium text-text-muted transition hover:text-text-primary disabled:opacity-40"
            >
              {member.role === 'lead' ? 'Make member' : 'Make lead'}
            </button>
            <button
              type="button"
              title="Remove from team"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  notesApi.teamAction(communityId, {
                    action: 'removeMember',
                    teamId: team.id,
                    userId: member.userId,
                  }),
                )
              }
              className="shrink-0 rounded p-1 text-text-muted transition hover:text-red-500 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {team.members.length === 0 && (
          <p className="px-2 py-1 text-sm text-text-muted">No members yet.</p>
        )}
      </div>

      {addable.length > 0 && (
        <div className="mt-2">
          <select
            value={adding}
            onChange={(e) => addMember(e.target.value)}
            disabled={busy}
            className="h-8 w-full rounded-lg border border-border-default bg-surface-1 px-2 text-sm text-text-secondary"
          >
            <option value="">+ Add a member…</option>
            {addable.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name} ({m.user.email})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* What this team can see — its grants, editable in place */}
      <div className="mt-4">
        <h5 className="mb-1.5 px-1 text-xs font-medium text-text-muted">Can access</h5>
        <GrantEditor
          communityId={communityId}
          subjectType="team"
          subjectId={team.id}
          grants={grants}
          paths={paths}
          contextName={contextName}
          busy={busy}
          run={run}
          emptyText="Nothing yet."
          placeholder="Grant access to…"
          addLabel="Grant"
        />
      </div>
    </div>
  );
}
