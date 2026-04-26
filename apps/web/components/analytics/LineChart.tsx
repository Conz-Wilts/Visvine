'use client';

interface DataPoint {
  label: string;
  count: number;
  cumulative: number;
}

interface LineChartProps {
  data: DataPoint[];
  color?: string;
  mode?: 'cumulative' | 'count';
  height?: number;
}

export default function LineChart({
  data,
  color = '#6366f1',
  mode = 'cumulative',
  height = 180,
}: LineChartProps) {
  if (!data.length) return null;

  const values = data.map(d => (mode === 'cumulative' ? d.cumulative : d.count));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 560;
  const H = height;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const toX = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const toY = (v: number) => padT + innerH - ((v - min) / range) * innerH;

  // Smooth path using midpoint bezier
  const pts = values.map((v, i) => [toX(i), toY(v)] as [number, number]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    d += ` Q ${mx} ${pts[i][1]} ${mx} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
  }
  d += ` Q ${(pts[pts.length - 2][0] + pts[pts.length - 1][0]) / 2} ${pts[pts.length - 1][1]} ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;

  // Fill area path
  const fillD =
    d +
    ` L ${pts[pts.length - 1][0]} ${padT + innerH} L ${pts[0][0]} ${padT + innerH} Z`;

  // Y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = min + (range * i) / ticks;
    return { y: toY(val), label: Math.round(val).toString() };
  });

  // X-axis: show every 3rd label
  const xLabels = data.filter((_, i) => i % 3 === 0 || i === data.length - 1);

  const gradId = `lg-${color.replace('#', '')}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      aria-label="Line chart"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gridlines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={t.y}
            y2={t.y}
            stroke="currentColor"
            strokeOpacity="0.07"
            strokeWidth="1"
          />
          <text
            x={padL - 6}
            y={t.y + 4}
            fontSize="9"
            textAnchor="end"
            fill="currentColor"
            fillOpacity="0.4"
          >
            {t.label}
          </text>
        </g>
      ))}

      {/* Fill */}
      <path d={fillD} fill={`url(#${gradId})`} />

      {/* Line */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill={color} />
      ))}

      {/* X labels */}
      {xLabels.map((item, i) => {
        const idx = data.indexOf(item);
        return (
          <text
            key={i}
            x={toX(idx)}
            y={H - 6}
            fontSize="9"
            textAnchor="middle"
            fill="currentColor"
            fillOpacity="0.4"
          >
            {item.label}
          </text>
        );
      })}
    </svg>
  );
}
