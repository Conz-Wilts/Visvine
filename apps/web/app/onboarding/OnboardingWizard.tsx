'use client';

import { useState } from 'react';
import WelcomeStep from '@/components/onboarding/steps/WelcomeStep';
import PhotoBasicsStep from '@/components/onboarding/steps/PhotoBasicsStep';
import AboutStep from '@/components/onboarding/steps/AboutStep';
import ConnectStep from '@/components/onboarding/steps/ConnectStep';
import DoneStep from '@/components/onboarding/steps/DoneStep';
import StepProgress from '@/components/onboarding/StepProgress';

export interface OnboardingData {
  name: string;
  imageUrl: string | null;
  subtitle: string;
  location: string;
  bio: string;
  tags: string[];
  linkedinUrl: string;
  twitterUrl: string;
  website: string;
  phone: string;
}

interface Props {
  person: {
    id: string;
    name: string;
    imageUrl?: string | null;
    subtitle?: string | null;
    bio?: string | null;
    location?: string | null;
    tags: string[];
    linkedinUrl?: string | null;
    twitterUrl?: string | null;
    website?: string | null;
    phone?: string | null;
  };
  userName: string;
}

const TOTAL_STEPS = 3;

export default function OnboardingWizard({ person, userName }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const [data, setData] = useState<OnboardingData>({
    name: person.name ?? '',
    imageUrl: person.imageUrl ?? null,
    subtitle: person.subtitle ?? '',
    location: person.location ?? '',
    bio: person.bio ?? '',
    tags: person.tags,
    linkedinUrl: person.linkedinUrl ?? '',
    twitterUrl: person.twitterUrl ?? '',
    website: person.website ?? '',
    phone: person.phone ?? '',
  });

  const updateData = (partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const saveStep = async (stepData: Partial<OnboardingData>): Promise<boolean> => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};

      if (stepData.name !== undefined) payload.name = stepData.name;
      if (stepData.subtitle !== undefined) payload.subtitle = stepData.subtitle || null;
      if (stepData.location !== undefined) payload.location = stepData.location || null;
      if (stepData.bio !== undefined) payload.bio = stepData.bio || null;
      if (stepData.tags !== undefined) payload.tags = stepData.tags;
      if (stepData.linkedinUrl !== undefined) payload.linkedinUrl = stepData.linkedinUrl || null;
      if (stepData.twitterUrl !== undefined) payload.twitterUrl = stepData.twitterUrl || null;
      if (stepData.website !== undefined) payload.website = stepData.website || null;
      if (stepData.phone !== undefined) payload.phone = stepData.phone || null;
      if (stepData.imageUrl !== undefined) payload.imageUrl = stepData.imageUrl;

      if (Object.keys(payload).length === 0) return true;

      const res = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async (stepData?: Partial<OnboardingData>) => {
    if (stepData) {
      updateData(stepData);
      const ok = await saveStep(stepData);
      if (!ok) {
        setSaveError("We couldn't save your changes. Please check your entries and try again.");
        return;
      }
    }
    setSaveError(null);
    setDirection('forward');
    setStep((s) => s + 1);
  };

  const back = () => {
    setDirection('back');
    setStep((s) => Math.max(0, s - 1));
  };

  // Mark onboarding complete + provision the user's personal community on the
  // server. Returns its id so we can make it the active community before the user
  // lands in the app. (localStorage key mirrors CommunityContext's.)
  const finishOnboarding = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/onboarding', { method: 'POST' });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as { communityId?: string };
      return typeof data.communityId === 'string' ? data.communityId : null;
    } catch {
      return null;
    }
  };

  const complete = async () => {
    const communityId = await finishOnboarding();
    if (communityId) {
      try {
        localStorage.setItem('nb_current_community', communityId);
        // One-shot flag — the auth shell's TourLauncher runs the guided tour once,
        // starting from the first step (index 0).
        localStorage.setItem('nb_onboarding_tour', '1');
        localStorage.setItem('nb_tour_index', '0');
      } catch {}
    }
  };

  const firstName = userName.split(' ')[0];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {step > 0 && step < 4 && (
          <StepProgress current={step} total={TOTAL_STEPS} />
        )}

        {saveError && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600"
          >
            {saveError}
          </div>
        )}

        <div
          className="relative bg-white rounded-2xl shadow-lg overflow-hidden"
          key={step}
          style={{
            animation: `${direction === 'forward' ? 'slideInRight' : 'slideInLeft'} 300ms ease-out`,
          }}
        >
          {step === 0 && (
            <WelcomeStep
              firstName={firstName}
              imageUrl={data.imageUrl}
              onStart={() => next()}
            />
          )}
          {step === 1 && (
            <PhotoBasicsStep
              data={data}
              personId={person.id}
              onNext={(d) => next(d)}
              onBack={back}
              saving={saving}
            />
          )}
          {step === 2 && (
            <AboutStep
              data={data}
              onNext={(d) => next(d)}
              onBack={back}
              saving={saving}
            />
          )}
          {step === 3 && (
            <ConnectStep
              data={data}
              onNext={(d) => next(d)}
              onBack={back}
              saving={saving}
            />
          )}
          {step === 4 && (
            <DoneStep
              data={data}
              personName={userName}
              onComplete={complete}
            />
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes checkmark {
          0% { stroke-dashoffset: 50; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes scaleIn {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
