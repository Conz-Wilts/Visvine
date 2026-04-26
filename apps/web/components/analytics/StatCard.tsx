'use client';

interface StatCardProps {
  label: string;
  value: number | string;
  delta?: number;
  deltaLabel?: string;
  icon: React.ReactNode;
  accent?: string;
}

export default function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  accent = '#6366f1',
}: StatCardProps) {
  const isPositive = delta === undefined || delta >= 0;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {label}
        </span>
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: accent + '18', color: accent }}
        >
          {icon}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="text-3xl font-bold text-zinc-900 dark:text-white tabular-nums leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {delta !== undefined && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium mb-0.5 ${
              isPositive
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-500 dark:text-red-400'
            }`}
          >
            {isPositive ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
              </svg>
            )}
            {Math.abs(delta)}
            {deltaLabel && <span className="ml-0.5 text-zinc-400 font-normal">{deltaLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
