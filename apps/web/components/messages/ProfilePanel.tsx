'use client';

/**
 * ProfilePanel — the right-hand floating layer on the Messages page.
 *
 * For DMs it shows the other participant's profile (resolved via
 * /api/profile/by-user/[userId]); for groups and channels it shows the
 * conversation details and member list with admin management actions.
 */

import { useEffect, useState } from 'react';
import { Globe, Linkedin, Twitter, MapPin, Mail, UserPlus, Pencil, LogOut, X, Hash } from 'lucide-react';
import type { ConversationSummary } from '@/lib/messages/types';
import Avatar from '@/components/ui/Avatar';

interface PersonProfile {
  id: string;
  name: string;
  subtitle: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  pronouns: string | null;
  openToWork: boolean;
  imageUrl: string | null;
  tags: string[];
}

interface ProfileResponse {
  user: { id: string; name: string; email: string; image: string | null; createdAt: string };
  person: PersonProfile | null;
}

export interface ProfilePanelProps {
  conversation: ConversationSummary;
  currentUserId: string;
  isAdmin: boolean;
  onAddMembers: () => void;
  onRename: () => void;
  onLeave: () => void;
  onRemoveMember: (memberUserId: string) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</p>;
}

function ProfileLink({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      <Icon className="h-4 w-4 shrink-0 text-text-muted" />
      <span className="truncate">{label}</span>
    </a>
  );
}

function DmProfile({ conversation, currentUserId }: { conversation: ConversationSummary; currentUserId: string }) {
  const other = conversation.participants.find((p) => p.id !== currentUserId) ?? conversation.participants[0];
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!other?.id) return;
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    // Default cache mode on purpose: the route sets a 60s private max-age so
    // flipping between conversations doesn't refetch the same profile.
    fetch(`/api/profile/by-user/${other.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setProfile(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [other?.id]);

  if (!other) return null;

  const person = profile?.person ?? null;
  const displayName = person?.name ?? other.name;
  const imageUrl = person?.imageUrl ?? profile?.user.image ?? other.image;
  const memberSince = profile?.user.createdAt
    ? new Date(profile.user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Identity */}
      <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center">
        <Avatar name={displayName} imageUrl={imageUrl} size="xl" className="!h-16 !w-16 !text-lg" />
        <p className="mt-3 text-base font-semibold text-text-primary">{displayName}</p>
        {person?.pronouns && <p className="text-xs text-text-muted">{person.pronouns}</p>}
        {person?.subtitle && <p className="mt-1 text-sm text-text-secondary">{person.subtitle}</p>}
        {person?.openToWork && (
          <span className="mt-2 rounded-full bg-brand-green/15 px-2.5 py-1 text-[11px] font-semibold text-brand-dark-green">
            Open to work
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-3 px-6 py-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-surface-3" style={{ width: `${80 - i * 15}%` }} />
          ))}
        </div>
      )}

      {!loading && (
        <div className="space-y-5 px-5 pb-6">
          {/* Quick facts */}
          <div className="space-y-0.5">
            {(profile?.user.email ?? other.email) && (
              <ProfileLink href={`mailto:${profile?.user.email ?? other.email}`} icon={Mail} label={profile?.user.email ?? other.email} />
            )}
            {person?.location && (
              <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-text-secondary">
                <MapPin className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate">{person.location}</span>
              </div>
            )}
            {memberSince && (
              <p className="px-2.5 pt-1 text-xs text-text-muted">Member since {memberSince}</p>
            )}
          </div>

          {/* Bio */}
          {person?.bio && (
            <div className="space-y-1.5 px-2.5">
              <SectionLabel>About</SectionLabel>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{person.bio}</p>
            </div>
          )}

          {/* Links */}
          {(person?.website || person?.linkedinUrl || person?.twitterUrl) && (
            <div className="space-y-1 px-0">
              <div className="px-2.5 pb-0.5"><SectionLabel>Links</SectionLabel></div>
              {person?.website && <ProfileLink href={person.website} icon={Globe} label={person.website.replace(/^https?:\/\//, '')} />}
              {person?.linkedinUrl && <ProfileLink href={person.linkedinUrl} icon={Linkedin} label="LinkedIn" />}
              {person?.twitterUrl && <ProfileLink href={person.twitterUrl} icon={Twitter} label="Twitter / X" />}
            </div>
          )}

          {/* Tags */}
          {person && person.tags.length > 0 && (
            <div className="space-y-1.5 px-2.5">
              <SectionLabel>Tags</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {person.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupDetails({ conversation, currentUserId, isAdmin, onAddMembers, onRename, onLeave, onRemoveMember }: ProfilePanelProps) {
  const isChannel = conversation.type === 'CHANNEL';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Identity */}
      <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center">
        {isChannel ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green/15">
            <Hash className="h-7 w-7 text-brand-dark-green" />
          </div>
        ) : (
          <Avatar name={conversation.name} size="xl" className="!h-16 !w-16 !text-lg" />
        )}
        <p className="mt-3 text-base font-semibold text-text-primary">
          {isChannel ? `#${conversation.name}` : conversation.name}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {conversation.participants.length} member{conversation.participants.length === 1 ? '' : 's'}
        </p>
        {conversation.description && (
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{conversation.description}</p>
        )}
      </div>

      {/* Members */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-2.5 pb-1.5"><SectionLabel>Members</SectionLabel></div>
        {conversation.participants.map((p) => (
          <div key={p.id} className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2">
            <Avatar name={p.name} imageUrl={p.image} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">
                {p.id === currentUserId ? `${p.name} (you)` : p.name}
              </p>
              {p.role === 'ADMIN' && <p className="text-[11px] text-text-muted">Admin</p>}
            </div>
            {isAdmin && p.id !== currentUserId && (
              <button
                type="button"
                onClick={() => onRemoveMember(p.id)}
                className="hidden rounded-full p-1 text-text-muted hover:bg-surface-3 hover:text-red-500 group-hover:block"
                aria-label={`Remove ${p.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-0.5 border-t border-border-subtle px-3 py-3">
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={onAddMembers}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <UserPlus className="h-4 w-4 text-text-muted" />
              Add members
            </button>
            <button
              type="button"
              onClick={onRename}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <Pencil className="h-4 w-4 text-text-muted" />
              Rename {isChannel ? 'channel' : 'group'}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="h-4 w-4" />
          Leave {isChannel ? 'channel' : 'group'}
        </button>
      </div>
    </div>
  );
}

export default function ProfilePanel(props: ProfilePanelProps) {
  const { conversation } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-5">
        <p className="text-sm font-semibold text-text-primary">
          {conversation.type === 'DM' ? 'Profile' : 'Details'}
        </p>
      </div>
      {conversation.type === 'DM'
        ? <DmProfile conversation={conversation} currentUserId={props.currentUserId} />
        : <GroupDetails {...props} />}
    </div>
  );
}
