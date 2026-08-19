'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar, Alert, SearchInput, Chip, Modal } from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  spaceName: string | null;
}

interface AddMembersModalProps {
  isOpen: boolean;
  /** Members already in the channel — filtered out of the picker. */
  existingMemberIds?: string[];
  conversationId?: string;
  onClose: () => void;
  onMembersUpdated?: () => void;
}

// ─── Main modal ───────────────────────────────────────────────────────────────

/** Invite platform members into a channel. Directory people with no account are
 *  listed too, with their contact details copyable for an off-platform invite. */
export default function AddMembersModal({
  isOpen,
  existingMemberIds = [],
  conversationId,
  onClose,
  onMembersUpdated,
}: AddMembersModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [directoryPeople, setDirectoryPeople] = useState<DirectoryPerson[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const eligibleUsers = useMemo(() => {
    const existing = new Set(existingMemberIds);
    return users.filter((u) => !existing.has(u.id));
  }, [users, existingMemberIds]);

  // Selected user objects for chips display
  const selectedUserObjects = useMemo(
    () => Array.from(selectedMembers).map((id) => users.find((u) => u.id === id)).filter(Boolean) as UserOption[],
    [selectedMembers, users],
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedMembers(new Set());
    setQuery('');
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        const payload = await fetchJson<{ users?: UserOption[]; directoryPeople?: DirectoryPerson[] }>(
          `/api/messages/users?${params.toString()}`,
          { signal: controller.signal },
        );
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

  const handleToggleMember = (userId: string) => {
    setSelectedMembers((prev) => {
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
      if (!conversationId) { setError('Conversation ID is required.'); return; }
      if (selectedMembers.size === 0) { setError('Pick at least one person to add.'); return; }
      await fetchJsonBody(`/api/messages/conversations/${conversationId}/members`, 'POST', {
        memberIds: Array.from(selectedMembers),
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
    // Copy their contact info so they can be invited off-platform.
    navigator.clipboard.writeText(person.email ?? person.name).catch(() => {});
    setCopiedId(person.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

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
            <h2 className="text-lg font-bold text-text-primary">Add members</h2>
            <p className="mt-0.5 text-xs text-text-muted">Invite people to this channel</p>
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

        {/* Selected members chips */}
        {selectedUserObjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {selectedUserObjects.map((user) => (
              <div key={user.id} className="flex items-center gap-1.5 rounded-full bg-brand-green/10 border border-brand-green/20 pl-1.5 pr-2 py-1">
                <Avatar name={user.name} size="chip" />
                <span className="text-xs font-medium text-brand-green">{user.name.split(' ')[0]}</span>
                <button
                  type="button"
                  onClick={() => handleToggleMember(user.id)}
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
            <div className="section-y-1 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-surface-3 shrink-0" />
                  <div className="flex-1 section-y-2">
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
                const isSelected = selectedMembers.has(user.id);

                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleToggleMember(user.id)}
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
                <Chip tone="muted" size="xs">Not yet on platform</Chip>
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
                        {person.subtitle ?? person.spaceName ?? 'Directory member'}
                      </p>
                    </div>
                    {/* Invite button — copies contact info to clipboard */}
                    <button
                      type="button"
                      onClick={() => handleInvite(person)}
                      className={`shrink-0 flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
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
              disabled={submitting || selectedMembers.size === 0}
              className="flex-1 rounded-xl bg-brand-green py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              {submitting ? 'Saving…' : 'Add members'}
            </button>
          </div>
        </div>
    </Modal>
  );
}
