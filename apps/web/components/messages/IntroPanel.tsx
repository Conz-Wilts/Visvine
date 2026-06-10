'use client';

/**
 * Introductions, living inside Messages. Three pieces:
 *
 *  - IntroListItem  — a sidebar row (rendered under the "Intros" tab) styled to
 *    sit alongside conversation rows.
 *  - IntroThread    — the main-pane view for a selected introduction: connection
 *    path hero, event timeline, and a composer-like action bar for the double
 *    opt-in (introducer endorses → target accepts).
 *  - IntroBanner    — slim provenance banner shown at the top of a DM that was
 *    created by an accepted introduction.
 *
 * The viewer's role decides what they can see and do:
 *   introducer → sees both notes, can endorse/decline while pending
 *   requester  → sees their own notes + endorsement, read-only
 *   target     → sees endorsement + the requester's note, can accept/decline
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowRight, ChevronDown, Clock, Loader2,
  MessageCircle, Sparkles, UserCheck, XCircle,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import type {
  ConversationIntroContext, IntroInbox, IntroNodeSummary, IntroRequestDTO, IntroStatus,
} from '@/lib/intros/types';

export type IntroRole = 'introducer' | 'requester' | 'target';
export type IntroAction = 'approve' | 'decline' | 'accept';

export interface IntroItem {
  intro: IntroRequestDTO;
  role: IntroRole;
}

// ─── Derivations ──────────────────────────────────────────────────────────────

/** Merge the role-split inbox into one feed, newest activity first. */
export function flattenIntroInbox(inbox: IntroInbox): IntroItem[] {
  const items: IntroItem[] = [
    ...inbox.incoming.map((intro) => ({ intro, role: 'introducer' as const })),
    ...inbox.sent.map((intro) => ({ intro, role: 'requester' as const })),
    ...inbox.received.map((intro) => ({ intro, role: 'target' as const })),
  ];
  const seen = new Set<string>();
  return items
    .filter(({ intro }) => (seen.has(intro.id) ? false : (seen.add(intro.id), true)))
    .sort((a, b) => Number(new Date(b.intro.updatedAt)) - Number(new Date(a.intro.updatedAt)));
}

/** Does this intro need something from the viewer right now? */
export function isIntroActionable({ intro, role }: IntroItem): boolean {
  return (role === 'introducer' && intro.status === 'pending')
    || (role === 'target' && intro.status === 'approved');
}

