'use client';

interface Props {
  current: number; // 1-based step number
  total: number;
}

export default function StepProgress({ current, total }: Props) {
  return (
    <div className="flex gap-1.5 mb-4 px-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
            i < current ? 'bg-brand-green' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}
