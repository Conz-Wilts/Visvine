'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useSession } from '@/lib/auth-client';
import { Loader2, CheckCircle2, XCircle, Clock, ChevronRight, Inbox, Send, Users, Sparkles } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NodeSummary {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
}

interface IntroRequest {
  id: string;
  communityId: string;
  requesterNodeId: string;
  targetNodeId: string;
  introducerNodeId: string;
  pathNodeIds: string[];
  pathScore: number;
  messageToTarget: string;
  messageToIntroducer: string;
  endorsement: string | null;
  status: 'pending' | 'approved' | 'declined' | 'delivered';
  createdAt: string;
  updatedAt: string;
  requesterNode: NodeSummary | null;
  targetNode: NodeSummary | null;
  introducerNode: NodeSummary | null;
}

type InboxTab = 'incoming' | 'sent' | 'received';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  approved: { label: 'Approved', icon: CheckCircle2, classes: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' },
  declined: { label: 'Declined', icon: XCircle, classes: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
  delivered: { label: 'Delivered', icon: Sparkles, classes: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' },
} as const;

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function NodeChip({ node }: { node: NodeSummary | null }) {
  if (!node) return <span className="text-zinc-400">Unknown</span>;
  const initials = node.name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
      <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
        {initials}
      </span>
      {node.name}
    </span>
  );
}

function StatusBadge({ status }: { status: IntroRequest['status'] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Approval panel ──────────────────────────────────────────────────────────

function ApprovalPanel({
  intro,
  onAction,
}: {
  intro: IntroRequest;
  onAction: (id: string, action: 'approve' | 'decline' | 'endorse', endorsement?: string) => Promise<void>;
}) {
  const [endorsement, setEndorsement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'decline' | 'endorse') {
    setBusy(true);
    setError(null);
    try {
      await onAction(intro.id, action, action === 'endorse' ? endorsement : undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
      {/* Messages */}
      <div className="space-y-3">
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
            Their message to you
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
            {intro.messageToIntroducer}
          </p>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
            Message to forward to {intro.targetNode?.name ?? 'target'}
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
            {intro.messageToTarget}
          </p>
        </div>
      </div>

      {/* Actions */}
      {intro.status === 'pending' && (
        <div className="flex items-center gap-3">
          <button
            disabled={busy}
            onClick={() => act('approve')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve & write endorsement
          </button>
          <button
            disabled={busy}
            onClick={() => act('decline')}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            Decline
          </button>
        </div>
      )}

      {intro.status === 'approved' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            You approved this — write your endorsement to deliver the intro
          </div>
          <textarea
            value={endorsement}
            onChange={e => setEndorsement(e.target.value)}
            rows={4}
            placeholder={`${intro.targetNode?.name?.split(' ')[0] ?? 'Hi'} — I'd like to introduce you to ${intro.requesterNode?.name ?? 'someone'}. They're…`}
            className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button
            disabled={busy || !endorsement.trim()}
            onClick={() => act('endorse')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Sparkles className="w-3.5 h-3.5" />
            Send intro with endorsement
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// ─── IntroCard ────────────────────────────────────────────────────────────────

function IntroCard({
  intro,
  perspective,
  onAction,
}: {
  intro: IntroRequest;
  perspective: InboxTab;
  onAction: (id: string, action: 'approve' | 'decline' | 'endorse', endorsement?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(intro.status === 'pending');

  const showApprovalPanel =
    perspective === 'incoming' && (intro.status === 'pending' || intro.status === 'approved');

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        {/* Path summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <NodeChip node={intro.requesterNode} />
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <NodeChip node={intro.introducerNode} />
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <NodeChip node={intro.targetNode} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={intro.status} />
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{timeAgo(intro.createdAt)}</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Score {Math.round(intro.pathScore * 100)}%
            </span>
          </div>
        </div>
        <div className={`transition-transform flex-shrink-0 mt-1 ${expanded ? 'rotate-90' : ''}`}>
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          {/* Show intro messages for delivered / received */}
          {(perspective === 'received' || intro.status === 'delivered') && (
            <div className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-4">
              {intro.endorsement && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-4">
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">
                    Endorsement from {intro.introducerNode?.name}
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line italic leading-relaxed">
                    "{intro.endorsement}"
                  </p>
                </div>
              )}
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Message from {intro.requesterNode?.name}
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                  {intro.messageToTarget}
                </p>
              </div>
            </div>
          )}

          {/* Sent perspective: show both messages */}
          {perspective === 'sent' && (
            <div className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-4">
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Your message to {intro.introducerNode?.name}
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                  {intro.messageToIntroducer}
                </p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Your message to {intro.targetNode?.name}
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                  {intro.messageToTarget}
                </p>
              </div>
              {intro.endorsement && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-4">
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">
                    Endorsement from {intro.introducerNode?.name}
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line italic leading-relaxed">
                    "{intro.endorsement}"
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Incoming: full approval flow */}
          {showApprovalPanel && (
            <ApprovalPanel intro={intro} onAction={onAction} />
          )}

          {/* Incoming declined: just show messages */}
          {perspective === 'incoming' && intro.status === 'declined' && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 space-y-3">
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Message they sent you
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                  {intro.messageToIntroducer}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const DEMO_COMMUNITY_ID = 'intro-demo';
const DEMO_NODE_ID = 'person:alex-chen';
const DEMO_NODE_NAME = 'Alex Chen';

export default function IntrosPage() {
  const { currentCommunity } = useCommunity();
  const { data: session } = useSession();

  const [requests, setRequests] = useState<IntroRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<InboxTab>('incoming');

  // Use session node or fallback to demo node
  const nodeId = session?.user?.nodeId ?? DEMO_NODE_ID;
  const nodeName = session?.user?.name ?? DEMO_NODE_NAME;
  const communityId = currentCommunity?.id ?? DEMO_COMMUNITY_ID;
  const isDemo = !session?.user?.nodeId;

  // Seed state
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/intros?communityId=${encodeURIComponent(communityId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      const data = await res.json();
      setRequests(data.requests ?? []);
    } finally {
      setLoading(false);
    }
  }, [communityId, nodeId]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(
    id: string,
    action: 'approve' | 'decline' | 'endorse',
    endorsement?: string
  ) {
    const res = await fetch(`/api/intros/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, endorsement }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? 'Failed');
    }
    await load();
  }

  async function handleSeed() {
    setSeeding(true);
    await fetch('/api/intros/seed', { method: 'POST' });
    setSeeding(false);
    setSeedDone(true);
    await load();
  }

  const incoming = requests.filter(r => r.introducerNodeId === nodeId);
  const sent = requests.filter(r => r.requesterNodeId === nodeId);
  const received = requests.filter(r => r.targetNodeId === nodeId && r.status === 'delivered');

  const tabData: Record<InboxTab, { label: string; icon: React.ElementType; items: IntroRequest[] }> = {
    incoming: { label: 'Incoming', icon: Inbox, items: incoming },
    sent: { label: 'Sent', icon: Send, items: sent },
    received: { label: 'Received', icon: Users, items: received },
  };

  return (
    <div className="p-6 md:p-8 min-h-screen bg-zinc-50 dark:bg-zinc-950 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Intro Requests</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Browsing as <span className="font-medium text-zinc-700 dark:text-zinc-300">{nodeName}</span>
            {isDemo && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
                DEMO MODE
              </span>
            )}
          </p>
        </div>
        {isDemo && !seedDone && (
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors self-start"
          >
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Seed demo data
          </button>
        )}
      </div>

      {isDemo && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-2xl p-4 text-sm text-amber-700 dark:text-amber-400">
          <strong>Demo mode</strong> — you're browsing as Alex Chen in the <em>Intro Demo Network</em> community.
          Click "Seed demo data" to populate 9 people, 11 connections, and 2 pre-existing intro requests.
          To use real data, sign in and link your account to a node.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded-xl p-1 self-start w-fit">
        {(Object.entries(tabData) as [InboxTab, typeof tabData[InboxTab]][]).map(([key, val]) => {
          const Icon = val.icon;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === key
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {val.label}
              {val.items.length > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  tab === key
                    ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}>
                  {val.items.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      ) : tabData[tab].items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="text-4xl">✉️</div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            No {tab} intro requests yet
          </p>
          {tab === 'incoming' && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs">
              When someone asks you to intro them to a mutual connection, it'll appear here for you to approve or decline.
            </p>
          )}
          {tab === 'sent' && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs">
              Visit someone's profile and click the message dropdown → "Request Intro" to start a request.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {tabData[tab].items.map(req => (
            <IntroCard
              key={req.id}
              intro={req}
              perspective={tab}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
