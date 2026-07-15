'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar, Alert, SearchInput, Badge, Modal } from '@/components/ui';
import { fetchJsonBody } from '@/lib/fetchJson';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'dm' | 'group' | 'addMembers';

interface UserOption {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface DirectoryPerson {
  id: string;
  name: string;
  subtitle: string | null;
  email: string | null;
  imageUrl: string | null;
  communityName: string | null;
}

interface NewChatModalProps {
  isOpen: boolean;
  mode?: Mode;
  existingMemberIds?: string[];
  addMembersConversationId?: string;
  onClose: () => void;
  onConversationSelected: (conversationId: string) => void;
  onMembersUpdated?: () => void;
}


// ─── Main modal ───────────────────────────────────────────────────────────────

export default function NewChatModal({
  isOpen,
  mode = 'dm',
  existingMemberIds = [],
  addMembersConversationId,
  onClose,
  onConversationSelected,
  onMembersUpdated,
}: NewChatModalProps) {
  const [activeMode, setActiveMode] = useState<Mode>(mode);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [directoryPeople, setDirectoryPeople] = useState<DirectoryPerson[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDmUserId, setSelectedDmUserId] = useState<string | null>(null);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isAddMembers = activeMode === 'addMembers';

  // Users that can actually be selected (exclude already-in-group users for addMembers mode)
  const eligibleUsers = useMemo(() => {
    if (!isAddMembers) return users;
    const existing = new Set(existingMemberIds);
    return users.filter((u) => !existing.has(u.id));
  }, [isAddMembers, users, existingMemberIds]);

  // Selected user objects for chips display
  const selectedUserObjects = useMemo(() => {
    const ids = activeMode === 'dm'
      ? (selectedDmUserId ? [selectedDmUserId] : [])
      : Array.from(selectedGroupMembers);
    return ids.map((id) => users.find((u) => u.id === id)).filter(Boolean) as UserOption[];
  }, [activeMode, selectedDmUserId, selectedGroupMembers, users]);

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setActiveMode(mode);
    setSelectedDmUserId(null);
    setSelectedGroupMembers(new Set());
    setGroupName('');
    setQuery('');
    setError(null);
  }, [isOpen, mode]);

  // Fetch users with debounced query
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        const res = await fetch(`/api/messages/users?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed to fetch users');
        const payload = await res.json();
        setUsers(payload.users ?? []);
        setDirectoryPeople(payload.directoryPeople ?? []);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Unable to load users right now.');
      } finally {
        setLoading(false);
      }
    };
    const t = setTimeout(() => void fetchUsers(), 150);
    return () => { clearTimeout(t); controller.abort(); };
  }, [isOpen, query]);

  if (!isOpen) return null;

  const handleToggleGroupMember = (userId: string) => {
    setSelectedGroupMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      setSubmitting(true);

      if (activeMode === 'dm') {
        if (!selectedDmUserId) { setError('Select someone to message.'); return; }
        const payload = await fetchJsonBody<{ conversation: { id: string } }>('/api/messages/conversations/dm', 'POST', { userId: selectedDmUserId });
        onConversationSelected(payload.conversation.id);
        onClose();
        return;
      }

      if (activeMode === 'group') {
        if (!groupName.trim()) { setError('Give your group a name.'); return; }
        if (selectedGroupMembers.size === 0) { setError('Add at least one member.'); return; }
        const payload = await fetchJsonBody<{ conversation: { id: string } }>('/api/messages/conversations/group', 'POST', {
          name: groupName.trim(),
          memberIds: Array.from(selectedGroupMembers),
        });
        onConversationSelected(payload.conversation.id);
        onClose();
        return;
      }

      // addMembers mode
      if (!addMembersConversationId) { setError('Conversation ID is required.'); return; }
      if (selectedGroupMembers.size === 0) { setError('Pick at least one person to add.'); return; }
      await fetchJsonBody(`/api/messages/conversations/${addMembersConversationId}/members`, 'POST', {
        memberIds: Array.from(selectedGroupMembers),
      });
      onMembersUpdated?.();
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Unable to complete request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = (person: DirectoryPerson) => {
    // Copy their contact info or a friendly invite snippet to clipboard
    const contact = person.email ?? person.name;
    const text = person.email
      ? `Invite ${person.name} (${person.email}) to join the platform.`
      : `Invite ${person.name} to join the platform.`;
    navigator.clipboard.writeText(contact).catch(() => {});
    setCopiedId(person.id);
    setTimeout(() => setCopiedId(null), 2000);
    void text; // info available if needed for toast
  };

  const submitLabel = submitting
    ? 'Saving…'
    : activeMode === 'dm'
      ? 'Start conversation'
      : activeMode === 'group'
        ? 'Create group'
        : 'Add members';

  const canSubmit = activeMode === 'dm'
    ? Boolean(selectedDmUserId)
    : selectedGroupMembers.size > 0;

  return (
    <Modal
      onClose={onClose}
      closeOnEscape={false}
      overlayClassName="items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      maxWidth="sm:max-w-lg"
      panelClassName="flex h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-surface-1 shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:rounded-2xl"
    >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              {isAddMembers ? 'Add members' : 'New conversation'}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {activeMode === 'dm'
                ? 'Send a direct message to someone'
                : activeMode === 'group'
                  ? 'Create a group chat with multiple people'
                  : 'Invite people to this group'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-text-muted hover:bg-gray-200 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Chat type selector — DM vs Group (hidden in addMembers mode) */}
        {!isAddMembers && (
          <div className="grid grid-cols-2 gap-3 px-5 pb-4">
            {/* Direct message card */}
            <button
              type="button"
              onClick={() => { setActiveMode('dm'); setSelectedGroupMembers(new Set()); }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition-all duration-150 ${
                activeMode === 'dm'
                  ? 'border-brand-green bg-brand-green/5'
                  : 'border-border-subtle bg-surface-2 hover:border-border-default'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${activeMode === 'dm' ? 'bg-brand-green text-white' : 'bg-gray-200 text-text-muted'}`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className={`text-sm font-semibold ${activeMode === 'dm' ? 'text-brand-green' : 'text-text-secondary'}`}>Direct</p>
                <p className="text-[11px] text-text-muted mt-0.5">One-on-one chat</p>
              </div>
            </button>

            {/* Group chat card */}
            <button
              type="button"
              onClick={() => { setActiveMode('group'); setSelectedDmUserId(null); }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition-all duration-150 ${
                activeMode === 'group'
                  ? 'border-brand-green bg-brand-green/5'
                  : 'border-border-subtle bg-surface-2 hover:border-border-default'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${activeMode === 'group' ? 'bg-brand-green text-white' : 'bg-gray-200 text-text-muted'}`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
                </svg>
              </div>
              <div>
                <p className={`text-sm font-semibold ${activeMode === 'group' ? 'text-brand-green' : 'text-text-secondary'}`}>Group</p>
                <p className="text-[11px] text-text-muted mt-0.5">Chat with many people</p>
              </div>
            </button>
          </div>
        )}

        {/* Group name input — only for group mode */}
        {activeMode === 'group' && (
          <div className="px-5 pb-3">
            <SearchInput
              value={groupName}
              onChange={setGroupName}
              placeholder="Group name…"
              icon={
                <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              }
            />
          </div>
        )}

        {/* Selected members chips */}
        {selectedUserObjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {selectedUserObjects.map((user) => (
              <div key={user.id} className="flex items-center gap-1.5 rounded-full bg-brand-green/10 border border-brand-green/20 pl-1.5 pr-2 py-1">
                <Avatar name={user.name} size="chip" />
                <span className="text-xs font-medium text-brand-green">{user.name.split(' ')[0]}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (activeMode === 'dm') setSelectedDmUserId(null);
                    else handleToggleGroupMember(user.id);
                  }}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-green/20 text-brand-green hover:bg-brand-green/40 transition-colors"
                >
                  <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search input */}
        <div className="px-5 pb-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search people…"
            autoFocus
          />
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-3">
          {loading && (
            <div className="space-y-1 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-surface-3 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
                    <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && eligibleUsers.length === 0 && directoryPeople.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3">
                <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-sm text-text-muted">{query ? `No results for "${query}"` : 'No users found'}</p>
            </div>
          )}

          {/* ── Active platform users ── */}
          {!loading && eligibleUsers.length > 0 && (
            <div className="py-1">
              {/* Section label — only shown when directory section is also visible */}
              {directoryPeople.length > 0 && (
                <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Active members
                </p>
              )}
              {eligibleUsers.map((user) => {
                const isSelectedDm = selectedDmUserId === user.id;
                const isSelectedGroup = selectedGroupMembers.has(user.id);
                const isSelected = activeMode === 'dm' ? isSelectedDm : isSelectedGroup;

                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      if (activeMode === 'dm') {
                        setSelectedDmUserId(isSelectedDm ? null : user.id);
                      } else {
                        handleToggleGroupMember(user.id);
                      }
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                      isSelected ? 'bg-brand-green/8 ring-1 ring-brand-green/20' : 'hover:bg-surface-2'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar name={user.name} />
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-green ring-2 ring-white">
                          <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${isSelected ? 'text-brand-green' : 'text-text-primary'}`}>{user.name}</p>
                      <p className="truncate text-xs text-text-muted">{user.email}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${isSelected ? 'text-brand-green' : 'text-text-muted'}`}>
                      {isSelected ? 'Selected' : 'Select'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Directory people (no active account) ── */}
          {!loading && directoryPeople.length > 0 && (
            <div className="pb-2">
              <div className="flex items-center gap-2 px-3 pb-1.5 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  From directory
                </p>
                <Badge variant="label">Not yet on platform</Badge>
              </div>
              {directoryPeople.map((person) => {
                const isCopied = copiedId === person.id;
                return (
                  <div
                    key={person.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  >
                    <div className="relative shrink-0">
                      <Avatar name={person.name} imageUrl={person.imageUrl} />
                      {/* Offline / not-active indicator */}
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-gray-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-secondary">{person.name}</p>
                      <p className="truncate text-xs text-text-muted">
                        {person.subtitle ?? person.communityName ?? 'Directory member'}
                      </p>
                    </div>
                    {/* Invite button — copies contact info to clipboard */}
                    <button
                      type="button"
                      onClick={() => handleInvite(person)}
                      className={`shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
                        isCopied
                          ? 'border-brand-green bg-brand-green/10 text-brand-green'
                          : 'border-border-default text-text-muted hover:border-brand-green hover:bg-brand-green/5 hover:text-brand-green'
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                          </svg>
                          Invite
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border-subtle px-5 py-4">
          {error && <Alert variant="error" inline className="mb-3">{error}</Alert>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border-default py-2.5 text-sm font-semibold text-gray-600 hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !canSubmit}
              className="flex-1 rounded-xl bg-brand-green py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              {submitLabel}
            </button>
          </div>
        </div>
    </Modal>
  );
}
