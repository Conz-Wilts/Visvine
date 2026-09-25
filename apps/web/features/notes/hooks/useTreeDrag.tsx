'use client'

// Drag-to-move for the context tree, on pointer events rather than the
// browser's drag-and-drop. Native DnD hands the ghost image and the end of the
// gesture to the browser: nothing can follow the pointer smoothly, settle into
// the place it was dropped, or fly home when the drop is refused — and a drop
// here can be refused AFTER it is made (the access popup's Cancel, the server's
// 403). So the engine owns the whole gesture, and it reads like a sortable list:
//
//   press   a row is pressed; nothing happens until the pointer travels 4px,
//           so a click is still a click.
//   lift    the row ITSELF comes up off the tree — a copy of it, the same size,
//           raised on a shadow — and stays under the pointer by the point it
//           was grabbed at. Where it was, the tree keeps a SLOT: an empty place
//           the size of the row.
//   drag    every frame the pointer is resolved to a place BETWEEN rows — a
//           folder and an index in it. Over the top half of a row that is
//           before it, over the bottom half after it; over a folder it is
//           inside that folder. The host draws the slot there and useTreeFlip
//           slides every other row to make room, so rows trade places with the
//           held one as it passes them. Resting on a shut folder springs it
//           open, and the host shuts it again once the pointer has left. Near
//           the top or bottom edge the tree scrolls. Where the item may not go
//           (the host's verdict) the slot waits at home and the lift says why.
//   drop    the lift settles into the slot and the host performs the move
//           (which may ask first); released anywhere else, it flies home.
//
// A tree that re-lays itself out under a still pointer would chase its own
// tail — the slot moves, so a different row is under the pointer, so the slot
// moves back. Two things stop that. Rows are hit-tested where they are LAID
// OUT, not where a slide currently shows them (the running transform is taken
// back off), which is what sortable lists get from rects measured up front. And
// "after this row" and "before the next" are the same place, so the row that
// slides under the pointer answers what the one that left did. On top of both,
// the place is only re-read when the POINTER has moved (or the drag scrolled).
//
// The lift is moved by writing its transform directly; React state changes
// only when the item, the place or the refusal reason does.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from '@visvine/tokens'
import type { TreeNode } from '@/lib/notes/shared/types'

/** A row the tree can move: a note, a folder (with everything under it), or a
 *  structural folder that is PLACED rather than moved — a built-in folder or
 *  a sub-space, whose path stays put while the tree draws it elsewhere
 *  (lib/notes/shared/placedFolders.ts). */
export interface TreeDragItem {
  /** What a note declares (`TreeNode.declares`) — a connector moves where a connector may. */
  declares?: TreeNode['declares']
  path: string
  kind: 'note' | 'folder' | 'placed'
  label: string
}

/** Whether the item may be dropped into a folder. `reason: null` is a quiet
 *  no, which the lift doesn't remark on. */
export type DropVerdict = { ok: true } | { ok: false; reason: string | null }

/** A place between rows: before the `index`-th row of `folder` as the tree
 *  draws it WITHOUT the held row ('' = the top; index = row count → the end). */
export interface TreeSlot {
  folder: string
  index: number
}

interface Options {
  /** The tree's scrollport: the bounds of the drop surface, and what auto-scrolls. */
  scrollRef: React.RefObject<HTMLDivElement | null>
  verdict: (item: TreeDragItem, folder: string) => DropVerdict
  /** Perform the move. `index` is null when the folder was shut — the item just
   *  goes in. The gesture ends when this settles, whichever way it went. */
  onDrop: (item: TreeDragItem, folder: string, index: number | null) => Promise<void>
  /** The pointer has rested on a shut folder. */
  onSpring: (folder: string) => void
  /** The folder under the pointer changed — legal or not, null outside the
   *  tree. The host shuts the folders it sprang open that this has left. */
  onHover: (folder: string | null) => void
  /** The gesture is over, however it went. */
  onEnd: () => void
}

/** The row under the pointer and where it sat on the last frame, so the host
 *  can hold it still when a folder opens or shuts (useTreeFlip). */
export interface DragProbe {
  el: Element | null
  top: number
  scrollTop: number
}

