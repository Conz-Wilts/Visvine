'use client';

import React from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';

interface NodeSummary {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
}

interface PathEdge {
  from: string;
  to: string;
  strength: number;
  interactions: number;
  since: string | null;
}

export interface EnrichedPath {
  path: string[];
  hops: number;
  score: number;
  introducerNodeId: string;
  scoreBreakdown: {
    hopScore: number;
    strengthScore: number;
    recencyScore: number;
  };
  edges: PathEdge[];
}

interface IntroPathCardProps {
  pathData: EnrichedPath;
  nodeMap: Record<string, NodeSummary>;
  selected: boolean;
  rank: number;
  onSelect: () => void;
  requesterLabel?: string;
}

function NodeAvatar({ node, size = 'sm' }: { node: NodeSummary | undefined; size?: 'sm' | 'md' }) {
  const initials = node
    ? node.name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';
  const dim = size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';

  if (node?.imageUrl) {
    return (
      <img
        src={node.imageUrl}
        alt={node.name}
        className={`${dim} rounded-full object-cover ring-2 ring-white dark:ring-zinc-900`}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold flex items-center justify-center ring-2 ring-white dark:ring-zinc-900`}>
      {initials}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-400' : 'bg-zinc-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-400 w-8">
        {pct}%
      </span>
    </div>
  );
}

function strengthLabel(s: number): string {
  if (s >= 0.85) return 'Very strong';
  if (s >= 0.70) return 'Strong';
  if (s >= 0.50) return 'Moderate';
  return 'Weak';
}

export default function IntroPathCard({
  pathData,
  nodeMap,
  selected,
  rank,
  onSelect,
  requesterLabel = 'You',
}: IntroPathCardProps) {
  const { path, hops, score, edges, scoreBreakdown } = pathData;
  const introducer = nodeMap[path[1]];
  const introducerEdge = edges[0];
  const isTopPath = rank === 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border-2 p-4 transition-all duration-150 ${
        selected
          ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
          : 'border-zinc-200 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isTopPath && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
              ⭐ Best path
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium">
            {hops === 1 ? '1 hop · Direct' : `${hops} hops`}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {strengthLabel(scoreBreakdown.strengthScore)} connection
          </span>
        </div>
        {selected && (
          <CheckCircle2 className="w-5 h-5 text-indigo-500 flex-shrink-0" />
        )}
      </div>

      {/* Path visualization */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {path.map((nodeId, i) => {
          const node = nodeMap[nodeId];
          const isFirst = i === 0;
          const isLast = i === path.length - 1;
          return (
            <React.Fragment key={nodeId}>
              <div className="flex flex-col items-center gap-1">
                <NodeAvatar node={node} size="md" />
                <span className={`text-[10px] font-medium max-w-[72px] text-center leading-tight truncate ${
                  isFirst || isLast
                    ? 'text-zinc-700 dark:text-zinc-200'
                    : 'text-zinc-600 dark:text-zinc-300'
                }`}>
                  {isFirst ? requesterLabel : node?.name?.split(' ')[0] ?? nodeId}
                </span>
              </div>
              {i < path.length - 1 && (
                <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0 mb-4" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Score bar */}
      <div className="mb-2">
        <ScoreBar score={score} />
      </div>

      {/* Introducer context */}
      {introducer && introducerEdge && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{introducer.name}</span>
          {' '}
          {introducerEdge.since
            ? `has been in your network since ${new Date(introducerEdge.since).getFullYear()}`
            : 'is in your network'}
          {introducerEdge.interactions > 0 &&
            ` · ${introducerEdge.interactions} shared interactions`}
          .
        </p>
      )}
    </button>
  );
}