/** The person the viewer would end up talking to (null for the introducer). */
export function introCounterpart({ intro, role }: IntroItem): IntroNodeSummary | null {
  if (role === 'requester') return intro.targetNode;
  if (role === 'target') return intro.requesterNode;
  return null;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function firstName(name?: string | null) {
  return (name ?? '').split(' ')[0] || 'them';
}

const STATUS_CONFIG: Record<IntroStatus, { label: string; icon: React.ElementType; classes: string }> = {
  pending: { label: 'Pending', icon: Clock, classes: 'bg-amber-500/10 text-amber-600' },
  approved: { label: 'Endorsed', icon: UserCheck, classes: 'bg-sky-500/10 text-sky-600' },
  connected: { label: 'Connected', icon: Sparkles, classes: 'bg-brand-green/15 text-brand-dark-green' },
  declined: { label: 'Declined', icon: XCircle, classes: 'bg-red-500/10 text-red-500' },
};

function StatusPill({ intro }: { intro: IntroRequestDTO }) {
  const cfg = STATUS_CONFIG[intro.status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.classes}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

/** One-line, role-aware description of where the intro is at. */
function introSubtitle({ intro, role }: IntroItem): string {
  const introducer = firstName(intro.introducerNode?.name);
  const requester = firstName(intro.requesterNode?.name);
  const target = firstName(intro.targetNode?.name);
  if (intro.status === 'declined') {
    return intro.declinedBy === 'target' ? `${target} declined` : `${introducer} declined`;
  }
  if (intro.status === 'connected') return 'You’re connected — say hello';
  if (role === 'introducer') {
    return intro.status === 'pending'
      ? `Wants you to introduce them to ${target}`
      : `You endorsed — waiting on ${target}`;
  }
  if (role === 'requester') {
    return intro.status === 'pending'
      ? `Waiting on ${introducer} to endorse`
      : `${introducer} endorsed — waiting on ${target}`;
  }
  return `${introducer} vouched for ${requester}`;
}

function introTitle({ intro, role }: IntroItem): string {
  if (role === 'introducer') {
    return `${firstName(intro.requesterNode?.name)} → ${intro.targetNode?.name ?? 'someone'}`;
  }
  if (role === 'requester') return intro.targetNode?.name ?? 'Introduction';
  return intro.requesterNode?.name ?? 'Introduction';
}

/** The avatar pair shown for an intro: the two people being connected. */
function IntroAvatarPair({ intro, size = 'md' }: { intro: IntroRequestDTO; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-11 w-11' : 'h-10 w-10';
  return (
    <div className={`relative shrink-0 ${dims}`}>
      <Avatar
        name={intro.requesterNode?.name ?? '?'}
        imageUrl={intro.requesterNode?.imageUrl}
        size={size === 'lg' ? 'md' : 'sm'}
        className="absolute left-0 top-0 ring-2 ring-surface-1"
      />
      <Avatar
        name={intro.targetNode?.name ?? '?'}
        imageUrl={intro.targetNode?.imageUrl}
        size={size === 'lg' ? 'md' : 'sm'}
        className="absolute bottom-0 right-0 ring-2 ring-surface-1"
      />
    </div>
  );
}

// ─── Sidebar row ──────────────────────────────────────────────────────────────

export function IntroListItem({ item, isActive, onSelect }: {
  item: IntroItem;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { intro } = item;
  const actionable = isIntroActionable(item);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-150 ${
        isActive ? 'bg-brand-green/10 ring-1 ring-brand-green/20' : 'hover:bg-surface-2'
      }`}
    >
      <div className="relative shrink-0">
        <IntroAvatarPair intro={intro} />
        {actionable && !isActive && (
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface-1 bg-brand-green" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`truncate text-sm ${isActive || actionable ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary'}`}>
            {introTitle(item)}
          </p>
          <span className="shrink-0 text-[11px] text-text-muted">{timeAgo(intro.updatedAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`truncate text-xs ${actionable && !isActive ? 'font-medium text-text-secondary' : 'text-text-muted'}`}>
            {introSubtitle(item)}
          </p>
          <span className="shrink-0"><StatusPill intro={intro} /></span>
        </div>
      </div>
    </button>
  );
}

// ─── Thread view ──────────────────────────────────────────────────────────────

function PathPerson({ node, label, emphasize }: {
  node: IntroNodeSummary | null;
  label: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 text-left sm:flex-col sm:items-center sm:gap-1.5 sm:text-center">
      <div className={`shrink-0 ${emphasize ? 'rounded-full p-0.5 ring-2 ring-brand-green/60' : ''}`}>
        <Avatar name={node?.name ?? '?'} imageUrl={node?.imageUrl} size="xl" />
      </div>
      <div className="min-w-0 w-full">
        <p className="truncate text-sm font-semibold text-text-primary">{node?.name ?? 'Unknown'}</p>
        <p className="truncate text-[11px] text-text-muted">{label}</p>
      </div>
    </div>
  );
}

function PathConnector({ done }: { done: boolean }) {
  return (
    <div className="hidden flex-1 items-center gap-1 self-start px-1 sm:mt-5 sm:flex">
      <div className={`h-px flex-1 ${done ? 'bg-brand-green' : 'border-t border-dashed border-border-default'}`} />
      <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${done ? 'text-brand-green' : 'text-text-muted'}`} />
    </div>
  );
}

function QuoteCard({ author, label, text }: {
  author: IntroNodeSummary | null;
  label: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-1 p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Avatar name={author?.name ?? '?'} imageUrl={author?.imageUrl} size="xs" />
        <p className="text-xs font-semibold text-text-primary">{author?.name ?? 'Unknown'}</p>
        <p className="text-[11px] text-text-muted">{label}</p>
      </div>
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-text-secondary">{text}</p>
    </div>
  );
}

function TimelineStep({ icon: Icon, tone, title, time, isLast, children }: {
  icon: React.ElementType;
  tone: 'done' | 'active' | 'idle' | 'declined';
  title: string;
  time?: string;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  const circle = {
    done: 'bg-brand-green/15 text-brand-dark-green',
    active: 'bg-amber-500/15 text-amber-600',
    idle: 'bg-surface-3 text-text-muted',
    declined: 'bg-red-500/10 text-red-500',
  }[tone];
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${circle}`}>
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="my-1 w-px flex-1 bg-border-subtle" />}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-5'}`}>
        <div className="flex h-8 items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          {time && <span className="text-[11px] text-text-muted">{time}</span>}
        </div>
        {children && <div className="mt-1.5 space-y-2.5">{children}</div>}
      </div>
    </div>
  );
}

export function IntroThread({ item, showBack, onBack, onAction, onOpenConversation }: {
  item: IntroItem;
  showBack: boolean;
  onBack: () => void;
  /** PATCH /api/intros/:id — resolves with the seeded DM id on accept. */
  onAction: (id: string, action: IntroAction, endorsement?: string) => Promise<{ conversationId?: string } | void>;
  /** Open (or create) the DM with a person node — used by the connected CTA. */
  onOpenConversation: (counterpartNodeId: string) => void;
}) {
  const { intro, role } = item;
  const [endorsement, setEndorsement] = useState('');
  const [busy, setBusy] = useState<IntroAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counterpart = introCounterpart(item);
  const canEndorse = role === 'introducer' && intro.status === 'pending';
  const canAccept = role === 'target' && intro.status === 'approved';

  const act = async (action: IntroAction) => {
    setBusy(action);
    setError(null);
    try {
      await onAction(intro.id, action, action === 'approve' ? endorsement : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const requester = intro.requesterNode;
  const introducer = intro.introducerNode;
  const target = intro.targetNode;
  const requesterFirst = firstName(requester?.name);
  const introducerFirst = firstName(introducer?.name);
  const targetFirst = firstName(target?.name);

  const declined = intro.status === 'declined';
  const connected = intro.status === 'connected';
  const endorsed = intro.status === 'approved' || connected;

  // Visibility per role (mirrors the API's authorization rules).
  const showNoteToIntroducer = role !== 'target';
  const showNoteToTarget = true;

  const heroLabels = useMemo(() => ({
    requester: role === 'requester' ? 'You — asking' : requester?.subtitle ?? 'Asking for the intro',
    introducer: role === 'introducer' ? 'You — the mutual' : introducer?.subtitle ?? 'The mutual',
    target: role === 'target' ? 'You' : target?.subtitle ?? 'Being introduced',
  }), [role, requester, introducer, target]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header — mirrors the conversation header */}
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {showBack && (
            <button type="button" onClick={onBack} className="mr-1 rounded-lg p-1.5 text-text-muted hover:bg-surface-3">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <IntroAvatarPair intro={intro} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">Introduction</p>
            <p className="truncate text-xs text-text-muted">
              {requesterFirst} → {introducerFirst} → {targetFirst}
            </p>
          </div>
        </div>
        <StatusPill intro={intro} />
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">

          {/* Connection-path hero */}
          <div className="rounded-3xl border border-border-subtle bg-gradient-to-br from-brand-green/10 via-surface-1 to-surface-2 p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
              <PathPerson node={requester} label={heroLabels.requester} />
              <PathConnector done />
              <PathPerson node={introducer} label={heroLabels.introducer} emphasize />
              <PathConnector done={endorsed} />
              <PathPerson node={target} label={heroLabels.target} />
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-7">
            <TimelineStep
              icon={MessageCircle}
              tone="done"
              title={role === 'requester' ? 'You asked for an introduction' : `${requesterFirst} asked for an introduction`}
              time={timeAgo(intro.createdAt)}
            >
              {showNoteToIntroducer && (
                <QuoteCard
                  author={requester}
                  label={role === 'introducer' ? 'note to you' : `note to ${introducerFirst}`}
                  text={intro.messageToIntroducer}
                />
              )}
              {showNoteToTarget && (
                <QuoteCard
                  author={requester}
                  label={role === 'target' ? 'message for you' : `message for ${targetFirst}`}
                  text={intro.messageToTarget}
                />
              )}
            </TimelineStep>

            {/* Endorsement step */}
            {declined && intro.declinedBy === 'introducer' ? (
              <TimelineStep icon={XCircle} tone="declined" title={`${introducerFirst} declined to make the intro`} time={timeAgo(intro.updatedAt)} isLast />
            ) : (
              <TimelineStep
                icon={UserCheck}
                tone={endorsed ? 'done' : 'active'}
                title={endorsed
                  ? (role === 'introducer' ? 'You endorsed the intro' : `${introducerFirst} endorsed the intro`)
                  : (role === 'introducer' ? 'Your endorsement is up next' : `Waiting on ${introducerFirst} to endorse`)}
                time={endorsed ? timeAgo(intro.updatedAt) : undefined}
                isLast={!endorsed && !declined}
              >
                {intro.endorsement && role !== 'introducer' && (
                  <QuoteCard author={introducer} label="vouching" text={intro.endorsement} />
                )}
                {intro.endorsement && role === 'introducer' && (
                  <QuoteCard author={introducer} label="your endorsement" text={intro.endorsement} />
                )}
              </TimelineStep>
            )}

            {/* Connection step */}
            {endorsed && (
              declined ? (
                <TimelineStep icon={XCircle} tone="declined" title={`${targetFirst} declined the introduction`} time={timeAgo(intro.updatedAt)} isLast />
              ) : connected ? (
                <TimelineStep icon={Sparkles} tone="done" title="You're connected" time={timeAgo(intro.updatedAt)} isLast>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-green/30 bg-brand-green/10 p-3.5">
                    <p className="min-w-0 flex-1 text-[13px] text-text-secondary">
                      {role === 'introducer'
                        ? `${requesterFirst} and ${targetFirst} are now connected — nice work.`
                        : `A conversation with ${firstName(counterpart?.name)} is ready and seeded with the intro.`}
                    </p>
                    {counterpart && (
                      <button
                        type="button"
                        onClick={() => onOpenConversation(counterpart.id)}
                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-xs font-bold text-brand-black shadow-sm transition hover:opacity-90 active:scale-95"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Open conversation
                      </button>
                    )}
                  </div>
                </TimelineStep>
              ) : (
                <TimelineStep
                  icon={canAccept ? Sparkles : Clock}
                  tone={canAccept ? 'active' : 'idle'}
                  title={canAccept ? 'Your call — accept to connect' : `Waiting on ${targetFirst} to accept`}
                  isLast
                />
              )
            )}
          </div>
        </div>
      </div>

      {/* Action bar — sits where the composer would */}
      {(canEndorse || canAccept) && (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="mx-auto w-full max-w-2xl">
            {canEndorse && (
              <div className="rounded-2xl border border-border-default bg-surface-1 p-3 shadow-sm">
                <textarea
                  value={endorsement}
                  onChange={(e) => setEndorsement(e.target.value.slice(0, 600))}
                  rows={2}
                  placeholder={`Add a quick endorsement — e.g. "${requesterFirst} is great, you two should talk."`}
                  className="w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act('decline')}
                    className="rounded-full px-3.5 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-2 hover:text-text-secondary disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || !endorsement.trim()}
                    onClick={() => void act('approve')}
                    className="flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-xs font-bold text-brand-black shadow-sm transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                    Endorse & introduce
                  </button>
                </div>
              </div>
            )}

            {canAccept && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-default bg-surface-1 p-3 shadow-sm">
                <p className="min-w-0 flex-1 text-[13px] text-text-secondary">
                  Accepting connects you with <b className="text-text-primary">{requester?.name ?? 'them'}</b> and opens a conversation.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act('decline')}
                    className="rounded-full px-3.5 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-2 hover:text-text-secondary disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act('accept')}
                    className="flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-xs font-bold text-brand-black shadow-sm transition hover:opacity-90 active:scale-95 disabled:opacity-50"
                  >
                    {busy === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Accept introduction
                  </button>
                </div>
              </div>
            )}

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DM provenance banner ─────────────────────────────────────────────────────

export function IntroBanner({ context }: { context: ConversationIntroContext }) {
  const [expanded, setExpanded] = useState(false);
  const introducerName = context.introducer?.name ?? 'A mutual connection';
  const date = new Date(context.connectedAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <div className="px-4 pt-3">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-brand-green/25 bg-gradient-to-r from-brand-green/10 to-surface-1">
          <button
            type="button"
            onClick={() => context.endorsement && setExpanded((v) => !v)}
            className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left ${context.endorsement ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-brand-dark-green" />
            <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              <b className="font-semibold text-text-primary">{introducerName}</b> made this introduction · {date}
            </p>
            {context.endorsement && (
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
            )}
          </button>
          {expanded && context.endorsement && (
            <div className="px-4 pb-3">
              <div className="flex items-start gap-2.5 rounded-xl bg-surface-1/70 p-3">
                <Avatar name={introducerName} imageUrl={context.introducer?.imageUrl} size="xs" />
                <p className="min-w-0 flex-1 whitespace-pre-line text-[13px] italic leading-relaxed text-text-secondary">
                  “{context.endorsement}”
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
