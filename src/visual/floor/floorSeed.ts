// Pure, private seed + PRNG for the procedural floor. Never uses the game's PRNG.

function toU32(n: number): number {
  return Number.isFinite(n) ? n >>> 0 : 0;
}

function toI32(n: number): number {
  return Number.isFinite(n) ? n | 0 : 0;
}

/** Derives the per-room floor seed (unsigned 32-bit) from the run seed and room index. */
export function floorSeed(runSeed: number, roomIdx: number): number {
  let h = (toU32(runSeed) ^ Math.imul(toI32(roomIdx) + 0x9e3779b9, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32-style PRNG; values in [0, 1). */
export function createFloorRng(seed: number): () => number {
  let a = toU32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
