/**
 * Charts — thin wrappers over recharts with the kit's defaults baked in, plus
 * the raw recharts primitives under a `Recharts` namespace for a Tool that
 * needs something the wrappers do not expose.
 *
 * recharts is bundled INTO tool-kit.js (it is not an external and has no
 * import-map entry), so a Tool imports `LineChart` from `@visvine/tool-kit`
 * and never names recharts. Colours are resolved from the kit's own custom
 * properties (`--vv-chart-1..8`, see styles.ts) at render time so a chart
 * follows the host theme; SVG attributes cannot carry `var()` reliably, which
 * is why `useChartColors` reads computed values instead of emitting variables.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import * as Recharts from 'recharts';
import { useTheme } from '../hooks';
import { CHART_COLORS } from '../styles';
import { clsx as cx } from 'clsx';

export { Recharts };

/** Fallbacks for a document without the kit stylesheet (tests, SSR). */
const FALLBACK_COLORS = CHART_COLORS;

/** How many `--vv-chart-N` slots the stylesheet defines. */
export const CHART_COLOR_SLOTS = FALLBACK_COLORS.length;

/**
 * The palette a chart paints with, resolved from `--vv-chart-1..8` on the
 * frame's `:root`. Re-resolved whenever the host pushes a new theme.
 */
export function useChartColors(): string[] {
  const theme = useTheme();
  return useMemo(() => {
    if (typeof document === 'undefined') return FALLBACK_COLORS;
    const style = getComputedStyle(document.documentElement);
    return FALLBACK_COLORS.map((fallback, i) => style.getPropertyValue(`--vv-chart-${i + 1}`).trim() || fallback);
    // The theme map is the signal that the custom properties changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

export interface ChartSeries {
  /** The key in each data row. */
  key: string;
  /** Legend/tooltip label; defaults to `key`. */
  label?: string;
  /** Any CSS colour; defaults to the next palette slot. */
  color?: string;
}

export interface ChartProps {
  data: Array<Record<string, unknown>>;
  /** The key of the category / time axis. */
  x: string;
  /** One or more series to plot — a key, or a `{ key, label, color }`. */
  series: Array<string | ChartSeries>;
  /** CSS pixels. Width always fills the container. */
  height?: number;
  legend?: boolean;
  grid?: boolean;
  tooltip?: boolean;
  /** Bar/area only: stack the series instead of grouping/overlaying them. */
  stacked?: boolean;
  /** Format a y-axis tick / tooltip value. */
  formatValue?: (value: number) => string;
  /** Format an x-axis tick. */
  formatX?: (value: unknown) => string;
  className?: string;
  /** Extra recharts children (a `Recharts.ReferenceLine`, say). */
  children?: ReactNode;
}

function normalise(series: Array<string | ChartSeries>): ChartSeries[] {
  return series.map((s) => (typeof s === 'string' ? { key: s } : s));
}

const MARGIN = { top: 8, right: 12, bottom: 4, left: 0 };
const AXIS_STYLE = { fontSize: 11, fill: 'currentColor' };
const TOOLTIP_STYLE = {
  background: 'var(--vv-surface)',
  border: '1px solid var(--vv-border)',
  borderRadius: 'var(--vv-radius)',
  fontSize: 12,
  color: 'var(--vv-text)',
};

function Frame({ height = 240, className, children }: { height?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cx('vv-chart', className)} style={{ height }}>
      <Recharts.ResponsiveContainer width="100%" height="100%">
        {children as never}
      </Recharts.ResponsiveContainer>
    </div>
  );
}

function tooltipFormatter(formatValue?: (value: number) => string) {
  return formatValue ? (value: unknown) => formatValue(Number(value)) : undefined;
}

function CommonParts({
  x,
  grid,
  tooltip,
  legend,
  formatValue,
  formatX,
}: Pick<ChartProps, 'x' | 'grid' | 'tooltip' | 'legend' | 'formatValue' | 'formatX'>) {
  return (
    <>
      {grid !== false && <Recharts.CartesianGrid strokeDasharray="3 3" stroke="var(--vv-border)" vertical={false} />}
      <Recharts.XAxis
        dataKey={x}
        tick={AXIS_STYLE}
        tickLine={false}
        axisLine={{ stroke: 'var(--vv-border)' }}
        tickFormatter={formatX as ((value: unknown) => string) | undefined}
      />
      <Recharts.YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} tickFormatter={formatValue} />
      {tooltip !== false && <Recharts.Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(formatValue)} />}
      {legend && <Recharts.Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );
}

/** A line per series, points on hover, no dots at rest. */
export function LineChart(props: ChartProps) {
  const colors = useChartColors();
  const series = normalise(props.series);
  return (
    <Frame height={props.height} className={props.className}>
      <Recharts.LineChart data={props.data} margin={MARGIN}>
        <CommonParts {...props} />
        {series.map((s, i) => (
          <Recharts.Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color ?? colors[i % colors.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
        {props.children}
      </Recharts.LineChart>
    </Frame>
  );
}

/** Grouped bars by default; `stacked` stacks them. */
export function BarChart(props: ChartProps) {
  const colors = useChartColors();
  const series = normalise(props.series);
  return (
    <Frame height={props.height} className={props.className}>
      <Recharts.BarChart data={props.data} margin={MARGIN}>
        <CommonParts {...props} />
        {series.map((s, i) => (
          <Recharts.Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={s.color ?? colors[i % colors.length]}
            stackId={props.stacked ? 'stack' : undefined}
            radius={props.stacked ? 0 : [3, 3, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
        {props.children}
      </Recharts.BarChart>
    </Frame>
  );
}

/** Filled lines; `stacked` stacks the areas. */
export function AreaChart(props: ChartProps) {
  const colors = useChartColors();
  const series = normalise(props.series);
  return (
    <Frame height={props.height} className={props.className}>
      <Recharts.AreaChart data={props.data} margin={MARGIN}>
        <CommonParts {...props} />
        {series.map((s, i) => {
          const color = s.color ?? colors[i % colors.length];
          return (
            <Recharts.Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={color}
              fill={color}
              fillOpacity={0.18}
              strokeWidth={2}
              stackId={props.stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          );
        })}
        {props.children}
      </Recharts.AreaChart>
    </Frame>
  );
}

export interface PieChartProps {
  data: Array<Record<string, unknown>>;
  /** Key of the slice label. */
  nameKey: string;
  /** Key of the slice value. */
  valueKey: string;
  height?: number;
  legend?: boolean;
  tooltip?: boolean;
  /** Hollow centre. */
  donut?: boolean;
  /** Per-slice colours; defaults to the palette. */
  colors?: string[];
  formatValue?: (value: number) => string;
  className?: string;
  children?: ReactNode;
}

export function PieChart({
  data,
  nameKey,
  valueKey,
  height,
  legend = true,
  tooltip = true,
  donut = false,
  colors: own,
  formatValue,
  className,
  children,
}: PieChartProps) {
  const palette = useChartColors();
  const colors = own && own.length > 0 ? own : palette;
  return (
    <Frame height={height} className={className}>
      <Recharts.PieChart margin={MARGIN}>
        <Recharts.Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={donut ? '55%' : 0}
          outerRadius="85%"
          paddingAngle={donut ? 2 : 0}
          stroke="var(--vv-surface)"
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Recharts.Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Recharts.Pie>
        {tooltip && <Recharts.Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(formatValue)} />}
        {legend && <Recharts.Legend wrapperStyle={{ fontSize: 12 }} />}
        {children}
      </Recharts.PieChart>
    </Frame>
  );
}
