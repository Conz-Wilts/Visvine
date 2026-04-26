'use client';

interface BarChartProps {
  data: { label: string; count: number }[];
  color?: string;
  height?: number;
  horizontal?: boolean;
}

export default function BarChart({
  data,
  color = '#6366f1',
  height = 180,
  horizontal = false,
}: BarChartProps) {
  if (!data.length) return null;

  const max = Math.max(...data.map(d => d.count), 1);

  if (horizontal) {
    return (
      <div className="space-y-2.5">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className="text-xs text-zinc-500 dark:text-zinc-400 truncate"
              style={{ width: 90, flexShrink: 0, textAlign: 'right' }}
            >
              {item.label}
            </span>
            <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(item.count / max) * 100}%`,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
              />
            </div>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 w-6 text-right tabular-nums">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const W = 560;
  const H = height;
  const padL = 10;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const gap = 4;
  const barW = (innerW / data.length) - gap;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {data.map((item, i) => {
        const barH = (item.count / max) * innerH;
        const x = padL + i * (barW + gap);
        const y = padT + innerH - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 2)}
              rx={3}
              fill={color}
              fillOpacity={0.75 + (i / data.length) * 0.25}
            />
            {item.count > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                fontSize="8"
                textAnchor="middle"
                fill="currentColor"
                fillOpacity="0.5"
              >
                {item.count}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={H - 6}
              fontSize="8"
              textAnchor="middle"
              fill="currentColor"
              fillOpacity="0.4"
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
