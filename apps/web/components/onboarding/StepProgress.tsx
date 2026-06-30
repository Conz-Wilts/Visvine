'use client';

interface Props {
  current: number; // 1-based step number
  total: number;
}

// A primary-colour per step so the progress bar reads like a little rainbow as
// you advance (matches each step's accent: blue → violet → amber → rose → …).
const SEGMENT_COLORS = ['#2563eb', '#7c3aed', '#f59e0b', '#e11d48', '#16a34a', '#0ea5e9'];

export default function StepProgress({ current, total }: Props) {
  return (
    <div className="flex gap-1.5 mb-4 px-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-full transition-colors duration-300"
          style={{
            backgroundColor: i < current ? SEGMENT_COLORS[i % SEGMENT_COLORS.length] : '#e5e7eb',
          }}
        />
      ))}
    </div>
  );
}
