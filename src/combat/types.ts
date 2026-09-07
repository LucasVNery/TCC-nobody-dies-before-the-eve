// src/combat/types.ts
export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type PlayerState = 'idle' | 'acting' | 'dodging' | 'blocking' | 'staggered';
export type EnemyState = 'idle' | 'chasing' | 'attacking' | 'recovering';
