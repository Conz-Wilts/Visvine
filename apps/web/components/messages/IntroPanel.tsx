'use client';

/**
 * Introductions, living inside Messages. Two pieces:
 *
 *  - IntroRequestCard — one intro in the centered Intros list, with the
 *    request message and Accept / Decline actions for the double opt-in
 *    (introducer endorses → target accepts).
 *  - IntroBanner    — slim provenance banner shown at the top of a DM that was
 *    created by an accepted introduction.
 *
 * The viewer's role decides what they can see and do:
 *   introducer → sees both notes, can endorse/decline while pending
 *   requester  → sees their own notes + endorsement, read-only
 *   target     → sees endorsement + the requester's note, can accept/decline
 */

import React, { useState } from 'react';
import {
  ChevronDown, Clock, Loader2,
  MessageCircle, Sparkles, UserCheck, XCircle,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import type {
  ConversationIntroContext, IntroInbox, IntroNodeSummary, IntroRequestDTO, IntroStatus,
} from '@/lib/intros/types';

type IntroRole = 'introducer' | 'requester' | 'target';
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
function introCounterpart({ intro, role }: IntroItem): IntroNodeSummary | null {
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

// ─── Centered request card ────────────────────────────────────────────────────

/** Which note to surface under the request, for the viewer's role. */
function introMessageFor({ intro, role }: IntroItem): { label: string; text: string } | null {
  if (role === 'introducer') {
    return intro.messageToIntroducer
      ? { label: `Why ${firstName(intro.requesterNode?.name)} is asking you`, text: intro.messageToIntroducer }
      : null;
  }
  if (role === 'target') {
    return intro.messageToTarget
      ? { label: `Message from ${firstName(intro.requesterNode?.name)}`, text: intro.messageToTarget }
      : null;
  }
  return intro.messageToTarget ? { label: 'Your message', text: intro.messageToTarget } : null;
}

/**
 * One intro in the centered Intros list: who ↔ who, the request message
 * underneath, and Accept / Decline on the right while the viewer can act.
 * Accepting as the target drops you into the new DM (handled by onAction);
 * declining notifies the other parties that you politely declined.
 */
export function IntroRequestCard({ item, onAction, onOpenConversation }: {
  item: IntroItem;
  onAction: (id: string, action: IntroAction) => Promise<unknown>;
  onOpenConversation?: (nodeId: string) => void;
}) {
  const { intro, role } = item;
  const actionable = isIntroActionable(item);
  const counterpart = introCounterpart(item);
  const [busy, setBusy] = useState<IntroAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const message = introMessageFor(item);
  const acceptAction: IntroAction = role === 'introducer' ? 'approve' : 'accept';

  const run = async (action: IntroAction) => {
    if (busy) return;
    if (action === 'decline' && !window.confirm('Politely decline this introduction? The others will be notified.')) return;
    setBusy(action);
    setError(null);
    try {
      await onAction(intro.id, action);
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-3xl border border-border-subtle/70 bg-surface-1 p-5 shadow-[0_2px_12px_rgba(16,24,40,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <IntroAvatarPair intro={intro} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-text-primary">{introTitle(item)}</p>
              <StatusPill intro={intro} />
              <span className="text-[11px] text-text-muted">{timeAgo(intro.updatedAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">{introSubtitle(item)}</p>
            {role === 'target' && intro.endorsement && (
              <p className="mt-1 text-xs italic text-text-secondary">
                “{intro.endorsement}” — {firstName(intro.introducerNode?.name)}
              </p>
            )}
          </div>
        </div>

        {/* Actions on the right */}
        {actionable && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void run('decline')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {busy === 'decline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              Decline
            </button>
            <button
              type="button"
              onClick={() => void run(acceptAction)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === acceptAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
              {role === 'target' ? 'Accept intro' : 'Accept'}
            </button>
          </div>
        )}

        {/* Connected → jump straight into the chat */}
        {!actionable && intro.status === 'connected' && counterpart && onOpenConversation && (
          <button
            type="button"
            onClick={() => onOpenConversation(counterpart.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand-green/40 px-4 py-2 text-xs font-semibold text-brand-dark-green transition-colors hover:bg-brand-green/10"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Open chat
          </button>
        )}
      </div>

      {/* The request message under the header */}
      {message && (
        <div className="mt-3.5 rounded-2xl bg-surface-2/70 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{message.label}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-secondary">{message.text}</p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
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
        <div className="rounded-2xl bg-brand-green/10 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
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
