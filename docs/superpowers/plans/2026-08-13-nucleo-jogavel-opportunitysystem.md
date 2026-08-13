# Núcleo Jogável Mínimo + OpportunitySystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, testable vertical slice — one player, one enemy archetype (Assaltante), a light attack, a dodge, and a working `OpportunitySystem` that opens/closes `dodge` and `punish` windows with an explicit denominator — validated by both automated tests and a live debug overlay.

**Architecture:** Pure TypeScript logic modules (`core/`, `opportunity/`, `combat/`) that never import Phaser, wired together by a Phaser 3 scene (`scenes/ArenaScene.ts`) that only renders state and forwards input. All combat/opportunity logic is testable headlessly with Vitest; Phaser is a thin presentation shell over `combat/encounter.ts`.

**Tech Stack:** Phaser 3, TypeScript (strict), Vite (bundler/dev server), Vitest (unit/integration tests).

**Spec:** `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md`

## Global Constraints

- No real Z-axis: combat is planar; y-sort is draw-order only, never collision.
- `Math.random()` is banned in `core/`, `combat/`, `ai/`, `opportunity/` — only `debug/` and pure visual effects may use it. All randomness goes through the seeded PRNG in `core/prng.ts`.
- Combat/opportunity/AI logic never references a visual asset (sprite key, texture, etc.) directly — `scenes/` is the only layer allowed to read logic state to draw it.
- Fixed timestep is required for all simulation stepping (no per-frame delta-time logic in `combat/`, `opportunity/`, `ai/`).
- TypeScript `strict: true`.
- Opportunities in this slice: `dodge` and `punish` only. Enemy archetype: `assaltante` only. Player actions: light attack and dodge only (data-driven, so more can be added later without restructuring).

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: a working `npm run dev` (Vite dev server), `npm run build` (production bundle), `npm run test` (Vitest) for all later tasks to build on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tcc-roguelike",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "phaser": "^3.80.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173 },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <title>TCC — Arena de Teste</title>
  </head>
  <body>
    <div id="game-root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create placeholder `src/main.ts`**

```ts
console.log('TCC bootstrap placeholder — Phaser game wired in a later task.');
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: completes without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 9: Verify build and typecheck**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no errors; `dist/` is created.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src/main.ts .gitignore
git commit -m "chore: scaffold Vite + TypeScript + Phaser 3 + Vitest project"
```

---

## Task 2: Seeded PRNG

**Files:**
- Create: `src/core/prng.ts`
- Test: `src/core/prng.test.ts`

**Interfaces:**
- Produces: `createPrng(seed: number): Prng` where `Prng = { next(): number; nextInt(maxExclusive: number): number }`. `next()` returns a float in `[0,1)`. This is the **only** allowed source of randomness in `core/`, `combat/`, `ai/`, `opportunity/`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/prng.test.ts
import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';

