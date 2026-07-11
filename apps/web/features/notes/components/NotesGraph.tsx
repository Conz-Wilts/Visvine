'use client'

// Obsidian-style canvas force graph for a brain: notes are dots (sized gently by
// degree), resolved OKF links are thin faint lines. A live d3-force simulation —
// seeded from the shared graphLayout engine so it only "breathes into place" —
// animates the settle; labels fade in below dots as you zoom; hovering a note
// lights it and its neighbors while the rest dims with a smooth tween. Nodes are
// draggable (the sim reheats and settles around them); positions aren't
// persisted, the graph re-settles on reload. Click a dot to open the note.

import { useEffect, useRef } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force'
import { layoutGraph } from '@/lib/graph-layout/graphLayout'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { prefersReducedMotion } from '@/lib/motion'
import { NOTES_GRAPH as C } from '@/components/graph/utils/constants'
import type { GraphData } from '@/lib/notes/shared/types'

interface SimNode extends SimulationNodeDatum {
  id: string
  label: string
  degree: number
  radius: number
}
interface SimLink {
  source: string | SimNode
  target: string | SimNode
}

interface NotesGraphProps {
  graph: GraphData
  selectedPath: string | null
  onOpenNote: (path: string) => void
}

interface Transform {
  x: number
  y: number
  k: number
}