const THRESHOLD = 4
const SPRING_MS = 350
/** How far the pointer must travel before the place is read again. */
const RETARGET = 2
/** How close to the scrollport's top/bottom edge the tree starts to scroll, and how fast at the edge. */
const EDGE = 40
const MAX_SCROLL = 14
/** How far the lift stands in from the panel's edges. */
const INSET = 6
const SETTLE_MS = 180
const SETTLE_EASING = motion.easeCss.settle

/** Where the pointer puts the item: a folder, and a place in it (null = the
 *  folder is shut, so there is nowhere to show one). */
interface Dest {
  folder: string
  index: number | null
}

/** The lift's box, and where the row's own (bled) box sits inside it. */
interface LiftBox {
  width: number
  height: number
  rowLeft: number
  rowWidth: number
}

interface Session {
  item: TreeDragItem
  phase: 'drag' | 'settling' | 'dropped'
  pointer: { x: number; y: number }
  /** The pointer's offset inside the lift, fixed at the grab. */
  grab: { x: number; y: number }
  pos: { x: number; y: number }
  home: TreeSlot | null
  /** What is under the pointer, legal or not. */
  dest: Dest | null
  ok: boolean
  springPath: string | null
  springTimer: number | null
  /** Where the pointer was when the place was last read (null = read it now). */
  readAt: { x: number; y: number } | null
}

interface Reading {
  row: HTMLElement | null
  /** Places to try, in order of preference. */
  tries: Dest[]
  spring: string | null
  /** The pointer is on the slot itself: nothing changes. */
  keep: boolean
}

/** A row's box where it is LAID OUT: a slide still running is taken back off. */
function laidOut(row: HTMLElement): { top: number; bottom: number } {
  const r = row.getBoundingClientRect()
  if (row.getAnimations().length === 0) return { top: r.top, bottom: r.bottom }
  const dy = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42
  return { top: r.top - dy, bottom: r.bottom - dy }
}

function slotOf(row: HTMLElement): TreeSlot | null {
  const { slotParent, slotIndex } = row.dataset
  return slotParent === undefined || slotIndex === undefined ? null : { folder: slotParent, index: Number(slotIndex) }
}

/** What the point under the pointer means. */
function read(pointer: { x: number; y: number }, sc: HTMLDivElement, item: string, hasHome: boolean): Reading {
  const y = pointer.y
  // Every place is counted WITHOUT the held row. Until the tree has taken it
  // out (the render after the grab), the rows still count it: wait.
  const own = sc.querySelector<HTMLElement>(`[data-tree-item="${CSS.escape(item)}"]`)
  if (own && hasHome) return { row: null, tries: [], spring: null, keep: true }
  const held = sc.querySelector<HTMLElement>('[data-drop-slot]')
  if (held) {
    const b = laidOut(held)
    if (y >= b.top && y < b.bottom) return { row: null, tries: [], spring: null, keep: true }
  }
  /** The end of each folder, as drawn: one past its last row's index. */
  const ends = new Map<string, number>()
  let hit: { row: HTMLElement; frac: number } | null = null
  for (const row of sc.querySelectorAll<HTMLElement>('[data-tree-item]')) {
    const at = slotOf(row)
    if (at) ends.set(at.folder, Math.max(ends.get(at.folder) ?? 0, at.index + 1))
    if (hit) continue
    // A row with no place of its own stays in the tree while it is held;
    // over itself is nowhere new.
    if (row === own) {
      const b = laidOut(row)
      if (y >= b.top && y < b.bottom) return { row: null, tries: [], spring: null, keep: true }
      continue
    }
    const b = laidOut(row)
    if (y >= b.top && y < b.bottom) hit = { row, frac: (y - b.top) / Math.max(1, b.bottom - b.top) }
  }
  if (!hit) {
    // Not on a row: the blank below the tree, an open folder's "Empty" line.
    // The zone says which folder; the item goes to its end.
    const under = document.elementFromPoint(pointer.x, pointer.y)
    const zone = under && sc.contains(under) ? (under.closest('[data-drop-folder], [data-drop-none]') as HTMLElement | null) : null
    const folder = zone?.dataset.dropFolder
    return { row: null, tries: folder === undefined ? [] : [{ folder, index: ends.get(folder) ?? 0 }], spring: null, keep: false }
  }

  const { row, frac } = hit
  const at = slotOf(row)
  const before: Dest[] = at ? [{ folder: at.folder, index: at.index }] : []
  const after: Dest[] = at ? [{ folder: at.folder, index: at.index + 1 }] : []
  const folder = row.dataset.folderRow
  if (folder === undefined) return { row, tries: frac < 0.5 ? before : after, spring: null, keep: false }
  // A folder row: its edges are places beside it, the rest of it is INSIDE.
  // Open, its first place is right below the row, so only the top edge is
  // "before"; shut, it has an edge either side. Either way a folder that won't
  // take the item is a row to pass like any other.
  const inside: Dest = { folder, index: row.dataset.folderOpen !== undefined ? 0 : null }
  if (inside.index === 0) return { row, tries: frac < 0.3 ? [...before, inside] : [inside, ...before], spring: null, keep: false }
  const edge = frac < 0.25 ? before : frac > 0.75 ? after : []
  if (edge.length) return { row, tries: [...edge, inside], spring: null, keep: false }
  return { row, tries: [inside, ...(frac < 0.5 ? before : after)], spring: row.dataset.springFolder ?? null, keep: false }
}

