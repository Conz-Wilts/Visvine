// Zoom and pan as numbers. Pure — the pane draws what these return, and a
// test pins the behaviour. The scale steps and limits are Mattermost's
// (file_preview_modal): images zoom 25%–200%, documents 25%–300%.

export interface ZoomState {
  scale: number
  /** Translation of the content, in screen px, from its centred position. */
  x: number
  y: number
}

export const ZOOM = {
  step: 0.25,
  min: 0.25,
  maxImage: 2,
  maxDocument: 3,
} as const

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 }

export function clampScale(scale: number, max: number): number {
  return Math.min(max, Math.max(ZOOM.min, Math.round(scale * 100) / 100))
}

/**
 * Zoom to `next` keeping the point under the cursor where it is. `at` is the
 * cursor relative to the pane's centre. At or below 1× the content re-centres:
 * there is nothing to pan when it fits.
 */
export function zoomAt(state: ZoomState, next: number, at: { x: number; y: number }, max: number): ZoomState {
  const scale = clampScale(next, max)
  if (scale <= 1) return { scale, x: 0, y: 0 }
  const ratio = scale / state.scale
  return {
    scale,
    x: at.x - (at.x - state.x) * ratio,
    y: at.y - (at.y - state.y) * ratio,
  }
}

/** One step in or out, around the centre (the buttons and the +/- keys). */
export function stepZoom(state: ZoomState, direction: 1 | -1, max: number): ZoomState {
  return zoomAt(state, state.scale + direction * ZOOM.step, { x: 0, y: 0 }, max)
}

/**
 * Pan, but never so far the content leaves the pane: its scaled half-size
 * beyond the pane's half-size is the most it may travel either way.
 */
export function panBy(
  state: ZoomState,
  dx: number,
  dy: number,
  content: { width: number; height: number },
  pane: { width: number; height: number },
): ZoomState {
  if (state.scale <= 1) return state
  const limitX = Math.max(0, (content.width * state.scale - pane.width) / 2)
  const limitY = Math.max(0, (content.height * state.scale - pane.height) / 2)
  return {
    scale: state.scale,
    x: Math.min(limitX, Math.max(-limitX, state.x + dx)),
    y: Math.min(limitY, Math.max(-limitY, state.y + dy)),
  }
}

/** A wheel's delta as a zoom factor: a trackpad pinch's small deltas zoom gently. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-Math.max(-1, Math.min(1, deltaY / 100)) * 0.25)
}
