'use client';

import { useState, useEffect, useCallback } from 'react';
import StatCard from '@/components/analytics/StatCard';
import LineChart from '@/components/analytics/LineChart';
import BarChart from '@/components/analytics/BarChart';

interface AnalyticsData {
  stats: {
    totalMembers: number;
    newMembers: number;
    totalNodes: number;
    newNodes: number;
    totalLinks: number;
    newLinks: number;
  };
  nodeTypes: { type: string; count: number }[];
  memberGrowth: { label: string; count: number; cumulative: number }[];
  nodeGrowth: { label: string; count: number; cumulative: number }[];
  activityGrowth: { label: string; count: number; cumulative: number }[];
  topContributors: { email: string; name: string; actions: number }[];
  recentActivity: {
    action: string;
    actorName: string;
    targetName: string | null;
    createdAt: string;
  }[];
}

const PERIODS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '12M', days: 365 },
] as const;

function formatAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Keyed by lowercase-canonical node type (see app/api/data/nodes write guard).
const NODE_TYPE_COLORS: Record<string, string> = {
  person: '#6366f1',
  organization: '#0ea5e9',
  event: '#f59e0b',
  group: '#10b981',
  startup: '#8b5cf6',
  investor: '#ec4899',
};

function getTypeColor(type: string): string {
  return NODE_TYPE_COLORS[type.toLowerCase()] ?? '#94a3b8';
}

export default function AnalyticsPanel({ communityId }: { communityId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/${communityId}?days=${days}`);
      if (!res.ok) throw new Error('Failed');
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [communityId, days]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = PERIODS.find(p => p.days === days)?.label ?? '30D';

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex justify-end">
        <div className="flex gap-1 bg-surface-2 border border-border-subtle rounded-xl p-1">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                days === p.days
                  ? 'bg-surface-1 text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-2 border border-border-subtle rounded-2xl p-5 h-28 animate-pulse"
            />
          ))}
        </div>
      ) : !data ? (
        <div className="text-text-muted text-center py-20">
          Failed to load analytics data.
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard
              label="Total Members"
              value={data.stats.totalMembers}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              accent="#6366f1"
            />
            <StatCard
              label="New Members"
              value={data.stats.newMembers}
              deltaLabel={periodLabel}
              delta={data.stats.newMembers}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              }
              accent="#8b5cf6"
            />
            <StatCard
              label="Total Nodes"
              value={data.stats.totalNodes}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              }
              accent="#0ea5e9"
            />
            <StatCard
              label="New Nodes"
              value={data.stats.newNodes}
              deltaLabel={periodLabel}
              delta={data.stats.newNodes}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                </svg>
              }
              accent="#10b981"
            />
            <StatCard
              label="Total Links"
              value={data.stats.totalLinks}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              }
              accent="#f59e0b"
            />
            <StatCard
              label="New Links"
              value={data.stats.newLinks}
              deltaLabel={periodLabel}
              delta={data.stats.newLinks}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              }
              accent="#ec4899"
            />
          </div>

          {/* Growth Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 bg-surface-2 border border-border-subtle rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Member Growth</h2>
                  <p className="text-xs text-text-muted mt-0.5">Cumulative members over 12 weeks</p>
                </div>
                <span className="text-2xl font-bold text-text-primary tabular-nums">
                  {data.stats.totalMembers.toLocaleString()}
                </span>
              </div>
              <LineChart data={data.memberGrowth} color="#6366f1" mode="cumulative" />
            </div>

            <div className="lg:col-span-2 bg-surface-2 border border-border-subtle rounded-2xl p-6">
              <div className="mb-5">
                <h2 className="text-sm font-semibold text-text-primary">Node Types</h2>
                <p className="text-xs text-text-muted mt-0.5">Distribution across {data.stats.totalNodes} nodes</p>
              </div>
              {data.nodeTypes.length > 0 ? (
                <div className="space-y-3 pt-1">
                  {data.nodeTypes.map(nt => (
                    <div key={nt.type} className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTypeColor(nt.type) }} />
                      <span className="text-sm text-text-secondary flex-1 truncate">{nt.type}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(nt.count / data.stats.totalNodes) * 100}%`, backgroundColor: getTypeColor(nt.type) }}
                          />
                        </div>
                        <span className="text-xs font-medium text-text-muted w-8 text-right tabular-nums">{nt.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">No nodes yet.</p>
              )}
            </div>
          </div>

          {/* Activity + Contributors */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 bg-surface-2 border border-border-subtle rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Network Growth</h2>
                  <p className="text-xs text-text-muted mt-0.5">Nodes added per week</p>
                </div>
              </div>
              <BarChart
                data={data.nodeGrowth.map(d => ({ label: d.label, count: d.count }))}
                color="#0ea5e9"
                height={160}
              />
            </div>

            <div className="lg:col-span-2 bg-surface-2 border border-border-subtle rounded-2xl p-6">
              <div className="mb-5">
                <h2 className="text-sm font-semibold text-text-primary">Top Contributors</h2>
                <p className="text-xs text-text-muted mt-0.5">Most active in the last {periodLabel}</p>
              </div>
              {data.topContributors.length > 0 ? (
                <ol className="space-y-3">
                  {data.topContributors.map((c, i) => (
                    <li key={c.email} className="flex items-center gap-3">
                      <span className={`text-xs font-bold tabular-nums w-5 text-right flex-shrink-0 ${
                        i === 0 ? 'text-amber-500' : i === 1 ? 'text-zinc-400' : i === 2 ? 'text-amber-700/70' : 'text-text-muted'
                      }`}>
                        {i + 1}
                      </span>
                      <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-text-secondary">
                        {(c.name?.[0] ?? '?').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{c.name}</p>
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-text-muted flex-shrink-0">{c.actions}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-text-muted">No activity logged yet.</p>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          {data.recentActivity.length > 0 && (
            <div className="bg-surface-2 border border-border-subtle rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Recent Activity</h2>
              <div className="divide-y divide-border-subtle">
                {data.recentActivity.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-semibold text-text-muted">
                        {(item.actorName?.[0] ?? '?').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary">{item.actorName}</span>
                        {' · '}
                        <span className="text-text-muted">{formatAction(item.action)}</span>
                        {item.targetName && (
                          <> <span className="font-medium text-text-secondary">{item.targetName}</span></>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-text-muted flex-shrink-0 mt-0.5 tabular-nums">
                      {timeAgo(item.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
