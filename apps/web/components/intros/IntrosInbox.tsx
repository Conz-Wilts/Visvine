'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, Clock, CheckCircle2, XCircle, Sparkles, ChevronRight,
  Inbox, Send, Users,
} from 'lucide-react';
import { getInitials } from '@/lib/avatarUtils';
import type { IntroInbox, IntroNodeSummary, IntroRequestDTO } from '@/lib/intros/types';

type Tab = 'incoming' | 'sent' | 'received';
type Action = 'approve' | 'decline' | 'accept';

const STATUS_CONFIG: Record<IntroRequestDTO['status'], { label: string; icon: React.ElementType; classes: string }> = {
  pending: { label: 'Pending', icon: Clock, classes: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', icon: CheckCircle2, classes: 'bg-brand-light-bg text-brand-dark-green' },
  connected: { label: 'Connected', icon: Sparkles, classes: 'bg-brand-light-bg text-brand-dark-green' },
  declined: { label: 'Declined', icon: XCircle, classes: 'bg-red-100 text-red-600' },
};

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function Chip({ node }: { node: IntroNodeSummary | null }) {
  if (!node) return <span className="text-text-muted">Unknown</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
      {node.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={node.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
      ) : (
        <span className="w-5 h-5 rounded-full bg-brand-light-bg text-brand-dark-green text-[9px] font-bold flex items-center justify-center flex-shrink-0">
          {getInitials(node.name)}
        </span>
      )}
      {node.name}
    </span>
  );
}

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div className="bg-surface-2 rounded-xl p-3">
      <p className="text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">{label}</p>
      <p className="text-[13px] text-text-secondary whitespace-pre-line leading-relaxed">{text}</p>
    </div>
  );
}

function IntroCard({
  intro,
  tab,
  onAction,
}: {
  intro: IntroRequestDTO;
  tab: Tab;
  onAction: (id: string, action: Action, endorsement?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(
    (tab === 'incoming' && intro.status === 'pending') || (tab === 'received' && intro.status === 'approved'),
  );
  const [endorsement, setEndorsement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: Action) {
    setBusy(true);
    setError(null);
    try {
      await onAction(intro.id, action, action === 'approve' ? endorsement : undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const canApprove = tab === 'incoming' && intro.status === 'pending';
  const canAccept = tab === 'received' && intro.status === 'approved';

  return (
    <div className="border border-border-subtle rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2 transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap text-[13px] mb-1.5">
            <Chip node={intro.requesterNode} />
            <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <Chip node={intro.introducerNode} />
            <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <Chip node={intro.targetNode} />
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <StatusBadge status={intro.status} declinedBy={intro.declinedBy} />
            <span className="text-[11px] text-text-muted">{timeAgo(intro.createdAt)}</span>
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-text-muted flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Incoming — introducer sees both messages */}
          {tab === 'incoming' && (
            <>
              <Quote label="Their note to you" text={intro.messageToIntroducer} />
              <Quote label={`Message to forward to ${intro.targetNode?.name ?? 'them'}`} text={intro.messageToTarget} />
            </>
          )}

          {/* Sent — requester sees their own messages + any endorsement */}
          {tab === 'sent' && (
            <>
              <Quote label={`Your note to ${intro.introducerNode?.name ?? 'introducer'}`} text={intro.messageToIntroducer} />
              <Quote label={`Your message to ${intro.targetNode?.name ?? 'target'}`} text={intro.messageToTarget} />
              {intro.endorsement && <Quote label={`${intro.introducerNode?.name ?? 'Introducer'}'s endorsement`} text={intro.endorsement} />}
            </>
          )}

          {/* Received — target sees the endorsement + the requester's message */}
          {tab === 'received' && (
            <>
              {intro.endorsement && <Quote label={`${intro.introducerNode?.name ?? 'A mutual'} says`} text={intro.endorsement} />}
              <Quote label={`Message from ${intro.requesterNode?.name ?? 'them'}`} text={intro.messageToTarget} />
            </>
          )}

          {/* Approve flow (introducer) */}
          {canApprove && (
            <div className="space-y-2">
              <textarea
                value={endorsement}
                onChange={(e) => setEndorsement(e.target.value.slice(0, 600))}
                rows={3}
                placeholder={`Add a quick endorsement — e.g. "${intro.requesterNode?.name?.split(' ')[0] ?? 'They'} is great, you two should talk."`}
                className="w-full px-3 py-2 text-[13px] rounded-xl border border-border-default bg-surface-1 text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green"
              />
              <div className="flex items-center gap-2">
                <button
                  disabled={busy || !endorsement.trim()}
                  onClick={() => act('approve')}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl bg-brand-green text-brand-black hover:bg-[#6bc963] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Approve & introduce
                </button>
                <button
                  disabled={busy}
                  onClick={() => act('decline')}
                  className="px-3.5 py-2 text-[13px] font-medium rounded-xl border border-border-default text-text-secondary hover:bg-surface-2 disabled:opacity-50 transition"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Accept flow (target) */}
          {canAccept && (
            <div className="flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() => act('accept')}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl bg-brand-green text-brand-black hover:bg-[#6bc963] disabled:opacity-50 transition"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Accept intro
              </button>
              <button
                disabled={busy}
                onClick={() => act('decline')}
                className="px-3.5 py-2 text-[13px] font-medium rounded-xl border border-border-default text-text-secondary hover:bg-surface-2 disabled:opacity-50 transition"
              >
                Decline
              </button>
            </div>
          )}

          {intro.status === 'connected' && (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-brand-dark-green">
              <Sparkles className="w-4 h-4" /> You&apos;re connected.
            </p>
          )}

          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, declinedBy }: { status: IntroRequestDTO['status']; declinedBy: IntroRequestDTO['declinedBy'] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const label = status === 'declined' && declinedBy ? `Declined by ${declinedBy}` : cfg.label;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.classes}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

const EMPTY_COPY: Record<Tab, string> = {
  incoming: "When someone asks you to introduce them to a mutual connection, it'll show up here.",
  sent: "Open a profile and use Connect → Request an introduction to start one.",
  received: 'Introductions made to you will appear here to accept or decline.',
};

export default function IntrosInbox({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<IntroInbox>({ incoming: [], sent: [], received: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('incoming');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/intros');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = useCallback(async (id: string, action: Action, endorsement?: string) => {
    const res = await fetch(`/api/intros/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, endorsement }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? 'Action failed');
    }
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const tabs: { key: Tab; label: string; icon: React.ElementType; items: IntroRequestDTO[] }[] = [
    { key: 'incoming', label: 'Incoming', icon: Inbox, items: data.incoming },
    { key: 'sent', label: 'Sent', icon: Send, items: data.sent },
    { key: 'received', label: 'Received', icon: Users, items: data.received },
  ];
  const active = tabs.find((t) => t.key === tab)!;

  return (
    <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] max-h-[72vh] bg-surface-1 border border-border-subtle rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
        <h2 className="text-sm font-bold text-text-primary font-ginto">Introductions</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 transition" aria-label="Close">
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border-subtle flex-shrink-0">
        {tabs.map(({ key, label, icon: Icon, items }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg transition ${
              tab === key ? 'bg-brand-green text-brand-black' : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {items.length > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-black/10 text-brand-black' : 'bg-surface-3 text-text-muted'}`}>
                {items.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-brand-dark-green" />
          </div>
        ) : active.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-4">
            <div className="text-3xl">✉️</div>
            <p className="text-[13px] text-text-muted max-w-[260px]">{EMPTY_COPY[tab]}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {active.items.map((intro) => (
              <IntroCard key={intro.id} intro={intro} tab={tab} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
