// src/combat/types.ts
export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlayerState = 'idle' | 'attacking' | 'dodging';
export type EnemyState = 'idle' | 'chasing' | 'attacking' | 'recovering';
