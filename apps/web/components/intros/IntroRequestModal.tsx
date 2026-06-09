'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import type { MutualConnection } from '@/lib/intros/types';
import MutualConnectionCard from './MutualConnectionCard';

export interface IntroTargetNode {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
}

interface IntroRequestModalProps {
  communityId: string;
  targetNode: IntroTargetNode;
  /** Display name of the requester (the viewer). Used in placeholders/copy only. */
  requesterName: string;
  onClose: () => void;
}

type Step = 'pick' | 'compose' | 'success';
const MAX_MSG = 600;

export default function IntroRequestModal({ communityId, targetNode, requesterName, onClose }: IntroRequestModalProps) {
  const [step, setStep] = useState<Step>('pick');

  const [mutuals, setMutuals] = useState<MutualConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [msgIntro, setMsgIntro] = useState('');
  const [msgTarget, setMsgTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsProfile(false);
    try {
      const res = await fetch(
        `/api/intros/mutuals?targetId=${encodeURIComponent(targetNode.id)}&communityId=${encodeURIComponent(communityId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load connections');
      if (data.error === 'no_profile') {
        setNeedsProfile(true);
        setMutuals([]);
      } else {
        setMutuals(data.mutuals ?? []);
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, [targetNode.id, communityId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = mutuals.find((m) => m.id === selectedId) ?? null;

  async function submit() {
    if (!selected || !msgIntro.trim() || !msgTarget.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/intros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communityId,
          targetNodeId: targetNode.id,
          introducerNodeId: selected.id,
          messageToIntroducer: msgIntro,
          messageToTarget: msgTarget,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send request');
      setStep('success');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-1 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-border-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {step === 'compose' && (
              <button onClick={() => setStep('pick')} className="p-1.5 rounded-lg hover:bg-surface-2 transition" aria-label="Back">
                <ArrowLeft className="w-4 h-4 text-text-muted" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-text-primary truncate font-ginto">
                {step === 'pick' && 'Ask for an introduction'}
                {step === 'compose' && 'Write your messages'}
                {step === 'success' && 'Request sent'}
              </h2>
              <p className="text-xs text-text-muted truncate mt-0.5">
                {step === 'pick' && `To ${targetNode.name}`}
                {step === 'compose' && selected && `Via ${selected.name}`}
                {step === 'success' && selected && `${selected.name} will be notified`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition" aria-label="Close">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {step === 'pick' && (
            loading ? (
              <Centered>
                <Loader2 className="w-6 h-6 animate-spin text-brand-dark-green" />
                <p className="text-sm text-text-muted">Finding who you both know…</p>
              </Centered>
            ) : needsProfile ? (
              <Centered>
                <AlertCircle className="w-7 h-7 text-amber-500" />
                <p className="text-sm text-text-secondary text-center max-w-xs">
                  Link your own profile before requesting an introduction.
                </p>
              </Centered>
            ) : loadError ? (
              <Centered>
                <AlertCircle className="w-7 h-7 text-amber-500" />
                <p className="text-sm text-text-secondary text-center">{loadError}</p>
                <button onClick={load} className="text-xs font-semibold text-brand-dark-green underline">Try again</button>
              </Centered>
            ) : mutuals.length === 0 ? (
              <Centered>
                <Search className="w-7 h-7 text-text-muted" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-text-primary">No mutual connections</p>
                  <p className="text-xs text-text-muted mt-1 max-w-xs">
                    You and {targetNode.name} don&apos;t yet share anyone who could make the introduction.
                  </p>
                </div>
              </Centered>
            ) : (
              <>
                <p className="text-xs text-text-muted mb-3">
                  You both know <b className="text-text-secondary">{mutuals.length}</b>{' '}
                  {mutuals.length === 1 ? 'person' : 'people'}. Pick who you&apos;d like to ask.
                </p>
                <div className="space-y-2">
                  {mutuals.map((m) => (
                    <MutualConnectionCard
                      key={m.id}
                      mutual={m}
                      selected={selectedId === m.id}
                      onSelect={() => setSelectedId(m.id)}
                    />
                  ))}
                </div>
              </>
            )
          )}

          {step === 'compose' && selected && (
            <div className="space-y-5">
              <Field
                label={`Message to ${selected.name}`}
                hint="The person making the intro — explain why you're asking them, and why it matters."
                value={msgIntro}
                onChange={setMsgIntro}
                placeholder={`Hi ${selected.name.split(' ')[0]}, I'd really appreciate an intro to ${targetNode.name.split(' ')[0]}…`}
              />
              <Field
                label={`Message to ${targetNode.name}`}
                hint="Forwarded with the introduction — introduce yourself and your ask."
                value={msgTarget}
                onChange={setMsgTarget}
                placeholder={`Hi ${targetNode.name.split(' ')[0]}, I'm ${requesterName}…`}
              />
              {submitError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {submitError}
                </div>
              )}
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-brand-light-bg flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-brand-dark-green" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary mb-1 font-ginto">Request sent</h3>
                <p className="text-sm text-text-muted max-w-sm">
                  <b className="text-text-secondary">{selected?.name}</b> has been asked to introduce you. Once they
                  approve, {targetNode.name} can accept — then you&apos;ll be connected.
                </p>
              </div>
              {selected && (
                <PathPreview requester={requesterName} introducer={selected.name} target={targetNode.name} />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle flex-shrink-0 gap-3">
          {step === 'pick' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition">
                Cancel
              </button>
              <button
                disabled={!selected}
                onClick={() => setStep('compose')}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-brand-green text-brand-black hover:bg-[#6bc963] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Continue
              </button>
            </>
          )}
          {step === 'compose' && (
            <>
              <button onClick={() => setStep('pick')} className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition">
                Back
              </button>
              <button
                disabled={submitting || !msgIntro.trim() || !msgTarget.trim()}
                onClick={submit}
                className="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl bg-brand-green text-brand-black hover:bg-[#6bc963] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send request
              </button>
            </>
          )}
          {step === 'success' && (
            <button
              onClick={onClose}
              className="ml-auto px-5 py-2 text-sm font-bold rounded-xl bg-brand-green text-brand-black hover:bg-[#6bc963] transition"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center py-12 gap-3">{children}</div>;
}

function Field({
  label, hint, value, onChange, placeholder,
}: {
  label: string; hint: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-text-primary mb-1">{label}</label>
      <p className="text-xs text-text-muted mb-2">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_MSG))}
        rows={4}
        placeholder={placeholder}
        className="w-full px-4 py-3 text-sm rounded-xl border border-border-default bg-surface-1 text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green"
      />
      <p className="text-xs text-text-muted text-right mt-1">{value.length}/{MAX_MSG}</p>
    </div>
  );
}

function PathPreview({ requester, introducer, target }: { requester: string; introducer: string; target: string }) {
  return (
    <div className="w-full bg-surface-2 rounded-xl p-3 flex items-center justify-center gap-2 flex-wrap text-sm">
      <span className="font-semibold text-text-primary">{requester.split(' ')[0]}</span>
      <span className="text-text-muted">→</span>
      <span className="font-semibold text-brand-dark-green">{introducer.split(' ')[0]}</span>
      <span className="text-text-muted">→</span>
      <span className="font-semibold text-text-primary">{target.split(' ')[0]}</span>
    </div>
  );
}