export function useTreeDrag(options: Options) {
  const opts = useRef(options)
  opts.current = options

  const [dragging, setDragging] = useState<TreeDragItem | null>(null)
  const [slot, setSlot] = useState<TreeSlot | null>(null)
  const [intoFolder, setIntoFolder] = useState<string | null>(null)
  const [away, setAway] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [dropped, setDropped] = useState(false)
  const [box, setBox] = useState<LiftBox | null>(null)

  const session = useRef<Session | null>(null)
  const liftRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const source = useRef<HTMLElement | null>(null)
  const raf = useRef(0)
  const teardown = useRef<(() => void) | null>(null)
  const probe = useRef<DragProbe>({ el: null, top: 0, scrollTop: 0 })

  const place = (s: Session) => {
    if (liftRef.current) liftRef.current.style.transform = `translate3d(${s.pos.x}px, ${s.pos.y}px, 0)`
  }

  const clearSpring = (s: Session) => {
    if (s.springTimer !== null) window.clearTimeout(s.springTimer)
    s.springTimer = null
    s.springPath = null
  }

  const end = useCallback(() => {
    const s = session.current
    if (s) clearSpring(s)
    session.current = null
    source.current = null
    cancelAnimationFrame(raf.current)
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('cursor')
    setDragging(null)
    setSlot(null)
    setIntoFolder(null)
    setAway(false)
    setReason(null)
    setDropped(false)
    setBox(null)
    probe.current = { el: null, top: 0, scrollTop: 0 }
    opts.current.onEnd()
  }, [])

  // The lift is the row itself: a copy of its DOM, so it looks exactly like
  // what was picked up — minus the tree's strokes and the row's menu, which
  // belong to where it WAS.
  useLayoutEffect(() => {
    const holder = holderRef.current
    const row = source.current
    if (!dragging || !box || !holder || !row || holder.firstChild) return
    const copy = row.cloneNode(true) as HTMLElement
    for (const el of copy.querySelectorAll('[data-no-drag]')) el.remove()
    for (const el of copy.querySelectorAll<HTMLElement>('[data-tree-guide]')) el.style.visibility = 'hidden'
    for (const el of copy.querySelectorAll('.tree-line')) el.remove()
    for (const name of copy.getAttributeNames()) if (name.startsWith('data-')) copy.removeAttribute(name)
    copy.classList.remove('tree-row-held', 'tree-row-land')
    Object.assign(copy.style, {
      position: 'absolute',
      top: '0',
      left: `${box.rowLeft}px`,
      width: `${box.rowWidth}px`,
      height: `${box.height}px`,
      margin: '0',
    })
    holder.appendChild(copy)
    const s = session.current
    if (s) place(s)
  }, [dragging, box])

  const tick = useCallback(() => {
    const s = session.current
    if (!s || s.phase !== 'drag') return
    const sc = opts.current.scrollRef.current

    // The tree scrolls under a pointer held near its top or bottom edge, faster
    // the closer it is. Scrolling moves the rows under a still pointer on
    // purpose, so it counts as movement: the place is read again.
    let inside = false
    if (sc) {
      const b = sc.getBoundingClientRect()
      const across = s.pointer.x >= b.left && s.pointer.x <= b.right
      inside = across && s.pointer.y >= b.top && s.pointer.y <= b.bottom
      if (across) {
        const up = b.top + EDGE - s.pointer.y
        const down = s.pointer.y - (b.bottom - EDGE)
        const by =
          up > 0 && up <= EDGE * 2
            ? -Math.ceil((Math.min(up, EDGE) / EDGE) * MAX_SCROLL)
            : down > 0 && down <= EDGE * 2
              ? Math.ceil((Math.min(down, EDGE) / EDGE) * MAX_SCROLL)
              : 0
        if (by !== 0) {
          const before = sc.scrollTop
          sc.scrollTop += by
          if (sc.scrollTop !== before) s.readAt = null
        }
      }
    }

    const moved = !s.readAt || Math.hypot(s.pointer.x - s.readAt.x, s.pointer.y - s.readAt.y) >= RETARGET
    if (moved && sc) {
      s.readAt = { ...s.pointer }
      const found: Reading = inside ? read(s.pointer, sc, s.item.path, s.home !== null) : { row: null, tries: [], spring: null, keep: false }
      if (found.row) probe.current = { el: found.row, top: found.row.getBoundingClientRect().top, scrollTop: sc.scrollTop }
      else if (!found.keep) probe.current = { el: null, top: 0, scrollTop: sc.scrollTop }

      // Waiting on the tree: read again next frame, moved or not.
      if (found.keep && found.tries.length === 0 && s.dest === null) s.readAt = null
      if (!found.keep) {
        // The first place the item may go wins; if none will have it, the
        // first says why.
        let dest: Dest | null = null
        let ok = false
        let why: string | null = null
        for (const [i, t] of found.tries.entries()) {
          const v = opts.current.verdict(s.item, t.folder)
          if (v.ok) {
            dest = t
            ok = true
            why = null
            break
          }
          if (i === 0) {
            dest = t
            why = v.reason
          }
        }
        const was = s.dest
        const same =
          (was?.folder ?? null) === (dest?.folder ?? null) && (was?.index ?? null) === (dest?.index ?? null) && s.ok === ok
        if (!same) {
          if ((was?.folder ?? null) !== (dest?.folder ?? null)) opts.current.onHover(dest?.folder ?? null)
          s.dest = dest
          s.ok = ok
          // Legal with a place → the slot goes there. Legal but shut → the row
          // is in hand and the folder lights up. Not legal → the slot waits at home.
          const next = ok ? (dest!.index === null ? null : { folder: dest!.folder, index: dest!.index }) : s.home
          setSlot((prev) => (prev?.folder === next?.folder && prev?.index === next?.index ? prev : next))
          setIntoFolder(ok && dest!.index === null ? dest!.folder : null)
          setAway(ok || s.home !== null)
          setReason(ok ? null : why)
        }

        // Resting on a shut folder opens it, so a drop can reach inside without
        // letting go first — whether or not that folder itself would take the
        // item (`people` won't, the person inside it will).
        if (found.spring !== s.springPath) {
          clearSpring(s)
          const shut = found.spring
          if (shut !== null) {
            s.springPath = shut
            s.springTimer = window.setTimeout(() => {
              s.springTimer = null
              s.springPath = null
              // Open now, it has a first place: read the point again.
              s.readAt = null
              opts.current.onSpring(shut)
            }, SPRING_MS)
          }
        }
      }
    } else if (sc && probe.current.el?.isConnected) {
      probe.current = { ...probe.current, top: probe.current.el.getBoundingClientRect().top, scrollTop: sc.scrollTop }
    }

    s.pos = { x: s.pointer.x - s.grab.x, y: s.pointer.y - s.grab.y }
    place(s)
    raf.current = requestAnimationFrame(tick)
  }, [])

  /** Bring the lift down onto the slot (or fade it where there is none). */
  const settle = useCallback(async (s: Session) => {
    const lift = liftRef.current
    const sc = opts.current.scrollRef.current
    if (!lift || !sc || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = sc.querySelector<HTMLElement>('[data-drop-slot]')
    const from = `translate3d(${s.pos.x}px, ${s.pos.y}px, 0)`
    holderRef.current?.classList.add('tree-lift-down')
    const anim = target
      ? lift.animate(
          [{ transform: from }, { transform: `translate3d(${sc.getBoundingClientRect().left + INSET}px, ${laidOut(target).top}px, 0)` }],
          { duration: SETTLE_MS, easing: SETTLE_EASING, fill: 'forwards' },
        )
      : lift.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
    await anim.finished.catch(() => {})
  }, [])

  /** Put the slot back home, wait for the tree to draw it, and land there. */
  const goHome = useCallback(
    async (s: Session) => {
      s.phase = 'settling'
      clearSpring(s)
      cancelAnimationFrame(raf.current)
      setSlot(s.home)
      setIntoFolder(null)
      setReason(null)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      if (session.current !== s) return
      if (s.home) await settle(s)
      if (session.current === s) end()
    },
    [settle, end],
  )

  const release = useCallback(async () => {
    const s = session.current
    if (!s || s.phase !== 'drag') return
    if (!s.dest || !s.ok) return goHome(s)
    clearSpring(s)
    cancelAnimationFrame(raf.current)
    s.phase = 'settling'
    const { folder, index } = s.dest
    await settle(s)
    if (session.current !== s) return
    s.phase = 'dropped'
    setDropped(true)
    await opts.current.onDrop(s.item, folder, index).catch(() => {})
    if (session.current === s) end()
  }, [settle, goHome, end])

  /** A row's onPointerDown. The drag only begins once the pointer has travelled. */
  const press = useCallback(
    (item: TreeDragItem, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === 'touch' || session.current) return
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return
      const row = e.currentTarget
      const start = { x: e.clientX, y: e.clientY }
      let started = false

      const onMove = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < THRESHOLD) return
          const sc = opts.current.scrollRef.current
          if (!sc || !row.isConnected) return
          started = true
          // The row bleeds far past the panel's left edge (TREE_ROW_BLEED); the
          // lift is the part of it the panel shows, stood in a little.
          const r = row.getBoundingClientRect()
          const left = sc.getBoundingClientRect().left + INSET
          const home = slotOf(row)
          source.current = row
          session.current = {
            item,
            phase: 'drag',
            pointer: { x: ev.clientX, y: ev.clientY },
            grab: { x: start.x - left, y: start.y - r.top },
            pos: { x: ev.clientX - (start.x - left), y: ev.clientY - (start.y - r.top) },
            home,
            dest: null,
            ok: false,
            springPath: null,
            springTimer: null,
            readAt: null,
          }
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'grabbing'
          setBox({ width: sc.clientWidth - INSET * 2, height: r.height, rowLeft: r.left - left, rowWidth: r.width })
          setSlot(home)
          setAway(home !== null)
          setDragging(item)
          raf.current = requestAnimationFrame(tick)
          return
        }
        const s = session.current
        if (s) s.pointer = { x: ev.clientX, y: ev.clientY }
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        teardown.current = null
      }
      const onUp = () => {
        stop()
        if (!started) return
        // The click that follows a drag's pointerup belongs to the drag, not to
        // whatever row the pointer came up over.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
        void release()
      }
      const onCancel = () => {
        stop()
        const s = session.current
        if (started && s?.phase === 'drag') void goHome(s)
      }
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !started) return
        ev.stopPropagation()
        onCancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      teardown.current = stop
    },
    [tick, release, goHome],
  )

  useEffect(
    () => () => {
      teardown.current?.()
      cancelAnimationFrame(raf.current)
      document.body.style.removeProperty('user-select')
      document.body.style.removeProperty('cursor')
    },
    [],
  )

  const refused = dragging !== null && reason !== null
  const lift =
    dragging && box && !dropped && typeof document !== 'undefined'
      ? createPortal(
          // Under the dialogs (z-100): a drop that has to ask parks behind the question.
          <div
            ref={liftRef}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[90] will-change-transform"
            style={{ width: box.width }}
          >
            <div
              ref={holderRef}
              style={{ height: box.height }}
              className={`tree-lift relative overflow-hidden rounded-[10px] bg-surface ring-1 ${
                refused ? 'opacity-80 ring-line' : 'ring-accent/50'
              }`}
            />
            {refused && (
              <div className="mt-1.5 rounded-lg border border-line-subtle bg-surface px-2.5 py-1.5 text-xs leading-snug text-fg-muted shadow-float">
                {reason}
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return { dragging, slot, intoFolder, away, dropped, press, lift, probe }
}
