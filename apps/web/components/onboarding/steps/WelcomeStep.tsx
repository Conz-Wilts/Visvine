'use client';

interface Props {
  firstName: string;
  imageUrl: string | null;
  onStart: () => void;
}

export default function WelcomeStep({ onStart }: Props) {
  return (
    <div className="p-8 py-16 text-center">
      <h1 className="font-title text-4xl font-bold text-gray-900 mb-3">
        Welcome to Visvine
      </h1>
      <p className="font-title text-gray-500 mb-10 max-w-sm mx-auto">
        Let&apos;s set up your profile so people in the community can find and connect with you.
      </p>

      <button
        onClick={onStart}
        className="w-full bg-brand-green text-white rounded-full py-3 px-6 font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft"
      >
        Set Up My Profile
      </button>
    </div>
  );
}