describe('createPrng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createPrng(42);
    const b = createPrng(43);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() stays within [0, 1)', () => {
    const rng = createPrng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(n) stays within [0, n)', () => {
    const rng = createPrng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/prng.test.ts`
Expected: FAIL — `Cannot find module './prng'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/prng.ts
export interface Prng {
  next(): number;
  nextInt(maxExclusive: number): number;
}

export function createPrng(seed: number): Prng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(maxExclusive: number): number {
    return Math.floor(next() * maxExclusive);
  }

  return { next, nextInt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/prng.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/prng.ts src/core/prng.test.ts
git commit -m "feat: add seeded PRNG for deterministic simulation"
```

---

## Task 3: Typed event bus

**Files:**
- Create: `src/core/eventBus.ts`
- Test: `src/core/eventBus.test.ts`

**Interfaces:**
- Produces: `class EventBus<T extends Record<string, unknown>>` with `on<K extends keyof T>(type: K, handler: (payload: T[K]) => void): () => void` (returns unsubscribe function) and `emit<K extends keyof T>(type: K, payload: T[K]): void`. Used by `opportunity/opportunitySystem.ts` (Task 5) and `combat/playerController.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/eventBus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './eventBus';

interface TestEvents {
  ping: { n: number };
  pong: { msg: string };
}

describe('EventBus', () => {
  it('calls subscribed handler with the emitted payload', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.emit('ping', { n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('calls multiple handlers for the same event', () => {
    const bus = new EventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('ping', h1);
    bus.on('ping', h2);
    bus.emit('ping', { n: 2 });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('does not call handlers of a different event type', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('pong', handler);
    bus.emit('ping', { n: 3 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops future calls', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.on('ping', handler);
    unsubscribe();
    bus.emit('ping', { n: 4 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit with no subscribers does not throw', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('ping', { n: 5 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/eventBus.test.ts`
Expected: FAIL — `Cannot find module './eventBus'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/eventBus.ts
export type EventMap = Record<string, unknown>;

export class EventBus<T extends EventMap> {
  private listeners: { [K in keyof T]?: Array<(payload: T[K]) => void> } = {};

  on<K extends keyof T>(type: K, handler: (payload: T[K]) => void): () => void {
    const arr = this.listeners[type] ?? [];
    arr.push(handler);
    this.listeners[type] = arr;
    return () => {
      this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler);
    };
  }

  emit<K extends keyof T>(type: K, payload: T[K]): void {
    const arr = this.listeners[type];
    if (!arr) return;
    for (const handler of [...arr]) handler(payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/eventBus.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/eventBus.ts src/core/eventBus.test.ts
git commit -m "feat: add typed event bus"
```

---

## Task 4: Fixed timestep loop

**Files:**
- Create: `src/core/fixedTimestepLoop.ts`
- Test: `src/core/fixedTimestepLoop.test.ts`

**Interfaces:**
- Produces: `createFixedTimestepLoop(stepMs: number, onStep: (stepMs: number) => void): { advance(realDeltaMs: number): void; readonly stepMs: number }`. `scenes/ArenaScene.ts` (Task 11) calls `advance()` from Phaser's `update(time, delta)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/fixedTimestepLoop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createFixedTimestepLoop } from './fixedTimestepLoop';

describe('createFixedTimestepLoop', () => {
  it('does not step when accumulated time is below stepMs', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(15);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('steps once when accumulated time equals stepMs', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(16);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(16);
  });

  it('steps multiple times for a large delta, carrying the remainder', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(35); // 2 steps (32ms), 3ms leftover
    expect(onStep).toHaveBeenCalledTimes(2);
    loop.advance(13); // accumulator 3 + 13 = 16 -> 1 more step
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it('exposes the configured stepMs', () => {
    const loop = createFixedTimestepLoop(16, () => {});
    expect(loop.stepMs).toBe(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/fixedTimestepLoop.test.ts`
Expected: FAIL — `Cannot find module './fixedTimestepLoop'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/fixedTimestepLoop.ts
export interface FixedTimestepLoop {
  advance(realDeltaMs: number): void;
  readonly stepMs: number;
}

export function createFixedTimestepLoop(
  stepMs: number,
  onStep: (stepMs: number) => void,
): FixedTimestepLoop {
  let accumulator = 0;

  function advance(realDeltaMs: number): void {
    accumulator += realDeltaMs;
    while (accumulator >= stepMs) {
      onStep(stepMs);
      accumulator -= stepMs;
    }
  }

  return { advance, stepMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/fixedTimestepLoop.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/fixedTimestepLoop.ts src/core/fixedTimestepLoop.test.ts
git commit -m "feat: add fixed timestep accumulator loop"
```

---

## Task 5: OpportunitySystem

**Files:**
- Create: `src/opportunity/types.ts`
- Create: `src/core/events.ts`
- Create: `src/opportunity/opportunitySystem.ts`
- Test: `src/opportunity/opportunitySystem.test.ts`

**Interfaces:**
- Consumes: `EventBus<T>` from Task 3 (`src/core/eventBus.ts`).
- Produces: `OppType = 'dodge' | 'punish'`, `OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid'`, `GameEvents` map with `'opp.open'`, `'opp.close'`, `'player.action'` keys, and `class OpportunitySystem` with `open(type, src, windowMs): string`, `resolve(opp_id, outcome): void`, `step(stepMs): void`, `activeOfType(type): ActiveOpp[]`. Consumed by `combat/assaltanteController.ts` (Task 8) and `combat/encounter.ts` (Task 9).

- [ ] **Step 1: Create `src/opportunity/types.ts`**

```ts
// src/opportunity/types.ts
export type OppType = 'dodge' | 'punish';
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';

export interface OppOpenPayload {
  opp_id: string;
  type: OppType;
  src: string;
  window_ms: number;
}

export interface OppClosePayload {
  opp_id: string;
  type: OppType;
  outcome: OppOutcome;
}
```

- [ ] **Step 2: Create `src/core/events.ts`**

```ts
// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';

export interface PlayerActionPayload {
  action: string;
  opp_id?: string;
}

export interface GameEvents {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/opportunity/opportunitySystem.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from './opportunitySystem';

function makeSystem() {
  const bus = new EventBus<GameEvents>();
  const sys = new OpportunitySystem(bus);
  return { bus, sys };
}

describe('OpportunitySystem', () => {
  it('open() emits opp.open with the given type, src and window', () => {
    const { bus, sys } = makeSystem();
    const handler = vi.fn();
    bus.on('opp.open', handler);
    const id = sys.open('dodge', 'assaltante.attack', 400);
    expect(handler).toHaveBeenCalledWith({ opp_id: id, type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
  });

  it('resolve() emits opp.close with the given outcome and removes it from active', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 500);
    sys.resolve(id, 'taken');
    expect(closeHandler).toHaveBeenCalledWith({ opp_id: id, type: 'punish', outcome: 'taken' });
    expect(sys.activeOfType('punish')).toHaveLength(0);
  });

  it('step() expires an opportunity once its window elapses', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('dodge', 'assaltante.attack', 100);
    sys.step(60);
    expect(closeHandler).not.toHaveBeenCalled();
    sys.step(60); // 120ms total >= 100ms window
    expect(closeHandler).toHaveBeenCalledWith({ opp_id: id, type: 'dodge', outcome: 'expired' });
  });

  it('resolve() on an already-closed opportunity is a no-op', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    const id = sys.open('dodge', 'assaltante.attack', 100);
    sys.step(100);
    bus.on('opp.close', closeHandler);
    sys.resolve(id, 'taken');
    expect(closeHandler).not.toHaveBeenCalled();
  });

  it('activeOfType() tracks multiple concurrent opportunities independently', () => {
    const { sys } = makeSystem();
    const dodgeId = sys.open('dodge', 'assaltante.attack', 400);
    const punishId = sys.open('punish', 'assaltante.recover', 500);
    expect(sys.activeOfType('dodge').map((o) => o.opp_id)).toEqual([dodgeId]);
    expect(sys.activeOfType('punish').map((o) => o.opp_id)).toEqual([punishId]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/opportunity/opportunitySystem.test.ts`
Expected: FAIL — `Cannot find module './opportunitySystem'`

- [ ] **Step 5: Write minimal implementation**

```ts
// src/opportunity/opportunitySystem.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OppType, OppOutcome } from './types';

export interface ActiveOpp {
  opp_id: string;
  type: OppType;
  src: string;
  remainingMs: number;
}

export class OpportunitySystem {
  private active: ActiveOpp[] = [];
  private nextId = 1;

  constructor(private bus: EventBus<GameEvents>) {}

  open(type: OppType, src: string, windowMs: number): string {
    const opp_id = `opp_${this.nextId++}`;
    this.active.push({ opp_id, type, src, remainingMs: windowMs });
    this.bus.emit('opp.open', { opp_id, type, src, window_ms: windowMs });
    return opp_id;
  }

  resolve(opp_id: string, outcome: Exclude<OppOutcome, 'expired'>): void {
    const idx = this.active.findIndex((o) => o.opp_id === opp_id);
    if (idx === -1) return;
    const opp = this.active[idx];
    this.active.splice(idx, 1);
    this.bus.emit('opp.close', { opp_id: opp.opp_id, type: opp.type, outcome });
  }

  step(stepMs: number): void {
    const stillActive: ActiveOpp[] = [];
    for (const opp of this.active) {
      opp.remainingMs -= stepMs;
      if (opp.remainingMs <= 0) {
        this.bus.emit('opp.close', { opp_id: opp.opp_id, type: opp.type, outcome: 'expired' });
      } else {
        stillActive.push(opp);
      }
    }
    this.active = stillActive;
  }

  activeOfType(type: OppType): ActiveOpp[] {
    return this.active.filter((o) => o.type === type);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/opportunity/opportunitySystem.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add src/opportunity/types.ts src/core/events.ts src/opportunity/opportunitySystem.ts src/opportunity/opportunitySystem.test.ts
git commit -m "feat: add OpportunitySystem with opp.open/opp.close lifecycle"
```

---

## Task 6: Combat primitives — types, action timing, collision

**Files:**
- Create: `src/combat/types.ts`
- Create: `src/combat/actionDefs.ts`
- Create: `src/combat/collision.ts`
- Test: `src/combat/collision.test.ts`

**Interfaces:**
- Produces: `AABB { x, y, width, height }`, `PlayerState = 'idle' | 'attacking' | 'dodging'`, `EnemyState = 'idle' | 'chasing' | 'attacking' | 'recovering'`, `LIGHT_ATTACK: ActionPhaseTiming`, `DODGE: DodgeTiming`, `totalDurationMs(t): number`, `aabbOverlap(a: AABB, b: AABB): boolean`. Consumed by `playerController.ts` (Task 7), `assaltanteController.ts` (Task 8), `encounter.ts` (Task 9).

- [ ] **Step 1: Create `src/combat/types.ts`**

```ts
// src/combat/types.ts
export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlayerState = 'idle' | 'attacking' | 'dodging';
export type EnemyState = 'idle' | 'chasing' | 'attacking' | 'recovering';
```

- [ ] **Step 2: Create `src/combat/actionDefs.ts`**

```ts
// src/combat/actionDefs.ts
export interface ActionPhaseTiming {
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
}

export const LIGHT_ATTACK: ActionPhaseTiming = {
  startupMs: 100,
  activeMs: 100,
  recoveryMs: 150,
};

export interface DodgeTiming {
  durationMs: number;
  iframesMs: number;
  cooldownMs: number;
}

export const DODGE: DodgeTiming = {
  durationMs: 250,
  iframesMs: 200,
  cooldownMs: 300,
};

export function totalDurationMs(t: ActionPhaseTiming): number {
  return t.startupMs + t.activeMs + t.recoveryMs;
}
```

- [ ] **Step 3: Write the failing test for collision**

```ts
// src/combat/collision.test.ts
import { describe, it, expect } from 'vitest';
import { aabbOverlap } from './collision';

describe('aabbOverlap', () => {
  it('returns true for overlapping boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns false for separated boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for boxes that only touch edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 10, y: 0, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('is symmetric', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(aabbOverlap(b, a));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/combat/collision.test.ts`
Expected: FAIL — `Cannot find module './collision'`

- [ ] **Step 5: Write minimal implementation**

```ts
// src/combat/collision.ts
import type { AABB } from './types';

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/combat/collision.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/combat/types.ts src/combat/actionDefs.ts src/combat/collision.ts src/combat/collision.test.ts
git commit -m "feat: add combat types, data-driven action timings, and AABB collision"
```

---

## Task 7: Player controller

**Files:**
- Create: `src/combat/playerController.ts`
- Test: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: `EventBus<GameEvents>` (Task 3/5), `AABB`, `PlayerState` (Task 6), `LIGHT_ATTACK`, `DODGE`, `totalDurationMs` (Task 6).
- Produces: `class PlayerController` with `state: PlayerState`, `isInvulnerable: boolean`, `hurtbox(): AABB`, `attackHitbox(): AABB | null`, `tryLightAttack(): void`, `tryDodge(): void`, `step(stepMs: number): void`. Consumed by `combat/encounter.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';

function makePlayer() {
  const bus = new EventBus<GameEvents>();
  const player = new PlayerController(bus, { x: 0, y: 0, width: 20, height: 20 });
  return { bus, player };
}

describe('PlayerController', () => {
  it('starts idle', () => {
    const { player } = makePlayer();
    expect(player.state).toBe('idle');
  });

  it('tryLightAttack() transitions to attacking and emits player.action', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryLightAttack();
    expect(player.state).toBe('attacking');
    expect(handler).toHaveBeenCalledWith({ action: 'light_attack' });
  });

  it('attackHitbox() is null during startup', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(LIGHT_ATTACK.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();
  });

  it('attackHitbox() is non-null during the active phase', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(LIGHT_ATTACK.startupMs + 10);
    expect(player.attackHitbox()).not.toBeNull();
  });

  it('returns to idle after the full attack duration', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(totalDurationMs(LIGHT_ATTACK));
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
  });

  it('tryDodge() grants invulnerability that ends after iframesMs', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.isInvulnerable).toBe(true);
    player.step(DODGE.iframesMs + 10);
    expect(player.isInvulnerable).toBe(false);
  });

  it('dodge ends after durationMs and starts a cooldown that blocks re-dodging', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.state).toBe('idle');
    player.tryDodge();
    expect(player.state).toBe('idle'); // still on cooldown, ignored
  });

  it('dodge is available again once the cooldown elapses', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.step(DODGE.cooldownMs);
    player.tryDodge();
    expect(player.state).toBe('dodging');
  });

  it('ignores tryLightAttack while not idle', () => {
    const { bus, player } = makePlayer();
    player.tryDodge();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryLightAttack();
    expect(player.state).toBe('dodging');
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `Cannot find module './playerController'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState } from './types';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;

  constructor(
    private bus: EventBus<GameEvents>,
    private hurtboxBase: AABB,
  ) {}

  get isInvulnerable(): boolean {
    return this.invulnerable;
  }

  hurtbox(): AABB {
    return this.hurtboxBase;
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    const inActive =
      this.phaseElapsedMs >= LIGHT_ATTACK.startupMs &&
      this.phaseElapsedMs < LIGHT_ATTACK.startupMs + LIGHT_ATTACK.activeMs;
    if (!inActive) return null;
    return {
      x: this.hurtboxBase.x + this.hurtboxBase.width,
      y: this.hurtboxBase.y,
      width: 20,
      height: this.hurtboxBase.height,
    };
  }

  tryLightAttack(): void {
    if (this.state !== 'idle') return;
    this.state = 'attacking';
    this.phaseElapsedMs = 0;
    this.bus.emit('player.action', { action: 'light_attack' });
  }

  tryDodge(): void {
    if (this.state !== 'idle' || this.dodgeCooldownRemainingMs > 0) return;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.bus.emit('player.action', { action: 'dodge' });
  }

  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }

    if (this.state === 'idle') return;

    this.phaseElapsedMs += stepMs;

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= totalDurationMs(LIGHT_ATTACK)) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
      }
      return;
    }

    if (this.state === 'dodging') {
      if (this.phaseElapsedMs >= DODGE.iframesMs) {
        this.invulnerable = false;
      }
      if (this.phaseElapsedMs >= DODGE.durationMs) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.dodgeCooldownRemainingMs = DODGE.cooldownMs;
      }
      return;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: add player controller with light attack and dodge state machines"
```

---

## Task 8: Assaltante rules and controller

**Files:**
- Create: `src/ai/rules/assaltanteRules.ts`
- Create: `src/combat/assaltanteController.ts`
- Test: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Consumes: `EventBus<GameEvents>` (Task 3/5), `OpportunitySystem` (Task 5), `AABB`, `EnemyState` (Task 6).
- Produces: `interface Blackboard { distanceToPlayer: number; state: EnemyState }`, `interface Rule { id, archetype, opportunity_tags, precond }`, `ASSALTANTE_RULES: Rule[]`, `class AssaltanteController` with `state: EnemyState`, `hurtbox(): AABB`, `attackHitbox(): AABB | null`, `step(stepMs: number, distanceToPlayer: number): void`, `onPlayerDodgeSuccess(): void`, `onPlayerHitLanded(): void`. Consumed by `combat/encounter.ts` (Task 9).

- [ ] **Step 1: Create `src/ai/rules/assaltanteRules.ts`**

```ts
// src/ai/rules/assaltanteRules.ts
import type { EnemyState } from '../../combat/types';

export const ATTACK_RANGE = 60;

export interface Blackboard {
  distanceToPlayer: number;
  state: EnemyState;
}

export interface Rule {
  id: string;
  archetype: 'assaltante';
  opportunity_tags: Partial<Record<'dodge' | 'punish', number>>;
  precond: (bb: Blackboard) => boolean;
}

export const ASSALTANTE_RULES: Rule[] = [
  {
    id: 'assaltante.attack',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    precond: (bb) => bb.distanceToPlayer <= ATTACK_RANGE,
  },
  {
    id: 'assaltante.chase',
    archetype: 'assaltante',
    opportunity_tags: {},
    precond: () => true,
  },
];
```

- [ ] **Step 2: Write the failing test**

```ts
// src/combat/assaltanteController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController } from './assaltanteController';

function makeAssaltante() {
  const bus = new EventBus<GameEvents>();
  const opp = new OpportunitySystem(bus);
  const enemy = new AssaltanteController(bus, opp, { x: 100, y: 0, width: 20, height: 20 });
  return { bus, opp, enemy };
}

describe('AssaltanteController', () => {
  it('starts idle', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.state).toBe('idle');
  });

  it('chases when far from the player', () => {
    const { enemy } = makeAssaltante();
    enemy.step(16, 200);
    expect(enemy.state).toBe('chasing');
  });

  it('attacks and opens a dodge opportunity when in range', () => {
    const { enemy } = makeAssaltante();
    const openHandler = vi.fn();
    const { bus } = makeAssaltante();
    bus.on('opp.open', openHandler);
    enemy.step(16, 30);
    expect(enemy.state).toBe('attacking');
  });

  it('opens exactly one dodge opportunity on entering attack, visible via the opportunity system', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, 30); // enters attacking, opens dodge
    expect(opp.activeOfType('dodge')).toHaveLength(1);
  });

  it('transitions attacking -> recovering and opens a punish opportunity', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, 30); // enters attacking
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, 30);
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
  });

  it('onPlayerHitLanded() during recovering resolves the punish opportunity as taken', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, 30);
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, 30);
      elapsed += 16;
    }
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerHitLanded();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'taken' }),
    );
    expect(opp.activeOfType('punish')).toHaveLength(0);
  });

  it('onPlayerDodgeSuccess() during attacking resolves the dodge opportunity as taken', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, 30);
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerDodgeSuccess();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `Cannot find module './assaltanteController'`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState } from './types';
import { ASSALTANTE_RULES, type Blackboard } from '../ai/rules/assaltanteRules';

const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window

export class AssaltanteController {
  state: EnemyState = 'idle';
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;

  constructor(
    private bus: EventBus<GameEvents>,
    private opp: OpportunitySystem,
    private hurtboxBase: AABB,
  ) {}

  hurtbox(): AABB {
    return this.hurtboxBase;
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    return {
      x: this.hurtboxBase.x - 20,
      y: this.hurtboxBase.y,
      width: 20,
      height: this.hurtboxBase.height,
    };
  }

  step(stepMs: number, distanceToPlayer: number): void {
    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS);
      } else {
        this.state = 'chasing';
      }
      return;
    }

    this.phaseElapsedMs += stepMs;

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= TELEGRAPH_MS + SWING_MS) {
        this.state = 'recovering';
        this.phaseElapsedMs = 0;
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', RECOVERY_MS);
      }
      return;
    }

    if (this.state === 'recovering') {
      if (this.phaseElapsedMs >= RECOVERY_MS) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.activeOppId = null;
      }
      return;
    }
  }

  onPlayerDodgeSuccess(): void {
    if (this.state === 'attacking' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      this.activeOppId = null;
    }
  }

  onPlayerHitLanded(): void {
    if (this.state === 'recovering' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      this.activeOppId = null;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/ai/rules/assaltanteRules.ts src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: add Assaltante rules and state machine opening dodge/punish opportunities"
```

---

## Task 9: Encounter (pure-logic integration)

**Files:**
- Create: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `EventBus`, `GameEvents`, `OpportunitySystem`, `PlayerController`, `AssaltanteController`, `aabbOverlap`, `AABB` (all prior tasks).
- Produces: `class Encounter` with `bus`, `opportunities`, `player`, `assaltante` (public readonly), `setDistanceToPlayer(d: number): void`, `step(stepMs: number): void`. Consumed by `scenes/ArenaScene.ts` (Task 11) as the sole non-visual simulation surface — the scene never touches `PlayerController`/`AssaltanteController`/`OpportunitySystem` directly.

- [ ] **Step 1: Write the failing test**

```ts
// src/combat/encounter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { DODGE } from './actionDefs';

const TELEGRAPH_MS = 400;
const SWING_MS = 150;
const STEP_MS = 16;

function runFor(encounter: Encounter, ms: number) {
  let elapsed = 0;
  while (elapsed < ms) {
    encounter.step(STEP_MS);
    elapsed += STEP_MS;
  }
}

describe('Encounter', () => {
  it('a successful dodge resolves the dodge opportunity as taken, not expired', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      30,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS); // assaltante enters attacking, opens dodge opp
    expect(encounter.assaltante.state).toBe('attacking');

    // dodge just before the enemy's active swing lands
    runFor(encounter, TELEGRAPH_MS - STEP_MS * 2);
    encounter.player.tryDodge();
    runFor(encounter, SWING_MS + STEP_MS * 2);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('taken');
  });

  it('not dodging lets the dodge opportunity expire', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      30,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + STEP_MS * 2);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('expired');
  });

  it('landing a hit during recovery resolves the punish opportunity as taken', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
      20,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS); // enemy now recovering
    expect(encounter.assaltante.state).toBe('recovering');

    encounter.player.tryLightAttack();
    runFor(encounter, 300);

    const punishClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'punish',
    );
    expect(punishClose).toBeDefined();
    expect((punishClose as any).outcome).toBe('taken');
  });

  it('is deterministic: two encounters given the same scripted inputs produce the same event sequence', () => {
    function scripted(): unknown[] {
      const encounter = new Encounter(
        { x: 0, y: 0, width: 20, height: 20 },
        { x: 30, y: 0, width: 20, height: 20 },
        30,
      );
      const events: unknown[] = [];
      encounter.bus.on('opp.open', (e) => events.push(e));
      encounter.bus.on('opp.close', (e) => events.push(e));
      runFor(encounter, TELEGRAPH_MS + SWING_MS + 300);
      return events;
    }

    expect(scripted()).toEqual(scripted());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `Cannot find module './encounter'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/combat/encounter.ts
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { PlayerController } from './playerController';
import { AssaltanteController } from './assaltanteController';
import { aabbOverlap } from './collision';
import type { AABB } from './types';

export class Encounter {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  private distanceToPlayer: number;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB, initialDistance: number) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.distanceToPlayer = initialDistance;
  }

  setDistanceToPlayer(d: number): void {
    this.distanceToPlayer = d;
  }

  step(stepMs: number): void {
    this.assaltante.step(stepMs, this.distanceToPlayer);
    this.player.step(stepMs);
    this.opportunities.step(stepMs);

    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && aabbOverlap(enemyAttack, this.player.hurtbox()) && this.player.isInvulnerable) {
      this.assaltante.onPlayerDodgeSuccess();
    }

    const playerAttack = this.player.attackHitbox();
    if (playerAttack && aabbOverlap(playerAttack, this.assaltante.hurtbox())) {
      this.assaltante.onPlayerHitLanded();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (4 tests). If the dodge-timing test is flaky against the exact frame the swing hitbox appears, adjust the `runFor` window in the test to land the dodge input squarely inside `DODGE.iframesMs` around the swing — do not change encounter.ts's collision order to force it.

- [ ] **Step 5: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: add Encounter — deterministic pure-logic wiring of player, Assaltante and opportunities"
```

---

## Task 10: Debug overlay

**Files:**
- Create: `src/debug/opportunityOverlay.ts`
- Test: `src/debug/opportunityOverlay.test.ts`

**Interfaces:**
- Consumes: `EventBus<GameEvents>` (Task 3/5).
- Produces: `class OpportunityOverlay` with constructor `(bus: EventBus<GameEvents>, render: (lines: string[]) => void)`. It subscribes to `opp.open`/`opp.close` and calls `render()` with a human-readable snapshot of currently open opportunities — no Phaser/DOM dependency, so it's unit-testable; `scenes/ArenaScene.ts` (Task 11) supplies a `render` callback that writes to a Phaser `Text` object.

- [ ] **Step 1: Write the failing test**

```ts
// src/debug/opportunityOverlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunityOverlay } from './opportunityOverlay';

describe('OpportunityOverlay', () => {
  it('renders an empty list initially', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    expect(render).toHaveBeenCalledWith([]);
  });

  it('adds a line when an opportunity opens', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
    expect(render).toHaveBeenLastCalledWith(['dodge — OPEN (assaltante.attack)']);
  });

  it('removes the line when the opportunity closes', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'punish', src: 'assaltante.recover', window_ms: 500 });
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith([]);
  });

  it('tracks multiple concurrent opportunities independently', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
    bus.emit('opp.open', { opp_id: 'opp_2', type: 'punish', src: 'assaltante.recover', window_ms: 500 });
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(['punish — OPEN (assaltante.recover)']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/debug/opportunityOverlay.test.ts`
Expected: FAIL — `Cannot find module './opportunityOverlay'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/debug/opportunityOverlay.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';

export class OpportunityOverlay {
  private open = new Map<string, { type: string; src: string }>();

  constructor(
    private bus: EventBus<GameEvents>,
    private render: (lines: string[]) => void,
  ) {
    this.bus.on('opp.open', (e) => {
      this.open.set(e.opp_id, { type: e.type, src: e.src });
      this.renderNow();
    });
    this.bus.on('opp.close', (e) => {
      this.open.delete(e.opp_id);
      this.renderNow();
    });
    this.renderNow();
  }

  private renderNow(): void {
    const lines = [...this.open.values()].map((o) => `${o.type} — OPEN (${o.src})`);
    this.render(lines);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/debug/opportunityOverlay.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/debug/opportunityOverlay.ts src/debug/opportunityOverlay.test.ts
git commit -m "feat: add debug overlay reacting to opp.open/opp.close"
```

---

## Task 11: Arena scene — wire everything into a running Phaser game

**Files:**
- Modify: `src/main.ts`
- Create: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `Encounter` (Task 9), `OpportunityOverlay` (Task 10), `createFixedTimestepLoop` (Task 4).
- Produces: a running Phaser 3 game. This is the final task of the slice — no further tasks consume its output; validated manually per the spec's "critério de pronto", not by an automated test (Phaser's canvas/WebGL rendering is out of scope for Vitest in this slice, per spec §6).

- [ ] **Step 1: Create `src/scenes/ArenaScene.ts`**

```ts
// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';

const STEP_MS = 1000 / 60;

export class ArenaScene extends Phaser.Scene {
  private encounter!: Encounter;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private playerRect!: Phaser.GameObjects.Rectangle;
  private assaltanteRect!: Phaser.GameObjects.Rectangle;
  private keys!: { light: Phaser.Input.Keyboard.Key; dodge: Phaser.Input.Keyboard.Key };

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: 20, height: 20 },
      { x: 250, y: 300, width: 20, height: 20 },
      150,
    );

    this.playerRect = this.add.rectangle(100, 300, 20, 20, 0x4caf50);
    this.assaltanteRect = this.add.rectangle(250, 300, 20, 20, 0xf44336);

    this.overlayText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });

    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.encounter.step(stepMs));

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keys = {
      light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    this.keys.light.on('down', () => this.encounter.player.tryLightAttack());
    this.keys.dodge.on('down', () => this.encounter.player.tryDodge());
  }

  update(_time: number, delta: number): void {
    this.loop.advance(delta);

    const dx = this.assaltanteRect.x - this.playerRect.x;
    this.encounter.setDistanceToPlayer(Math.abs(dx));

    this.playerRect.setFillColor(this.encounter.player.isInvulnerable ? 0x8bc34a : 0x4caf50);
    this.assaltanteRect.setFillColor(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xf44336,
    );
  }
}
```

- [ ] **Step 2: Wire `ArenaScene` into a Phaser game in `src/main.ts`**

```ts
// src/main.ts
import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-root',
  backgroundColor: '#1a1a1a',
  scene: [ArenaScene],
});
```

- [ ] **Step 3: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — all tests from Tasks 2–10 pass (prng, eventBus, fixedTimestepLoop, opportunitySystem, collision, playerController, assaltanteController, encounter, opportunityOverlay).

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 5: Manual playtest**

Run: `npm run dev`, open the printed local URL in a browser.

Verify, per the spec's "critério de pronto":
- The Assaltante (red square) chases toward the player (green square) and attacks (turns orange) when in range.
- Pressing `K` during the Assaltante's attack telegraph triggers a dodge (player square turns light green) and the `dodge — OPEN (...)` overlay line disappears without a "missed"/"expired" console side-effect (there is none to observe yet beyond the overlay clearing on `opp.close`).
- Not dodging in time lets the `dodge` line stay until the window closes (it disappears once expired).
- After the Assaltante's swing, it enters recovery; pressing `J` to land a light attack during that window clears the `punish — OPEN (...)` line.
- No dodge is possible immediately after another dodge (cooldown) — the player square does not flicker light green again immediately on repeated `K` presses.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/scenes/ArenaScene.ts
git commit -m "feat: wire Encounter and debug overlay into a running Phaser arena scene"
```

---

## Self-Review Notes

- **Spec coverage:** stack (Task 1), PRNG/no-Math.random (Task 2 + constraint), event bus (Task 3), fixed timestep (Task 4), `opp.open`/`opp.close` with denominator (Task 5), data-driven action defs for future extensibility (Task 6), light attack + dodge (Task 7), Assaltante with `Rule` interface and fixed-priority selection (Task 8), pure-logic determinism (Task 9, explicit determinism test), debug overlay (Task 10), running scene + manual playtest checklist matching the spec's "critério de pronto" (Task 11).
- **Not covered by design, correctly deferred:** telemetry network pipeline, player profile/deficits, weighted rule selection with clipping/top-culling, boss BT, PCG — all explicitly out of scope per the spec's §8.
- **Type consistency:** `AABB`, `PlayerState`, `EnemyState` defined once in `combat/types.ts` (Task 6) and reused verbatim in Tasks 7–9. `GameEvents` defined once in `core/events.ts` (Task 5) and reused in Tasks 7, 8, 10. `OpportunitySystem`'s public method names (`open`, `resolve`, `step`, `activeOfType`) are consistent from their Task 5 definition through Tasks 8 and 9.
