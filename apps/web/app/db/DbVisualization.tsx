'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchJson } from '@/lib/fetchJson';

interface Column {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}
interface ForeignKey {
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
}
interface SchemaData {
  tables: string[];
  columns: Column[];
  foreignKeys: ForeignKey[];
  rowCounts: Record<string, number>;
}
interface TablePos {
  name: string;
  col: number;   // column index (x)
  row: number;   // row index within column (y)
  x: number;
  y: number;
  width: number;
  height: number;
  columns: Column[];
}

// ─── dimensions ────────────────────────────────────────────────────────────────
const TW       = 230;   // table card width
const TH       = 38;    // table header height
const RH       = 27;    // per-column row height
const COL_GAP  = 190;   // horizontal gap between columns (space for lines)
const ROW_GAP  = 52;    // vertical gap between tables in same column
const PAD      = 80;    // canvas padding

function shortType(t: string) {
  return t
    .replace('character varying', 'varchar')
    .replace('timestamp without time zone', 'timestamp')
    .replace('timestamp with time zone', 'timestamptz')
    .replace('double precision', 'float8')
    .replace('integer', 'int4')
    .replace('bigint', 'int8')
    .replace('boolean', 'bool');
}

// ─── layout ────────────────────────────────────────────────────────────────────
function computeLayout(
  tables: string[],
  fks: ForeignKey[],
  columns: Column[],
): TablePos[] {

  // Build adjacency (source has FK → target)
  const out: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  tables.forEach((t) => { out[t] = []; inDeg[t] = 0; });

  const seen = new Set<string>();
  fks.forEach(({ source_table: s, target_table: t }) => {
    if (s === t) return;
    const key = `${s}→${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[s].push(t);
    inDeg[t] = (inDeg[t] ?? 0) + 1;
  });

  // Longest-path from each node to a "sink" (no outgoing edges)
  // Tables closer to sinks get HIGHER column index → placed on the RIGHT
  // Tables with outgoing FKs are placed to the LEFT of what they reference
  const colOf: Record<string, number> = {};
  const memo = new Map<string, number>();
  function longestPath(t: string, visiting = new Set<string>()): number {
    if (memo.has(t)) return memo.get(t)!;
    if (visiting.has(t)) return 0;
    visiting.add(t);
    const children = out[t];
    const d = children.length === 0
      ? 0
      : 1 + Math.max(...children.map((c) => longestPath(c, new Set(visiting))));
    memo.set(t, d);
    return d;
  }
  tables.forEach((t) => { colOf[t] = longestPath(t); });

  // Invert: the table with the biggest longestPath goes in col 0 (LEFT)
  const maxCol = Math.max(0, ...Object.values(colOf));
  tables.forEach((t) => { colOf[t] = maxCol - colOf[t]; });

  // Group by column
  const byCol: Record<number, string[]> = {};
  tables.forEach((t) => {
    const c = colOf[t];
    (byCol[c] = byCol[c] ?? []).push(t);
  });

  // ── Barycenter ordering to minimize line crossings (3 passes) ──────────────
  const cols = Object.keys(byCol).map(Number).sort((a, b) => a - b);

  function barycenter(table: string, refCol: string[]): number {
    const neighbors = fks
      .filter(
        (fk) =>
          (fk.source_table === table && refCol.includes(fk.target_table)) ||
          (fk.target_table === table && refCol.includes(fk.source_table)),
      )
      .map((fk) => (fk.source_table === table ? fk.target_table : fk.source_table));
    if (!neighbors.length) return -1;
    return neighbors.reduce((s, n) => s + refCol.indexOf(n), 0) / neighbors.length;
  }

  for (let pass = 0; pass < 4; pass++) {
    // Forward sweep
    for (let ci = 1; ci < cols.length; ci++) {
      const ref = byCol[cols[ci - 1]];
      byCol[cols[ci]] = [...byCol[cols[ci]]].sort((a, b) => {
        const ba = barycenter(a, ref);
        const bb = barycenter(b, ref);
        if (ba < 0 && bb < 0) return 0;
        if (ba < 0) return 1;
        if (bb < 0) return -1;
        return ba - bb;
      });
    }
    // Backward sweep
    for (let ci = cols.length - 2; ci >= 0; ci--) {
      const ref = byCol[cols[ci + 1]];
      byCol[cols[ci]] = [...byCol[cols[ci]]].sort((a, b) => {
        const ba = barycenter(a, ref);
        const bb = barycenter(b, ref);
        if (ba < 0 && bb < 0) return 0;
        if (ba < 0) return 1;
        if (bb < 0) return -1;
        return ba - bb;
      });
    }
  }

  // Compute total height per column for vertical centering
  const colHeight: Record<number, number> = {};
  cols.forEach((c) => {
    colHeight[c] = byCol[c].reduce((sum, t) => {
      const h = TH + columns.filter((col) => col.table_name === t).length * RH;
      return sum + h + ROW_GAP;
    }, -ROW_GAP);
  });
  const maxColH = Math.max(...Object.values(colHeight));

  // Assign x, y positions
  const positions: TablePos[] = [];
  cols.forEach((c, ci) => {
    const x = PAD + ci * (TW + COL_GAP);
    const startY = PAD + (maxColH - colHeight[c]) / 2;
    let curY = startY;
    byCol[c].forEach((name, ri) => {
      const tableCols = columns.filter((col) => col.table_name === name);
      const h = TH + tableCols.length * RH;
      positions.push({
        name,
        col: c,
        row: ri,
        x,
        y: curY,
        width: TW,
        height: h,
        columns: tableCols,
      });
      curY += h + ROW_GAP;
    });
  });

  return positions;
}

// ─── column attachment Y ───────────────────────────────────────────────────────
function attachY(pos: TablePos, colName: string): number {
  const idx = pos.columns.findIndex((c) => c.column_name === colName);
  return pos.y + TH + (idx < 0 ? 0 : idx) * RH + RH / 2;
}

// ─── FK path ───────────────────────────────────────────────────────────────────
// Returns an SVG path string for a FK connection.
// Lines flow LEFT → RIGHT.  Backwards or same-col lines arc over the top.
function fkPath(src: TablePos, srcCol: string, tgt: TablePos, tgtCol: string, arcIndex = 0): string {
  const sy = attachY(src, srcCol);
  const ty = attachY(tgt, tgtCol);
  const goingRight = tgt.col > src.col;

  if (goingRight) {
    // Normal left-to-right: exit right side of src, enter left side of tgt
    const sx = src.x + src.width;
    const tx = tgt.x;
    const gap = tx - sx;
    const cp = gap * 0.45;
    return `M${sx},${sy} C${sx + cp},${sy} ${tx - cp},${ty} ${tx},${ty}`;
  } else {
    // Backwards / same column: arc above or below via the top margin
    const sx = src.x + src.width / 2;
    const tx = tgt.x + tgt.width / 2;
    const topY = PAD / 2 - arcIndex * 14;  // stack arcs above the diagram
    return (
      `M${sx},${src.y} ` +
      `C${sx},${topY} ${tx},${topY} ${tx},${tgt.y}`
    );
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function DbVisualization() {
  const [schema, setSchema] = useState<SchemaData | null>(null);
  const [layouts, setLayouts] = useState<TablePos[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const tf = useRef({ x: 0, y: 0, k: 1 });
  const [, redraw] = useState(0);
  const panning = useRef(false);
  const panOrigin = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetchJson<SchemaData>('/api/db-schema')
      .then((data) => {
        setSchema(data);
        const lays = computeLayout(data.tables, data.foreignKeys, data.columns);
        setLayouts(lays);

        // Fit to viewport
        if (typeof window !== 'undefined') {
          const maxX = Math.max(...lays.map((l) => l.x + l.width)) + PAD;
          const maxY = Math.max(...lays.map((l) => l.y + l.height)) + PAD;
          const vw = window.innerWidth;
          const vh = window.innerHeight - 44;
          const scale = Math.min(1, Math.min(vw / maxX, vh / maxY) * 0.92);
          tf.current = {
            k: scale,
            x: (vw - maxX * scale) / 2,
            y: 44 + (vh - maxY * scale) / 2,
          };
          redraw((n) => n + 1);
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load schema'));
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = tf.current;
    const k = Math.min(4, Math.max(0.15, t.k * factor));
    tf.current = { k, x: mx - (mx - t.x) * (k / t.k), y: my - (my - t.y) * (k / t.k) };
    redraw((n) => n + 1);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    panning.current = true;
    panOrigin.current = { x: e.clientX - tf.current.x, y: e.clientY - tf.current.y };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!panning.current) return;
    tf.current = { ...tf.current, x: e.clientX - panOrigin.current.x, y: e.clientY - panOrigin.current.y };
    redraw((n) => n + 1);
  }, []);

  const onMouseUp = useCallback(() => { panning.current = false; }, []);

  if (error) {
    return <div className="flex items-center justify-center h-screen bg-white text-red-500 font-mono text-sm">{error}</div>;
  }
  if (!schema || layouts.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <span className="text-gray-400 font-mono text-sm animate-pulse">querying schema…</span>
      </div>
    );
  }

  const posMap = Object.fromEntries(layouts.map((l) => [l.name, l]));

  const relatedTo = highlighted
    ? new Set([
        highlighted,
        ...schema.foreignKeys
          .filter((fk) => fk.source_table === highlighted || fk.target_table === highlighted)
          .flatMap((fk) => [fk.source_table, fk.target_table]),
      ])
    : null;

  // Track arc indices for backwards lines to avoid stacking
  const backArcCount: Record<string, number> = {};

  const { x, y, k } = tf.current;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#f4f5f7]">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 h-11 z-20 flex items-center justify-between px-5 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Database Schema</span>
          <span className="text-xs text-gray-400">{schema.tables.length} tables · {schema.foreignKeys.length} relations</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 bg-white transition-colors"
            onClick={() => {
              const maxX = Math.max(...layouts.map((l) => l.x + l.width)) + PAD;
              const maxY = Math.max(...layouts.map((l) => l.y + l.height)) + PAD;
              const vw = window.innerWidth;
              const vh = window.innerHeight - 44;
              const scale = Math.min(1, Math.min(vw / maxX, vh / maxY) * 0.92);
              tf.current = { k: scale, x: (vw - maxX * scale) / 2, y: 44 + (vh - maxY * scale) / 2 };
              redraw((n) => n + 1);
            }}
          >
            fit
          </button>
          <button onClick={() => window.history.back()} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">← back</button>
        </div>
      </header>

      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: panning.current ? 'grabbing' : 'grab' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={() => setHighlighted(null)}
      >
        <defs>
          <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill="#9ca3af" />
          </marker>
          <marker id="arr-hi" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill="#3b5bdb" />
          </marker>
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.08" />
          </filter>
        </defs>

        <g transform={`translate(${x},${y + 44}) scale(${k})`}>
          {/* ── FK lines (drawn first, under cards) ── */}
          {schema.foreignKeys.map((fk, i) => {
            const src = posMap[fk.source_table];
            const tgt = posMap[fk.target_table];
            if (!src || !tgt || fk.source_table === fk.target_table) return null;

            const goingRight = tgt.col > src.col;
            const isHi = highlighted === fk.source_table || highlighted === fk.target_table;
            const isDim = highlighted && !isHi;

            let arcIdx = 0;
            if (!goingRight) {
              const key = [fk.source_table, fk.target_table].sort().join('|');
              arcIdx = backArcCount[key] ?? 0;
              backArcCount[key] = arcIdx + 1;
            }

            return (
              <path
                key={i}
                d={fkPath(src, fk.source_column, tgt, fk.target_column, arcIdx)}
                fill="none"
                stroke={isHi ? '#3b5bdb' : '#c3c8d4'}
                strokeWidth={isHi ? 2 : 1.5}
                opacity={isDim ? 0.12 : isHi ? 1 : 0.75}
                markerEnd={isHi ? 'url(#arr-hi)' : 'url(#arr)'}
                style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
              />
            );
          })}

          {/* ── Table cards ── */}
          {layouts.map((pos) => {
            const isHi = highlighted === pos.name;
            const isDim = relatedTo && !relatedTo.has(pos.name);

            return (
              <g
                key={pos.name}
                transform={`translate(${pos.x},${pos.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  setHighlighted((p) => (p === pos.name ? null : pos.name));
                }}
                style={{ cursor: 'pointer', opacity: isDim ? 0.2 : 1, transition: 'opacity 0.15s' }}
                filter="url(#shadow)"
              >
                {/* Card body */}
                <rect width={pos.width} height={pos.height} rx={6} fill="white" stroke={isHi ? '#3b5bdb' : '#e2e8f0'} strokeWidth={isHi ? 1.5 : 1} />

                {/* Header */}
                <rect width={pos.width} height={TH} rx={6} fill={isHi ? '#3b5bdb' : '#334155'} />
                <rect y={TH - 6} width={pos.width} height={6} fill={isHi ? '#3b5bdb' : '#334155'} />
                <text x={12} y={TH / 2 + 5} fill="white" fontSize={13} fontFamily="ui-monospace,monospace" fontWeight="600">{pos.name}</text>
                <text x={pos.width - 10} y={TH / 2 + 5} fill="rgba(255,255,255,0.45)" fontSize={10} fontFamily="ui-monospace,monospace" textAnchor="end">
                  {schema.rowCounts[pos.name]?.toLocaleString() ?? '0'} rows
                </text>

                {/* Column rows */}
                {pos.columns.map((col, ci) => {
                  const rowY = TH + ci * RH;
                  const isFKCol = schema.foreignKeys.some(
                    (fk) => fk.source_table === pos.name && fk.source_column === col.column_name,
                  );
                  const isPK =
                    col.column_name === 'id' ||
                    col.column_default?.includes('nextval') === true;

                  return (
                    <g key={col.column_name}>
                      {ci > 0 && <line x1={0} y1={rowY} x2={pos.width} y2={rowY} stroke="#f1f5f9" strokeWidth={1} />}

                      {/* PK / FK icon */}
                      {isPK && (
                        <text x={9} y={rowY + RH / 2 + 4} fontSize={10} fill="#f59e0b">⬡</text>
                      )}
                      {!isPK && isFKCol && (
                        <text x={9} y={rowY + RH / 2 + 4} fontSize={10} fill="#818cf8">◈</text>
                      )}

                      {/* Column name */}
                      <text
                        x={isPK || isFKCol ? 24 : 12}
                        y={rowY + RH / 2 + 4}
                        fill={isPK ? '#1e293b' : '#374151'}
                        fontSize={12}
                        fontFamily="ui-monospace,monospace"
                        fontWeight={isPK ? '600' : '400'}
                      >
                        {col.column_name}
                      </text>

                      {/* Type */}
                      <text
                        x={pos.width - 10}
                        y={rowY + RH / 2 + 4}
                        fill="#94a3b8"
                        fontSize={11}
                        fontFamily="ui-monospace,monospace"
                        textAnchor="end"
                      >
                        {shortType(col.data_type)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-4 left-5 flex items-center gap-4 text-xs text-gray-400 bg-white/90 border border-gray-200 rounded-lg px-4 py-2 backdrop-blur-sm">
        <span className="flex items-center gap-1"><span className="text-amber-400">⬡</span> primary key</span>
        <span className="flex items-center gap-1"><span className="text-indigo-400">◈</span> foreign key</span>
        <span>scroll to zoom · drag to pan · click to highlight</span>
      </div>
    </div>
  );
}
