'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin } from 'lucide-react';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import type { OnboardingData } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  personName: string;
  onComplete: () => Promise<void>;
}

// Rotating primary-colour chips so the finished profile feels celebratory.
const TAG_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
];

export default function DoneStep({ data, personName, onComplete }: Props) {
  const router = useRouter();
  const [completing, setCompleting] = useState(true);

  useEffect(() => {
    // Always re-enable the button — even if the completion POST fails the user
    // must be able to leave onboarding rather than get stuck on "Finishing…".
    onComplete().finally(() => setCompleting(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-8 text-center">
      {/* Animated checkmark */}
      <div className="flex justify-center mb-6" style={{ animation: 'scaleIn 400ms ease-out' }}>
        <div className="w-20 h-20 rounded-full bg-brand-light-bg flex items-center justify-center">
          <svg className="w-10 h-10 text-brand-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" style={{ strokeDasharray: 50, animation: 'checkmark 600ms ease-out 200ms both' }} />
          </svg>
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h2>
      <p className="text-sm text-gray-500 mb-6">You can always update your profile later.</p>

      {/* Profile preview card */}
      <div className="border border-gray-100 rounded-xl p-4 mb-6 text-left">
        <div className="flex items-center gap-3">
          {data.imageUrl ? (
            <img src={data.imageUrl} alt={personName} className="w-12 h-12 rounded-xl object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-xl overflow-hidden">
              <PersonSilhouette />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{personName}</p>
            {data.subtitle && <p className="text-xs text-gray-500 truncate">{data.subtitle}</p>}
            {data.location && (
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {data.location}
              </p>
            )}
          </div>
        </div>
        {data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {data.tags.slice(0, 5).map((tag, i) => (
              <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full ${TAG_COLORS[i % TAG_COLORS.length]}`}>{tag}</span>
            ))}
            {data.tags.length > 5 && <span className="text-[10px] text-gray-400">+{data.tags.length - 5} more</span>}
          </div>
        )}
      </div>

      <button
        onClick={() => router.push('/directory')}
        disabled={completing}
        className="w-full bg-brand-green text-white rounded-full py-3 px-6 font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft disabled:opacity-60"
      >
        {completing ? 'Finishing...' : 'Go to Directory'}
      </button>
    </div>
  );
}
