import { describe, it, expect } from 'vitest';
import { directionBucket, DIRECTION_COUNT } from './spriteDirection';

describe('directionBucket', () => {
  it('DIRECTION_COUNT is 8', () => {
    expect(DIRECTION_COUNT).toBe(8);
  });

  it('buckets due east (1,0) as 0', () => {
    expect(directionBucket({ x: 1, y: 0 })).toBe(0);
  });

  it('buckets due south on screen (0,1) as 2', () => {
    expect(directionBucket({ x: 0, y: 1 })).toBe(2);
  });

  it('buckets due west (-1,0) as 4', () => {
    expect(directionBucket({ x: -1, y: 0 })).toBe(4);
  });

  it('buckets due north on screen (0,-1) as 6', () => {
    expect(directionBucket({ x: 0, y: -1 })).toBe(6);
  });

  it('buckets a diagonal (1,1) as 1 (between east and south)', () => {
    expect(directionBucket({ x: 1, y: 1 })).toBe(1);
  });

  it('buckets a diagonal (-1,-1) as 5 (between west and north)', () => {
    expect(directionBucket({ x: -1, y: -1 })).toBe(5);
  });

  it('is insensitive to vector magnitude (does not require normalization)', () => {
    expect(directionBucket({ x: 50, y: 0 })).toBe(0);
    expect(directionBucket({ x: 0.001, y: 0 })).toBe(0);
  });

  it('a vector well within the 0-22.5 degree range rounds down to bucket 0', () => {
    const x = Math.cos(Math.PI / 18); // 10 degrees
    const y = Math.sin(Math.PI / 18);
    expect(directionBucket({ x, y })).toBe(0);
  });

  it('a vector just past the 22.5 degree boundary rounds up to bucket 1', () => {
    const x = Math.cos(Math.PI / 6); // 30 degrees
    const y = Math.sin(Math.PI / 6);
    expect(directionBucket({ x, y })).toBe(1);
  });
});
