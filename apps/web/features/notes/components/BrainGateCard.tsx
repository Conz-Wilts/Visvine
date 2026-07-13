'use client'

// The request-access card for a community brain whose registry root gate
// (folderId '') denies the viewer read access. Shared by the notes workspace
// (full-page gated state) and the profile Context tab (inline gated state).

interface BrainGateCardProps {
  communityName: string
  pending: boolean
  requesting: boolean
  onRequest: () => void
}

export function BrainGateCard({ communityName, pending, requesting, onRequest }: BrainGateCardProps) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border-subtle bg-surface-1 px-8 py-10 text-center shadow-float">
      <span className="text-3xl" aria-hidden="true">🔒</span>
      <h2 className="text-base font-semibold text-text-primary">This community&apos;s brain is private</h2>
      <p className="text-sm text-text-secondary">
        Access to {communityName}&apos;s shared notes is limited. Request access and an admin will review it.
      </p>
      {pending ? (
        <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted">
          Request pending — an admin will review it
        </span>
      ) : (
        <button
          onClick={onRequest}
          disabled={requesting}
          className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
        >
          {requesting ? 'Requesting…' : 'Request access'}
        </button>
      )}
    </div>
  )
}
