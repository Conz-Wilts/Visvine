'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Select from '@/components/ui/Select';

interface Member {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt: string;
  };
}

function RoleChip({ role, userId, loading, onUpdate }: {
  role: string;
  userId: string;
  loading: boolean;
  onUpdate: (userId: string, role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    }
    setOpen(v => !v);
  };

  const chipStyle = role === 'admin'
    ? 'bg-amber-400 text-white hover:bg-amber-500'
    : 'bg-blue-500 text-white hover:bg-blue-600';

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={handleOpen}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${chipStyle}`}
      >
        {role}
        <svg className="w-3 h-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && createPortal(
        <div
          style={{ position: 'absolute', top: coords.top, left: coords.left, zIndex: 9999 }}
          className="bg-surface-1 border border-border-subtle rounded-xl shadow-xl overflow-hidden min-w-[120px]"
        >
          {(['member', 'admin'] as const).map(r => (
            <button
              key={r}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => { setOpen(false); if (r !== role) onUpdate(userId, r); }}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-2 ${
                r === role ? 'text-text-primary bg-surface-2' : 'text-text-secondary'
              }`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
              {r === role && (
                <svg className="w-3 h-3 inline ml-1.5 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function InviteModal({ communityId, onAdded, onClose }: {
  communityId: string;
  onAdded: (member: Member) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to add member'); return; }
      onAdded(data.member);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-1 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">Invite Member</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Email address</label>
            <input
              type="email"
              required
              autoFocus
              placeholder="user@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Role</label>
            <Select
              value={role}
              onChange={e => setRole(e.target.value as 'member' | 'admin')}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-text-secondary border border-border-default rounded-full hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-full transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-brand-green, #78d870)' }}
            >
              {loading ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MembersPanel({ communityId }: { communityId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/members`);
      if (!res.ok) throw new Error('Failed to load members');
      const data = await res.json();
      setMembers(data.members);
    } catch {
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  const updateRole = async (userId: string, role: string) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/communities/${communityId}/members/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: data.member.role } : m));
    } finally {
      setActionLoading(null);
    }
  };

  const removeMember = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this community?`)) return;
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/communities/${communityId}/members/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setMembers(prev => prev.filter(m => m.userId !== userId));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="p-6 text-sm text-text-muted">Loading members…</div>;
  if (error) return <div className="p-6 text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      {/* Header row with invite chip */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-full transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--color-brand-green, #78d870)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Invite member
        </button>
      </div>

      {/* Members table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left">
              <th className="pb-3 pr-4 text-xs font-semibold text-text-muted uppercase tracking-wider">Member</th>
              <th className="pb-3 pr-4 text-xs font-semibold text-text-muted uppercase tracking-wider">Role</th>
              <th className="pb-3 pr-4 text-xs font-semibold text-text-muted uppercase tracking-wider">Joined</th>
              <th className="pb-3 text-xs font-semibold text-text-muted uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {members.map(member => (
              <tr key={member.id} className="hover:bg-surface-2 transition">
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-3">
                    {member.user.image ? (
                      <img src={member.user.image} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center text-xs font-bold text-text-secondary">
                        {member.user.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-text-primary">{member.user.name}</div>
                      <div className="text-xs text-text-muted">{member.user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <RoleChip
                    role={member.role}
                    userId={member.userId}
                    loading={actionLoading === member.userId}
                    onUpdate={updateRole}
                  />
                </td>
                <td className="py-3 pr-4 text-text-muted text-xs">
                  {new Date(member.joinedAt).toLocaleDateString()}
                </td>
                <td className="py-3">
                  <button
                    onClick={() => removeMember(member.userId, member.user.name)}
                    disabled={actionLoading === member.userId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-text-muted text-sm">No members yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <InviteModal
          communityId={communityId}
          onAdded={member => setMembers(prev => [...prev, member])}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}