type PointerMode =
  | { kind: 'idle' }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'press'; node: SimNode; startX: number; startY: number }
  | { kind: 'drag'; node: SimNode }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export function NotesGraph({ graph, selectedPath, onOpenNote }: NotesGraphProps) {
  const { theme } = useTheme()

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Hot state lives in refs so pointer/zoom/sim frames never re-render React.
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 })
  const minZoomRef = useRef(0.05)
  const fitKRef = useRef(1) // zoom of the fitted overview — label fade is relative to it
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map())
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)
  const revealedRef = useRef(false) // hide the pre-fit tick chaos
  // Until the user pans/zooms/drags, keep auto-fitting each tick so the settle
  // stays centered as the layout expands (Obsidian-style). First interaction
  // hands the camera over to the user for good.
  const interactedRef = useRef(false)
  const pointerRef = useRef<PointerMode>({ kind: 'idle' })
  const themeRef = useRef(theme)
  const selectedRef = useRef(selectedPath)

  // Hover dim/highlight tween. hoveredId sticks around while t fades back to 0
  // so the un-dim eases out instead of snapping.
  const hoverRef = useRef<{ t: number; target: number; hoveredId: string | null; neighbors: Set<string> }>({
    t: 0,
    target: 0,
    hoveredId: null,
    neighbors: new Set(),
  })

  const renderRafRef = useRef<number | null>(null)
  const simRafRef = useRef<number | null>(null)
  const hoverRafRef = useRef<number | null>(null)

  themeRef.current = theme
  selectedRef.current = selectedPath

  // ---- Render ---------------------------------------------------------------

  const renderRef = useRef<() => void>(() => {})
  renderRef.current = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!revealedRef.current || nodesRef.current.length === 0) return

    const { x: tx, y: ty, k } = transformRef.current
    ctx.translate(tx, ty)
    ctx.scale(k, k)

    // Theme colors resolved per frame so dark-mode / accent switches apply live.
    const styles = getComputedStyle(document.documentElement)
    const labelColor = styles.getPropertyValue('--color-text-secondary').trim() || '#374151'
    const linkColor = styles.getPropertyValue('--color-text-muted').trim() || '#6b7280'
    const isDark = document.documentElement.classList.contains('dark')
    const accent = themeRef.current.accent
    const selectedRing = isDark ? themeRef.current.accentLight : themeRef.current.accentDark

    const hover = hoverRef.current
    const t = hover.t
    const hoveredId = hover.hoveredId
    const neighbors = hover.neighbors

    // Viewport in graph coords, padded so labels/rings at the edge still draw.
    const pad = 120 / k
    const left = -tx / k - pad
    const top = -ty / k - pad
    const right = (width - tx) / k + pad
    const bottom = (height - ty) / k + pad

    // Links — two batched passes (dim, then highlighted) so stroke style is set
    // once per bucket instead of per line.
    ctx.lineWidth = Math.max(0.3, C.baseLinkWidth / k)
    const highlighted: SimLink[] = []
    ctx.strokeStyle = linkColor
    ctx.globalAlpha = hoveredId ? lerp(C.baseLinkAlpha, C.dimmedLinkAlpha, t) : C.baseLinkAlpha
    ctx.beginPath()
    for (const link of linksRef.current) {
      const s = link.source as SimNode
      const d = link.target as SimNode
      if (s.x == null || d.x == null) continue
      if (Math.max(s.x!, d.x!) < left || Math.min(s.x!, d.x!) > right) continue
      if (Math.max(s.y!, d.y!) < top || Math.min(s.y!, d.y!) > bottom) continue
      if (hoveredId && (s.id === hoveredId || d.id === hoveredId)) {
        highlighted.push(link)
        continue
      }
      ctx.moveTo(s.x!, s.y!)
      ctx.lineTo(d.x!, d.y!)
    }
    ctx.stroke()
    if (highlighted.length > 0) {
      ctx.strokeStyle = accent
      ctx.globalAlpha = lerp(C.baseLinkAlpha, C.highlightLinkAlpha, t)
      ctx.beginPath()
      for (const link of highlighted) {
        const s = link.source as SimNode
        const d = link.target as SimNode
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(d.x!, d.y!)
      }
      ctx.stroke()
    }

    // Nodes — plain filled dots, no halo. Selected note gets a theme ring.
    const fadeStartK = Math.min(fitKRef.current * C.labelFadeStartFitFactor, C.labelFadeStartMaxK)
    const fadeEndK = Math.min(fitKRef.current * C.labelFadeEndFitFactor, C.labelFadeEndMaxK)
    const zoomLabelAlpha = clamp01((k - fadeStartK) / Math.max(0.01, fadeEndK - fadeStartK))
    ctx.font = `${C.labelFontSize / k}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue
      if (n.x < left || n.x > right || n.y < top || n.y > bottom) continue

      const isHovered = n.id === hoveredId
      const isNeighbor = neighbors.has(n.id)
      const dimmed = hoveredId !== null && !isHovered && !isNeighbor
      const nodeAlpha = dimmed ? lerp(1, C.dimmedNodeAlpha, t) : 1
      const r = isHovered ? n.radius * lerp(1, C.hoverScale, t) : n.radius

      ctx.globalAlpha = nodeAlpha
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (n.id === selectedRef.current) {
        ctx.strokeStyle = selectedRing
        ctx.lineWidth = Math.max(0.5, 2 / k)
        ctx.stroke()
      }

      // Label below the dot: zoom-faded, always visible for the hovered note.
      let labelAlpha = zoomLabelAlpha
      if (isHovered) labelAlpha = Math.max(labelAlpha, t)
      else if (dimmed) labelAlpha *= lerp(1, C.dimmedNodeAlpha, t)
      if (labelAlpha < 0.02) continue
      ctx.globalAlpha = labelAlpha
      ctx.fillStyle = labelColor
      ctx.fillText(n.label, n.x, n.y + r + C.labelOffsetY / k)
    }
    ctx.globalAlpha = 1
  }

  const scheduleRenderRef = useRef<() => void>(() => {})
  scheduleRenderRef.current = () => {
    if (renderRafRef.current !== null) return
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = null
      renderRef.current()
    })
  }

  // ---- Camera ---------------------------------------------------------------

  const fitToScreenRef = useRef<() => void>(() => {})
  fitToScreenRef.current = () => {
    const canvas = canvasRef.current
    const nodes = nodesRef.current
    if (!canvas || nodes.length === 0) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    if (width === 0 || height === 0) return

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    if (!isFinite(minX)) return
    const pad = 60
    const k = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY), 1.4)
    minZoomRef.current = Math.min(0.05, k * 0.8)
    fitKRef.current = k
    transformRef.current = {
      x: width / 2 - ((minX + maxX) / 2) * k,
      y: height / 2 - ((minY + maxY) / 2) * k,
      k,
    }
    scheduleRenderRef.current()
  }

  // ---- Simulation loop ------------------------------------------------------

  const startSimLoopRef = useRef<() => void>(() => {})
  startSimLoopRef.current = () => {
    if (simRafRef.current !== null) return
    let ticks = revealedRef.current ? C.ticksBeforeReveal : 0
    const step = () => {
      const sim = simRef.current
      if (!sim) {
        simRafRef.current = null
        return
      }
      sim.tick()
      ticks++
      if (!revealedRef.current && ticks >= C.ticksBeforeReveal) {
        fitToScreenRef.current()
        revealedRef.current = true
      } else if (revealedRef.current && !interactedRef.current) {
        // Track the expanding layout until the user takes the camera.
        fitToScreenRef.current()
      }
      if (revealedRef.current) scheduleRenderRef.current()
      // Keep ticking while hot or while a drag holds alphaTarget above zero.
      if (sim.alpha() > C.alphaMin || sim.alphaTarget() > 0) {
        simRafRef.current = requestAnimationFrame(step)
      } else {
        simRafRef.current = null
      }
    }
    simRafRef.current = requestAnimationFrame(step)
  }

  // ---- Hover tween ----------------------------------------------------------

  const startHoverTweenRef = useRef<() => void>(() => {})
  startHoverTweenRef.current = () => {
    if (hoverRafRef.current !== null) return
    const from = hoverRef.current.t
    const target = hoverRef.current.target
    const start = performance.now()
    const step = (now: number) => {
      const hover = hoverRef.current
      if (hover.target !== target) {
        // Target flipped mid-tween — restart from the current t for continuity.
        hoverRafRef.current = null
        startHoverTweenRef.current()
        return
      }
      const progress = clamp01((now - start) / C.hoverTransitionMs)
      hover.t = lerp(from, target, easeOutCubic(progress))
      scheduleRenderRef.current()
      if (progress < 1) {
        hoverRafRef.current = requestAnimationFrame(step)
      } else {
        hoverRafRef.current = null
        if (hover.target === 0) {
          hover.hoveredId = null
          hover.neighbors = new Set()
          scheduleRenderRef.current()
        }
      }
    }
    hoverRafRef.current = requestAnimationFrame(step)
  }

  const setHoveredRef = useRef<(id: string | null) => void>(() => {})
  setHoveredRef.current = (id) => {
    const hover = hoverRef.current
    if (id === (hover.target === 0 ? null : hover.hoveredId)) return
    if (id) {
      hover.hoveredId = id
      hover.neighbors = adjacencyRef.current.get(id) ?? new Set()
      hover.target = 1
    } else {
      hover.target = 0
    }
    if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab'
    if (prefersReducedMotion()) {
      hover.t = hover.target
      if (hover.target === 0) {
        hover.hoveredId = null
        hover.neighbors = new Set()
      }
      scheduleRenderRef.current()
      return
    }
    startHoverTweenRef.current()
  }

  // ---- Build the simulation when the graph changes ---------------------------

  useEffect(() => {
    revealedRef.current = false
    interactedRef.current = false
    simRef.current?.stop()
    simRef.current = null
    if (simRafRef.current !== null) {
      cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }
    hoverRef.current = { t: 0, target: 0, hoveredId: null, neighbors: new Set() }
    pointerRef.current = { kind: 'idle' }

    if (graph.nodes.length === 0) {
      nodesRef.current = []
      linksRef.current = []
      adjacencyRef.current = new Map()
      scheduleRenderRef.current()
      return
    }

    // Seed positions from the deterministic layout engine so the live sim only
    // has to relax, not untangle — the settle reads as a short breathe-in and
    // the layout stays stable-ish across visits.
    const radiusOf = (degree: number) => Math.min(C.maxRadius, C.minRadius + Math.sqrt(degree) * 1.5)
    const seed = layoutGraph(
      graph.nodes.map((n) => ({ id: n.id, r: radiusOf(n.degree) })),
      graph.links.map((l) => ({ source: l.source, target: l.target })),
      { width: 1000, height: 700, idealEdgeLength: C.linkDistance, nodePadding: 4 },
    )
    const seedPos = new Map(seed.nodes.map((p) => [String(p.id), p]))

    // Center the seed on the origin — forceX/forceY pull toward (0,0), so an
    // off-center seed would slowly slide the whole graph after the initial fit.
    let cx = 0
    let cy = 0
    for (const p of seed.nodes) {
      cx += p.x
      cy += p.y
    }
    cx /= seed.nodes.length
    cy /= seed.nodes.length

    const nodes: SimNode[] = graph.nodes.map((n) => {
      const p = seedPos.get(n.id)
      return {
        id: n.id,
        label: n.label,
        degree: n.degree,
        radius: radiusOf(n.degree),
        x: (p?.x ?? cx) - cx,
        y: (p?.y ?? cy) - cy,
      }
    })
    // Fresh link objects every run: d3's forceLink mutates source/target from id
    // strings into node-object references and never re-resolves them, so reusing
    // the props array across rebuilds would leave links bound to stale nodes.
    const links: SimLink[] = graph.links.map((l) => ({ source: l.source, target: l.target }))

    const adjacency = new Map<string, Set<string>>()
    for (const l of graph.links) {
      if (!adjacency.has(l.source)) adjacency.set(l.source, new Set())
      if (!adjacency.has(l.target)) adjacency.set(l.target, new Set())
      adjacency.get(l.source)!.add(l.target)
      adjacency.get(l.target)!.add(l.source)
    }

    nodesRef.current = nodes
    linksRef.current = links
    adjacencyRef.current = adjacency

    const sim = forceSimulation<SimNode>(nodes)
      .alpha(C.alpha)
      .alphaDecay(C.alphaDecay)
      .alphaMin(C.alphaMin)
      .velocityDecay(C.velocityDecay)
      .force(
        'link',
        forceLink<SimNode, SimLink & { index?: number }>(links)
          .id((d) => d.id)
          .distance(C.linkDistance)
          .strength(C.linkStrength),
      )
      .force('charge', forceManyBody<SimNode>().strength(C.chargeStrength).distanceMax(C.chargeDistanceMax))
      .force('x', forceX<SimNode>(0).strength(C.centerStrength))
      .force('y', forceY<SimNode>(0).strength(C.centerStrength))
      .force('collide', forceCollide<SimNode>((d) => d.radius + C.collidePadding))
      .stop()
    simRef.current = sim

    if (prefersReducedMotion()) {
      // No settle animation: run the sim to completion synchronously and show
      // the final layout in one frame.
      while (sim.alpha() > C.alphaMin) sim.tick()
      // Fit after the canvas has been measured (rAF runs post-mount-effects).
      requestAnimationFrame(() => {
        fitToScreenRef.current()
        revealedRef.current = true
        scheduleRenderRef.current()
      })
      return () => {
        sim.stop()
      }
    }

    startSimLoopRef.current()
    return () => {
      sim.stop()
      if (simRafRef.current !== null) {
        cancelAnimationFrame(simRafRef.current)
        simRafRef.current = null
      }
    }
  }, [graph])

  // Re-render on theme / selection changes (values already mirrored into refs).
  useEffect(() => {
    scheduleRenderRef.current()
  }, [theme, selectedPath])

  // ---- Canvas sizing (DPR-aware) ---------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let prevWidth = 0
    let prevHeight = 0
    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = container.getBoundingClientRect()
      if (width === 0 || height === 0) return
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = width * dpr
      canvas.height = height * dpr
      // Refit only on real resizes — the initial measurement must not stomp the
      // fit the sim loop performs at reveal time.
      const sizeChanged = prevWidth !== 0 && (width !== prevWidth || height !== prevHeight)
      prevWidth = width
      prevHeight = height
      if (sizeChanged && revealedRef.current) fitToScreenRef.current()
      else scheduleRenderRef.current()
    }
    updateCanvasSize()
    const observer = new ResizeObserver(updateCanvasSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // ---- Zoom (native non-passive wheel, zoom-to-cursor) ------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      interactedRef.current = true
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.005)
      const prev = transformRef.current
      const k = Math.max(minZoomRef.current, Math.min(prev.k * factor, 8))
      // Keep the graph point under the cursor fixed while the scale changes.
      const gx = (mouseX - prev.x) / prev.k
      const gy = (mouseY - prev.y) / prev.k
      transformRef.current = { x: mouseX - gx * k, y: mouseY - gy * k, k }
      // Wheel doesn't fire mousemove, so re-resolve what's under the cursor —
      // otherwise a hover highlight goes stale the moment the zoom changes.
      setHoveredRef.current(hitTestRef.current(e.clientX, e.clientY)?.id ?? null)
      scheduleRenderRef.current()
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  // Swallow ctrl+wheel page zoom anywhere while the graph is mounted — a
  // trackpad pinch whose centroid lands just off-canvas would otherwise zoom
  // the whole page, which scrolling over the graph can't undo.
  useEffect(() => {
    const handlePinchZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault()
    }
    window.addEventListener('wheel', handlePinchZoom, { passive: false })
    return () => window.removeEventListener('wheel', handlePinchZoom)
  }, [])

  // ---- Pointer: hover / pan / click / drag ------------------------------------

  const hitTest = (clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { x, y, k } = transformRef.current
    const gx = (clientX - rect.left - x) / k
    const gy = (clientY - rect.top - y) / k
    const slop = C.hoverHitPadding / k
    let best: SimNode | null = null
    let bestDist = Infinity
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue
      const dx = gx - n.x
      const dy = gy - n.y
      const distSq = dx * dx + dy * dy
      const hitR = n.radius + slop
      if (distSq <= hitR * hitR && distSq < bestDist) {
        best = n
        bestDist = distSq
      }
    }
    return best
  }
  const hitTestRef = useRef(hitTest)
  hitTestRef.current = hitTest

  const toGraphCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { x, y, k } = transformRef.current
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const node = hitTest(e.clientX, e.clientY)
    if (node) {
      pointerRef.current = { kind: 'press', node, startX: e.clientX, startY: e.clientY }
    } else {
      interactedRef.current = true
      pointerRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const pointer = pointerRef.current
    if (pointer.kind === 'pan') {
      const t = transformRef.current
      transformRef.current = { ...t, x: t.x + e.clientX - pointer.lastX, y: t.y + e.clientY - pointer.lastY }
      pointerRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
      scheduleRenderRef.current()
      return
    }
    if (pointer.kind === 'press') {
      const moved = Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY)
      if (moved > C.clickSlopPx) {
        // Promote to drag: pin the node to the pointer and reheat the sim so
        // its neighborhood follows live.
        interactedRef.current = true
        const g = toGraphCoords(e.clientX, e.clientY)
        pointer.node.fx = g.x
        pointer.node.fy = g.y
        simRef.current?.alphaTarget(C.dragAlphaTarget)
        pointerRef.current = { kind: 'drag', node: pointer.node }
        startSimLoopRef.current()
      }
      return
    }
    if (pointer.kind === 'drag') {
      const g = toGraphCoords(e.clientX, e.clientY)
      pointer.node.fx = g.x
      pointer.node.fy = g.y
      startSimLoopRef.current()
      return
    }
    setHoveredRef.current(hitTest(e.clientX, e.clientY)?.id ?? null)
  }

  const endPointer = (e: React.MouseEvent, opened: boolean) => {
    const pointer = pointerRef.current
    if (pointer.kind === 'press' && opened) {
      onOpenNote(pointer.node.id)
    } else if (pointer.kind === 'drag') {
      pointer.node.fx = null
      pointer.node.fy = null
      simRef.current?.alphaTarget(0)
    }
    pointerRef.current = { kind: 'idle' }
    // Re-evaluate hover at the release point — the sim may have moved the node
    // out from under the cursor, and pan/drag suppressed hover updates.
    const under = hitTest(e.clientX, e.clientY)
    setHoveredRef.current(under?.id ?? null)
    if (canvasRef.current) canvasRef.current.style.cursor = under ? 'pointer' : 'grab'
  }

  const onMouseUp = (e: React.MouseEvent) => endPointer(e, true)
  const onMouseLeave = (e: React.MouseEvent) => {
    endPointer(e, false)
    setHoveredRef.current(null)
  }

  // ---- Teardown ----------------------------------------------------------------

  useEffect(() => {
    return () => {
      simRef.current?.stop()
      for (const ref of [renderRafRef, simRafRef, hoverRafRef]) {
        if (ref.current !== null) cancelAnimationFrame(ref.current)
        ref.current = null
      }
    }
  }, [])

  return (
    <div className="flex h-full">
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-grab"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
        {graph.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-muted">
            No notes to graph in this view.
          </div>
        )}
      </div>
    </div>
  )
}
