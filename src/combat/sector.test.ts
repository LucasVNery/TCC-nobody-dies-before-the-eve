// src/combat/sector.test.ts
import { describe, it, expect } from 'vitest';
import { directionalSector, sectorOverlapsBox } from './sector';

describe('sectorOverlapsBox', () => {
  it('accepts a box centered directly ahead, within reach and angle', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 40, y: -5, width: 10, height: 10 })).toBe(true);
  });

  it('rejects a box beyond reach, even directly ahead', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 100, y: -5, width: 10, height: 10 })).toBe(false);
  });

  it('rejects a box within reach but outside the half-angle (90° off, straight up)', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // facing east, 45° half-angle
    expect(sectorOverlapsBox(sector, { x: -5, y: -40, width: 10, height: 10 })).toBe(false);
  });

  it('accepts a point just inside the half-angle boundary', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // 45° half-angle
    const angle = (40 * Math.PI) / 180; // 40°, inside the 45° cone
    const distance = 40;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    expect(sectorOverlapsBox(sector, { x: px - 1, y: py - 1, width: 2, height: 2 })).toBe(true);
  });

  it('rejects a point just outside the half-angle boundary', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // 45° half-angle
    const angle = (50 * Math.PI) / 180; // 50°, outside the 45° cone
    const distance = 40;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    expect(sectorOverlapsBox(sector, { x: px - 1, y: py - 1, width: 2, height: 2 })).toBe(false);
  });

  it('accepts a box whose center is outside the sector but a corner falls inside it', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 8); // narrow 22.5° half-angle
    // center at (30,-14) is ~25° off-axis (outside); corners (20,2) and (40,2) are ~3-6° off-axis (inside)
    expect(sectorOverlapsBox(sector, { x: 20, y: -30, width: 20, height: 32 })).toBe(true);
  });

  it('a diagonal direction correctly reaches a diagonally-positioned box (the bug this fixes)', () => {
    const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 }; // southeast, 45°
    const sector = directionalSector({ x: 0, y: 0 }, dir, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 25, y: 25, width: 10, height: 10 })).toBe(true);
  });
});
