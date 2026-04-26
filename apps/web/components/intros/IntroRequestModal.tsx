'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import IntroPathCard, { type EnrichedPath } from './IntroPathCard';

interface NodeSummary {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
}

interface IntroRequestModalProps {
  communityId: string;
  targetNode: NodeSummary;
  requesterNodeId: string;
  requesterName: string;
  onClose: () => void;
}

type ModalStep = 'paths' | 'compose' | 'success';

const MAX_MSG = 600;

export default function IntroRequestModal({
  communityId,
  targetNode,
  requesterNodeId,
  requesterName,
  onClose,
}: IntroRequestModalProps) {
  const [step, setStep] = useState<ModalStep>('paths');

  // Step 1: paths
  const [paths, setPaths] = useState<EnrichedPath[]>([]);
  const [nodeMap, setNodeMap] = useState<Record<string, NodeSummary>>({});
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathsError, setPathsError] = useState<string | null>(null);
  const [selectedPathIdx, setSelectedPathIdx] = useState<number | null>(null);

  // Step 2: compose
  const [msgToTarget, setMsgToTarget] = useState('');
  const [msgToIntroducer, setMsgToIntroducer] = useState('');
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  const loadPaths = useCallback(async () => {
    setPathsLoading(true);
    setPathsError(null);
    try {
      const res = await fetch(
        `/api/intros/paths?from=${encodeURIComponent(requesterNodeId)}&to=${encodeURIComponent(targetNode.id)}&communityId=${encodeURIComponent(communityId)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load paths');
      setPaths(data.paths ?? []);
      setNodeMap(data.nodes ?? {});
    } catch (err: unknown) {
      setPathsError(err instanceof Error ? err.message : 'Failed to load paths');
    } finally {
      setPathsLoading(false);
    }
  }, [requesterNodeId, targetNode.id, communityId]);

  useEffect(() => { loadPaths(); }, [loadPaths]);

  const selectedPath = selectedPathIdx !== null ? paths[selectedPathIdx] : null;
  const introducer = selectedPath ? nodeMap[selectedPath.path[1]] : null;

  async function handleSubmit() {
    if (!selectedPath || !msgToTarget.trim() || !msgToIntroducer.trim()) return;
    setComposing(true);
    setComposeError(null);
    try {
      const res = await fetch('/api/intros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communityId,
          requesterNodeId,
          targetNodeId: targetNode.id,
          introducerNodeId: selectedPath.introducerNodeId,
          pathNodeIds: selectedPath.path,
          pathScore: selectedPath.score,
          messageToTarget: msgToTarget,
          messageToIntroducer: msgToIntroducer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send request');
      setStep('success');
    } catch (err: unknown) {
      setComposeError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setComposing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-zinc-200 dark:border-zinc-700/60"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            {step === 'compose' && (
              <button
                onClick={() => setStep('paths')}
                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-zinc-500" />
              </button>
            )}
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                {step === 'paths' && 'Request an Intro'}
                {step === 'compose' && 'Write your messages'}
                {step === 'success' && 'Request sent!'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {step === 'paths' && `To ${targetNode.name}`}
                {step === 'compose' && `Via ${introducer?.name ?? '…'}`}
                {step === 'success' && `${introducer?.name} will be notified`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        {/* Step indicator */}
        {step !== 'success' && (
          <div className="flex items-center gap-2 px-6 pt-4 flex-shrink-0">
            {['paths', 'compose'].map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${
                  step === s
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : i < ['paths', 'compose'].indexOf(step)
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-zinc-400 dark:text-zinc-500'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    step === s
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                      : i < ['paths', 'compose'].indexOf(step)
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  }`}>
                    {i < ['paths', 'compose'].indexOf(step) ? '✓' : i + 1}
                  </span>
                  {s === 'paths' ? 'Select path' : 'Write messages'}
                </div>
                {i < 1 && <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

          {/* ── STEP 1: Path selection ── */}
          {step === 'paths' && (
            <div>
              {pathsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Scanning your network…</p>
                </div>
              ) : pathsError ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{pathsError}</p>
                  <button onClick={loadPaths} className="text-xs text-indigo-500 underline">Retry</button>
                </div>
              ) : paths.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <Search className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                  <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No intro paths found</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      You don't share any mutual connections within 3 degrees of {targetNode.name}.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                    Found <span className="font-semibold text-zinc-700 dark:text-zinc-200">{paths.length}</span> path{paths.length !== 1 ? 's' : ''} to {targetNode.name}. Ranked by connection strength.
                  </p>
                  <div className="space-y-3">
                    {paths.map((p, i) => (
                      <IntroPathCard
                        key={p.path.join('-')}
                        pathData={p}
                        nodeMap={nodeMap}
                        selected={selectedPathIdx === i}
                        rank={i}
                        onSelect={() => setSelectedPathIdx(i)}
                        requesterLabel={requesterName.split(' ')[0]}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 2: Compose messages ── */}
          {step === 'compose' && introducer && (
            <div className="space-y-5">
              {/* Message to introducer */}
              <div>
                <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">
                  Message to {introducer.name}
                  <span className="ml-1 text-xs font-normal text-zinc-400">(the person making the intro)</span>
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  Explain why you're asking them specifically, and why this intro matters to you.
                </p>
                <textarea
                  value={msgToIntroducer}
                  onChange={e => setMsgToIntroducer(e.target.value.slice(0, MAX_MSG))}
                  rows={5}
                  placeholder={`Hi ${introducer.name.split(' ')[0]}, I'd really appreciate if you could introduce me to…`}
                  className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400"
                />
                <p className="text-xs text-zinc-400 dark:text-zinc-500 text-right mt-1">
                  {msgToIntroducer.length}/{MAX_MSG}
                </p>
              </div>

              {/* Message to target */}
              <div>
                <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">
                  Message to {targetNode.name}
                  <span className="ml-1 text-xs font-normal text-zinc-400">(forwarded with the intro)</span>
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  Introduce yourself and share what you're hoping to get from connecting.
                </p>
                <textarea
                  value={msgToTarget}
                  onChange={e => setMsgToTarget(e.target.value.slice(0, MAX_MSG))}
                  rows={5}
                  placeholder={`Hi ${targetNode.name.split(' ')[0]}, I'm ${requesterName}…`}
                  className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400"
                />
                <p className="text-xs text-zinc-400 dark:text-zinc-500 text-right mt-1">
                  {msgToTarget.length}/{MAX_MSG}
                </p>
              </div>

              {composeError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {composeError}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Success ── */}
          {step === 'success' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">
                  Intro request sent!
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{introducer?.name}</span> has been notified. Once they approve, {targetNode.name} will receive the intro with your message.
                </p>
              </div>
              <div className="w-full max-w-xs bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-left mt-2">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Path</div>
                <div className="flex items-center gap-1 flex-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {selectedPath?.path.map((id, i) => (
                    <React.Fragment key={id}>
                      <span className="font-medium">
                        {i === 0 ? requesterName.split(' ')[0] : nodeMap[id]?.name?.split(' ')[0] ?? id}
                      </span>
                      {i < (selectedPath.path.length - 1) && (
                        <span className="text-zinc-400">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 flex-shrink-0 gap-3">
          {step === 'paths' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={selectedPathIdx === null}
                onClick={() => setStep('compose')}
                className="px-5 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continue with this path →
              </button>
            </>
          )}
          {step === 'compose' && (
            <>
              <button
                onClick={() => setStep('paths')}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                disabled={composing || !msgToTarget.trim() || !msgToIntroducer.trim()}
                onClick={handleSubmit}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {composing && <Loader2 className="w-4 h-4 animate-spin" />}
                Send intro request
              </button>
            </>
          )}
          {step === 'success' && (
            <button
              onClick={onClose}
              className="ml-auto px-5 py-2 text-sm font-medium rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
