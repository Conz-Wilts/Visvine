'use client'

// The force-directed link graph for a brain: notes are nodes (sized by degree),
// resolved OKF links are edges. Layout is a one-shot d3-force run (d3-force is
// already a Visvine dep), rendered as SVG so labels + clicks are simple at
// note-scale. The whole brain is rendered; click a node to open the note.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force'
import type { GraphData } from '@/lib/notes/shared/types'

interface GNode extends SimulationNodeDatum {
  id: string
  label: string
  degree: number
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
  const nodes: GNode[] = data.nodes.map((n) => ({ id: n.id, label: n.label, degree: n.degree }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: GLink[] = data.links
    .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! }))
    .filter((l) => l.source && l.target)

  const sim = forceSimulation(nodes)
    .force('link', forceLink<GNode, GLink>(links).id((d) => d.id).distance(70).strength(0.6))
    .force('charge', forceManyBody().strength(-220))
    .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
    .force('collide', forceCollide<GNode>().radius((d) => 10 + Math.sqrt(d.degree) * 4))
    .stop()

  const ticks = Math.min(400, Math.max(120, nodes.length * 6))
  for (let i = 0; i < ticks; i++) sim.tick()
  return { nodes, links }
}

export function NotesGraph({ graph, selectedPath, onOpenNote }: NotesGraphProps) {
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
                      fill={isSelected ? '#2f7a3e' : '#78d870'}
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
