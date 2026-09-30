import { describe, it, expect } from 'vitest';
import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, zoomAfterWheel } from './cameraZoom';

describe('zoomAfterWheel', () => {
  it('scrolling up (negative deltaY) zooms in by one step', () => {
    expect(zoomAfterWheel(DEFAULT_ZOOM, -100)).toBeCloseTo(DEFAULT_ZOOM + ZOOM_STEP);
  });

  it('scrolling down (positive deltaY) zooms out by one step', () => {
    expect(zoomAfterWheel(DEFAULT_ZOOM, 100)).toBeCloseTo(DEFAULT_ZOOM - ZOOM_STEP);
  });

  it('clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(zoomAfterWheel(MAX_ZOOM, -100)).toBe(MAX_ZOOM);
    expect(zoomAfterWheel(MIN_ZOOM, 100)).toBe(MIN_ZOOM);
  });

  it('a zero delta leaves the zoom unchanged', () => {
    expect(zoomAfterWheel(1.5, 0)).toBe(1.5);
  });

  it('snaps to the step grid so repeated scrolling never accumulates float drift', () => {
    let z = DEFAULT_ZOOM;
    for (let i = 0; i < 3; i++) z = zoomAfterWheel(z, -1); // stays below MAX_ZOOM
    for (let i = 0; i < 3; i++) z = zoomAfterWheel(z, 1);
    expect(z).toBe(DEFAULT_ZOOM);
  });
});
