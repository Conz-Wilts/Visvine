'use client'

// The force-directed link graph for a brain: notes are nodes (sized by degree),
// resolved OKF links are edges. Positions come from the shared graphLayout engine
// — the same deterministic PivotMDS → Barnes-Hut → zero-overlap → component-packing
// pipeline the main directory graph uses — rendered as SVG so labels + clicks are
// simple at note-scale. The whole brain is rendered; click a node to open the note.

import { useEffect, useMemo, useRef, useState } from 'react'
import { layoutGraph } from '@/lib/graph-layout/graphLayout'
import { useTheme } from '@/lib/contexts/ThemeContext'
import type { GraphData } from '@/lib/notes/shared/types'

interface GNode {
  id: string
  label: string
  degree: number
  x: number
  y: number
}
interface GLink {
  source: GNode
  target: GNode
}

interface NotesGraphProps {
  graph: GraphData
  selectedPath: string | null
  onOpenNote: (path: string) => void
}

const WIDTH = 1000
const HEIGHT = 700

function layout(data: GraphData): { nodes: GNode[]; links: GLink[] } {
  if (data.nodes.length === 0) return { nodes: [], links: [] }

  // Model each dot as its collision radius (>= the render radius below) so the
  // engine's zero-overlap guarantee covers the drawn circles. Labels extend
  // rightward and aren't modelled — same as the old forceCollide, so no regression.
  const result = layoutGraph(
    data.nodes.map((n) => ({ id: n.id, r: 10 + Math.sqrt(n.degree) * 4 })),
    data.links.map((l) => ({ source: l.source, target: l.target })),
    {
      width: WIDTH,
      height: HEIGHT,
      idealEdgeLength: 70, // matches the old forceLink .distance(70) feel
      nodePadding: 10, // a little breathing room between dots
      // No `seed`: the engine auto-derives a deterministic seed from the node ids.
    },
  )

  const byInput = new Map(data.nodes.map((n) => [n.id, n]))
  const nodes: GNode[] = result.nodes.map((p) => {
    const src = byInput.get(String(p.id))!
    return { id: src.id, label: src.label, degree: src.degree, x: p.x, y: p.y }
  })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: GLink[] = data.links
    .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! }))
    .filter((l) => l.source && l.target)

  return { nodes, links }
}

export function NotesGraph({ graph, selectedPath, onOpenNote }: NotesGraphProps) {
  // Note dots use the active theme accent (the user's selected primary colour),
  // not a hardcoded green, so the graph matches the rest of the app's theme.
  const { theme } = useTheme()
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const { nodes, links } = useMemo(() => layout(graph), [graph])

  // Fit the laid-out graph into the viewport whenever it changes.
  useEffect(() => {
    if (nodes.length === 0) {
      setTransform({ x: 0, y: 0, k: 1 })
      return
    }
    const xs = nodes.map((n) => n.x ?? 0)
    const ys = nodes.map((n) => n.y ?? 0)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = 60
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    const k = Math.min(WIDTH / w, HEIGHT / h, 1.4)
    setTransform({ x: WIDTH / 2 - ((minX + maxX) / 2) * k, y: HEIGHT / 2 - ((minY + maxY) / 2) * k, k })
  }, [nodes])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setTransform((t) => ({ ...t, k: Math.max(0.2, Math.min(4, t.k * factor)) }))
  }

  return (
    <div className="flex h-full">
      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            No notes to graph in this view.
          </div>
        ) : (
          <svg
            className="h-full w-full cursor-grab active:cursor-grabbing"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onWheel={onWheel}
            onMouseDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY }
            }}
            onMouseMove={(e) => {
              if (!dragRef.current) return
              const dx = e.clientX - dragRef.current.x
              const dy = e.clientY - dragRef.current.y
              dragRef.current = { x: e.clientX, y: e.clientY }
              setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
            }}
            onMouseUp={() => (dragRef.current = null)}
            onMouseLeave={() => (dragRef.current = null)}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {links.map((l, i) => (
                <line
                  key={i}
                  x1={l.source.x}
                  y1={l.source.y}
                  x2={l.target.x}
                  y2={l.target.y}
                  stroke="#d1d5db"
                  strokeWidth={1}
                />
              ))}
              {nodes.map((n) => {
                const r = 5 + Math.sqrt(n.degree) * 3
                const isSelected = n.id === selectedPath
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenNote(n.id)
                    }}
                  >
                    <circle
                      r={r}
                      fill={isSelected ? theme.accentDark : theme.accent}
                      stroke={isSelected ? '#111827' : '#ffffff'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <text
                      x={r + 3}
                      y={4}
                      fontSize={11}
                      fill="#374151"
                      className="pointer-events-none select-none"
                    >
                      {n.label}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
