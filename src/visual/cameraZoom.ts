// World-camera zoom. Purely visual: combat, movement and the event log all
// live in world units, so zoom never changes gameplay or recorded data.

export const DEFAULT_ZOOM = 2;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.25;

/**
 * Next zoom after one mouse-wheel event: scrolling up (deltaY < 0) zooms in,
 * down zooms out, one ZOOM_STEP per event regardless of delta magnitude
 * (trackpads report tiny deltas, mouse wheels large ones). Snapped to the
 * step grid so repeated scrolling never drifts, then clamped.
 */
export function zoomAfterWheel(current: number, deltaY: number): number {
  if (deltaY === 0) return current;
  const next = current + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  const snapped = Math.round(next / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, snapped));
}
