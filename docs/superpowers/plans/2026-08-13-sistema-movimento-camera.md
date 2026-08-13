# Sistema de Movimento e Câmera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player free 8-direction movement (with a directional dash on dodge) and the Assaltante a real straight-line chase, inside a rectangular arena larger than the viewport, with the camera following the player Hades-style — replacing the first sub-project's static positioning.

**Architecture:** A new `combat/movement.ts` (pure functions: normalize, apply, clamp) and `combat/movementDefs.ts` (speed/bounds constants) are shared by `PlayerController` and `AssaltanteController`, which each gain a private `Vec2` position and a public read-only `position` getter. `Encounter` drops its old scalar-distance API in favor of reading `player.position` directly. `ArenaScene` reads both controllers' positions each frame to place the render rectangles and lets Phaser's camera follow/clamp natively — no new logic in the scene beyond reading state and forwarding keyboard input, preserving the existing restriction that render code never drives simulation state.

**Tech Stack:** Phaser 3, TypeScript (strict), Vite, Vitest — same stack as the first sub-project, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md`

## Global Constraints

- No real Z-axis: everything stays planar; `Vec2`/`AABB` never grow a `z` field.
- `Math.random()` is banned in `core/`, `combat/`, `ai/`, `opportunity/` — this plan introduces no randomness at all (movement is fully deterministic given input).
- Combat/opportunity/AI/movement logic never references a visual asset — `scenes/ArenaScene.ts` is the only file in this plan allowed to read state to draw it.
- Fixed timestep only: all new movement code takes `stepMs` as a parameter; no per-frame delta-time math.
- TypeScript `strict: true`.
- Diagonal movement must be normalized (not faster than a cardinal direction).
- The Assaltante chases in a straight line at fixed speed, no pathfinding, and stops chasing once `distanceToPlayer <= ATTACK_RANGE` (60, from `src/ai/rules/assaltanteRules.ts`, unchanged).
- The camera must never show area outside the arena bounds.
- The enemy's attack direction is captured once, at the moment it enters `attacking`, and stays fixed through the telegraph/swing — never recalculated mid-attack (matches the existing "frozen at entry" pattern already used for the boss-style decision points elsewhere in the design).

---

## Task 1: Vec2 type and movement primitives

**Files:**
- Modify: `src/combat/types.ts`
- Create: `src/combat/movementDefs.ts`
- Create: `src/combat/movement.ts`
- Test: `src/combat/movement.test.ts`

**Interfaces:**
- Produces: `interface Vec2 { x: number; y: number }` (added to `types.ts`, alongside the existing `AABB`/`PlayerState`/`EnemyState`); `PLAYER_MOVE_SPEED`, `ASSALTANTE_CHASE_SPEED`, `DASH_DISTANCE`, `ARENA_BOUNDS: AABB` (from `movementDefs.ts`); `normalizeVelocity(dx: number, dy: number): Vec2`, `applyMovement(position: Vec2, direction: Vec2, speedPxPerSec: number, stepMs: number): Vec2`, `clampToArena(position: Vec2, width: number, height: number, bounds: AABB): Vec2` (from `movement.ts`). Consumed by Tasks 2, 3, 5.

- [ ] **Step 1: Add `Vec2` to `src/combat/types.ts`**

Modify the file to add this export (keep everything already in the file unchanged):

```ts
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

export type PlayerState = 'idle' | 'attacking' | 'dodging';
export type EnemyState = 'idle' | 'chasing' | 'attacking' | 'recovering';
```

- [ ] **Step 2: Create `src/combat/movementDefs.ts`**

```ts
// src/combat/movementDefs.ts
import type { AABB } from './types';

export const PLAYER_MOVE_SPEED = 160; // px/s
export const ASSALTANTE_CHASE_SPEED = 90; // px/s, slower than the player
export const DASH_DISTANCE = 80; // px, total displacement over DODGE.durationMs
export const ARENA_BOUNDS: AABB = { x: 0, y: 0, width: 1600, height: 1200 };
```

- [ ] **Step 3: Write the failing test**

```ts
// src/combat/movement.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import type { AABB } from './types';

describe('normalizeVelocity', () => {
  it('returns zero vector for zero input', () => {
    expect(normalizeVelocity(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('returns a unit vector for a cardinal direction', () => {
    const v = normalizeVelocity(1, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('normalizes diagonal input so magnitude is 1, not sqrt(2)', () => {
    const v = normalizeVelocity(1, 1);
    const magnitude = Math.hypot(v.x, v.y);
    expect(magnitude).toBeCloseTo(1);
  });

  it('preserves direction while normalizing', () => {
    const v = normalizeVelocity(2, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });
});

describe('applyMovement', () => {
  it('moves position by speed * time in the given direction', () => {
    const result = applyMovement({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 1000);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(0);
  });

  it('does not move when direction is zero', () => {
    const result = applyMovement({ x: 5, y: 5 }, { x: 0, y: 0 }, 100, 1000);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('scales distance with stepMs', () => {
    const result = applyMovement({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 16);
    expect(result.x).toBeCloseTo(1.6);
  });
});

describe('clampToArena', () => {
  const bounds: AABB = { x: 0, y: 0, width: 100, height: 100 };

  it('leaves position unchanged when inside bounds', () => {
    const result = clampToArena({ x: 50, y: 50 }, 20, 20, bounds);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('clamps the left edge', () => {
    const result = clampToArena({ x: -10, y: 50 }, 20, 20, bounds);
    expect(result.x).toBe(0);
  });

  it('clamps the top edge', () => {
    const result = clampToArena({ x: 50, y: -10 }, 20, 20, bounds);
    expect(result.y).toBe(0);
  });

  it('clamps the right edge, accounting for box width', () => {
    const result = clampToArena({ x: 95, y: 50 }, 20, 20, bounds);
    expect(result.x).toBe(80);
  });

  it('clamps the bottom edge, accounting for box height', () => {
    const result = clampToArena({ x: 50, y: 95 }, 20, 20, bounds);
    expect(result.y).toBe(80);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/combat/movement.test.ts`
Expected: FAIL — `Cannot find module './movement'`

- [ ] **Step 5: Write minimal implementation**

```ts
// src/combat/movement.ts
import type { AABB, Vec2 } from './types';

export function normalizeVelocity(dx: number, dy: number): Vec2 {
  if (dx === 0 && dy === 0) return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

export function applyMovement(
  position: Vec2,
  direction: Vec2,
  speedPxPerSec: number,
  stepMs: number,
): Vec2 {
  const distance = speedPxPerSec * (stepMs / 1000);
  return { x: position.x + direction.x * distance, y: position.y + direction.y * distance };
}

export function clampToArena(position: Vec2, width: number, height: number, bounds: AABB): Vec2 {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;
  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/combat/movement.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors

- [ ] **Step 8: Commit**

```bash
git add src/combat/types.ts src/combat/movementDefs.ts src/combat/movement.ts src/combat/movement.test.ts
git commit -m "feat: add Vec2 type and pure movement primitives (normalize, apply, clamp)"
```

---

## Task 2: Player movement and dash

**Files:**
- Modify: `src/combat/playerController.ts` (full replacement below)
- Modify: `src/combat/playerController.test.ts` (full replacement below — the 9 existing tests are preserved verbatim, 6 new ones added)

**Interfaces:**
- Consumes: `Vec2`, `AABB`, `PlayerState` (Task 1's `types.ts`), `normalizeVelocity`/`applyMovement`/`clampToArena` (Task 1's `movement.ts`), `PLAYER_MOVE_SPEED`/`DASH_DISTANCE`/`ARENA_BOUNDS` (Task 1's `movementDefs.ts`), `LIGHT_ATTACK`/`DODGE`/`totalDurationMs` (existing `actionDefs.ts`, unchanged).
- Produces: `PlayerController` gains `setMoveInput(dx: number, dy: number): void` and a public `get position(): Vec2` (returns a copy). `state`, `isInvulnerable`, `hurtbox()`, `attackHitbox()`, `tryLightAttack()`, `tryDodge()`, `step(stepMs)` keep their existing signatures unchanged. Consumed by Task 4 (`Encounter`).

The constructor signature is unchanged (`(bus, initialHurtbox: AABB)`) — position is derived from `initialHurtbox.x/y`, size from `initialHurtbox.width/height`. This is why all 9 existing tests (which never call `setMoveInput` and so never move the player) still pass unmodified: their assertions on `hurtbox()`/`attackHitbox()` produce identical results to before.

- [ ] **Step 1: Replace `src/combat/playerController.ts` in full**

```ts
// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState, Vec2 } from './types';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';

const ATTACK_REACH = 20;

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private moveInput: Vec2 = { x: 0, y: 0 };
  private lastDirection: Vec2 = { x: 1, y: 0 };
  private dashDirection: Vec2 = { x: 1, y: 0 };

  constructor(
    private bus: EventBus<GameEvents>,
    initialHurtbox: AABB,
  ) {
    this._position = { x: initialHurtbox.x, y: initialHurtbox.y };
    this.width = initialHurtbox.width;
    this.height = initialHurtbox.height;
  }

  get isInvulnerable(): boolean {
    return this.invulnerable;
  }

  get position(): Vec2 {
    return { x: this._position.x, y: this._position.y };
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    const inActive =
      this.phaseElapsedMs >= LIGHT_ATTACK.startupMs &&
      this.phaseElapsedMs < LIGHT_ATTACK.startupMs + LIGHT_ATTACK.activeMs;
    if (!inActive) return null;
    return {
      x: this._position.x + this.width,
      y: this._position.y,
      width: ATTACK_REACH,
      height: this.height,
    };
  }

  setMoveInput(dx: number, dy: number): void {
    this.moveInput = { x: dx, y: dy };
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
    this.dashDirection = this.lastDirection;
    this.bus.emit('player.action', { action: 'dodge' });
  }

  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }

    if (this.state === 'idle') {
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        this.lastDirection = direction;
        this._position = clampToArena(
          applyMovement(this._position, direction, PLAYER_MOVE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
      return;
    }

    this.phaseElapsedMs += stepMs;

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= totalDurationMs(LIGHT_ATTACK)) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
      }
      return;
    }

    if (this.state === 'dodging') {
      const dashSpeed = DASH_DISTANCE / (DODGE.durationMs / 1000);
      this._position = clampToArena(
        applyMovement(this._position, this.dashDirection, dashSpeed, stepMs),
        this.width,
        this.height,
        ARENA_BOUNDS,
      );

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

- [ ] **Step 2: Replace `src/combat/playerController.test.ts` in full**

```ts
// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';
import { PLAYER_MOVE_SPEED, ARENA_BOUNDS } from './movementDefs';

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
    expect(player.state).toBe('idle');
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

  it('moves in the direction of moveInput', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.position.x).toBeCloseTo(PLAYER_MOVE_SPEED);
    expect(player.position.y).toBeCloseTo(0);
  });

  it('normalizes diagonal movement so it is not faster than a cardinal direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 1);
    player.step(1000);
    const distance = Math.hypot(player.position.x, player.position.y);
    expect(distance).toBeCloseTo(PLAYER_MOVE_SPEED);
  });

  it('does not move when moveInput is zero', () => {
    const { player } = makePlayer();
    player.step(1000);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('movement is clamped to ARENA_BOUNDS', () => {
    const { player } = makePlayer();
    player.setMoveInput(-1, 0);
    player.step(100000);
    expect(player.position.x).toBe(ARENA_BOUNDS.x);
  });

  it('ignores moveInput while attacking', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.setMoveInput(1, 0);
    player.step(500);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('dash displaces the player in the last movement direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16);
    player.setMoveInput(0, 0);
    const beforeX = player.position.x;
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(beforeX);
  });

  it('dash defaults to facing right if the player never moved', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify the new ones fail and old ones still compile**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL on the 6 new tests (`setMoveInput`/`position` don't exist yet); the 9 pre-existing tests should still be visible in the run (they'll fail too, since `PlayerController` doesn't compile yet — that's expected at this step)

- [ ] **Step 4: Run tests to verify all pass**

(After Step 1's implementation is in place.)
Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (15 tests: 9 pre-existing + 6 new)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors

- [ ] **Step 6: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: add 8-direction player movement and directional dash"
```

---

## Task 3: Assaltante chase and directional attack

**Files:**
- Modify: `src/combat/assaltanteController.ts` (full replacement below)
- Modify: `src/combat/assaltanteController.test.ts` (full replacement below — existing tests updated to pass a `Vec2` player position instead of a scalar distance; 2 new tests added)

**Interfaces:**
- Consumes: `Vec2`, `AABB`, `EnemyState` (Task 1's `types.ts`), `normalizeVelocity`/`applyMovement`/`clampToArena` (Task 1's `movement.ts`), `ASSALTANTE_CHASE_SPEED`/`ARENA_BOUNDS` (Task 1's `movementDefs.ts`), `ASSALTANTE_RULES`/`Blackboard` (existing `ai/rules/assaltanteRules.ts`, unchanged), `OpportunitySystem` (existing, unchanged).
- Produces: `AssaltanteController.step()` signature changes from `step(stepMs: number, distanceToPlayer: number)` to `step(stepMs: number, playerPosition: Vec2)` — **this is a breaking signature change**, consumed by Task 4 (`Encounter`). `AssaltanteController` also gains a public `get position(): Vec2`. `state`, `hurtbox()`, `attackHitbox()`, `onPlayerDodgeSuccess()`, `onPlayerHitLanded()` keep their existing return shapes.

The constructor signature is unchanged (`(bus, opp, initialHurtbox: AABB)`).

- [ ] **Step 1: Replace `src/combat/assaltanteController.ts` in full**

```ts
// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState, Vec2 } from './types';
import { ASSALTANTE_RULES, type Blackboard } from '../ai/rules/assaltanteRules';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';

const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window
const ATTACK_REACH = 20;

export class AssaltanteController {
  state: EnemyState = 'idle';
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private attackDirection: Vec2 = { x: -1, y: 0 };

  constructor(
    private bus: EventBus<GameEvents>,
    private opp: OpportunitySystem,
    initialHurtbox: AABB,
  ) {
    this._position = { x: initialHurtbox.x, y: initialHurtbox.y };
    this.width = initialHurtbox.width;
    this.height = initialHurtbox.height;
  }

  get position(): Vec2 {
    return { x: this._position.x, y: this._position.y };
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    if (Math.abs(this.attackDirection.x) >= Math.abs(this.attackDirection.y)) {
      const x =
        this.attackDirection.x < 0
          ? this._position.x - ATTACK_REACH
          : this._position.x + this.width;
      return { x, y: this._position.y, width: ATTACK_REACH, height: this.height };
    }
    const y =
      this.attackDirection.y < 0
        ? this._position.y - ATTACK_REACH
        : this._position.y + this.height;
    return { x: this._position.x, y, width: this.width, height: ATTACK_REACH };
  }

  step(stepMs: number, playerPosition: Vec2): void {
    const dx = playerPosition.x - this._position.x;
    const dy = playerPosition.y - this._position.y;
    const distanceToPlayer = Math.hypot(dx, dy);

    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this.attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this.attackDirection;
        this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS + SWING_MS);
      } else {
        this.state = 'chasing';
        const direction = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : { x: 0, y: 0 };
        this._position = clampToArena(
          applyMovement(this._position, direction, ASSALTANTE_CHASE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
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

- [ ] **Step 2: Replace `src/combat/assaltanteController.test.ts` in full**

The Assaltante is always created at `{x: 100, y: 0, width: 20, height: 20}`. The old scalar `distanceToPlayer` values map to player positions to the *left* of the enemy (matching the old hardcoded `-20` attack direction exactly, so the geometry these tests assert on is unchanged): old `30` → `{x: 70, y: 0}` (distance 30), old `200` → `{x: -100, y: 0}` (distance 200).

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
    enemy.step(16, { x: -100, y: 0 });
    expect(enemy.state).toBe('chasing');
  });

  it('attacks and opens a dodge opportunity when in range', () => {
    const { bus, enemy } = makeAssaltante();
    const openHandler = vi.fn();
    bus.on('opp.open', openHandler);
    enemy.step(16, { x: 70, y: 0 });
    expect(enemy.state).toBe('attacking');
    expect(openHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', src: 'assaltante.attack' }),
    );
  });

  it('opens exactly one dodge opportunity on entering attack, visible via the opportunity system', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    expect(opp.activeOfType('dodge')).toHaveLength(1);
  });

  it('transitions attacking -> recovering and opens a punish opportunity', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
  });

  it('onPlayerHitLanded() during recovering resolves the punish opportunity as taken', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
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
    enemy.step(16, { x: 70, y: 0 });
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerDodgeSuccess();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('resolves the dodge opportunity as taken when the dodge lands during the swing (after telegraph ends)', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('attacking');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerDodgeSuccess();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('moves toward the player while chasing', () => {
    const { enemy } = makeAssaltante();
    const before = enemy.position.x;
    enemy.step(16, { x: -100, y: 0 });
    expect(enemy.position.x).toBeLessThan(before);
  });

  it('attacks toward the player when the player is to the right, not always left', () => {
    const { enemy } = makeAssaltante();
    enemy.step(16, { x: 130, y: 0 }); // player to the right, distance 30
    expect(enemy.state).toBe('attacking');
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, { x: 130, y: 0 });
      elapsed += 16;
    }
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.x).toBeGreaterThan(enemy.position.x);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — old `step(16, 30)` call sites no longer type-check against the new `Vec2` parameter (the file won't compile until Step 1's implementation and this test file are both in place)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (10 tests: 8 pre-existing, updated call sites + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors (Task 4 hasn't updated `Encounter` yet, so `encounter.ts` will show an error calling `assaltante.step(stepMs, this.distanceToPlayer)` with a `number` where `Vec2` is expected — that's expected and fixed in Task 4. If your typecheck run also touches `encounter.ts`, note this in your report as an expected interim state, not a bug in this task.)

- [ ] **Step 6: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: add Assaltante straight-line chase and direction-aware attack hitbox"
```

---

## Task 4: Encounter integration

**Files:**
- Modify: `src/combat/encounter.ts` (full replacement below)
- Modify: `src/combat/encounter.test.ts` (full replacement below — 4 pre-existing tests updated to drop the removed constructor argument; 2 new tests added)

**Interfaces:**
- Consumes: `PlayerController.position` getter and `setMoveInput` (Task 2), `AssaltanteController.step(stepMs, playerPosition: Vec2)` and `.position` getter (Task 3).
- Produces: `Encounter`'s constructor drops its third parameter — becomes `constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB)` (was `(playerHurtbox, assaltanteHurtbox, initialDistance: number)`). `setDistanceToPlayer(d: number)` is removed (dead code — nothing has called it since the first sub-project's final review found `ArenaScene` never needed it) and replaced by `setPlayerMoveInput(dx: number, dy: number): void`. `bus`, `opportunities`, `player`, `assaltante`, `step(stepMs)` keep their existing shapes. Consumed by Task 5 (`ArenaScene`).

- [ ] **Step 1: Replace `src/combat/encounter.ts` in full**

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

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
  }

  setPlayerMoveInput(dx: number, dy: number): void {
    this.player.setMoveInput(dx, dy);
  }

  step(stepMs: number): void {
    this.assaltante.step(stepMs, this.player.position);
    this.player.step(stepMs);

    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && aabbOverlap(enemyAttack, this.player.hurtbox()) && this.player.isInvulnerable) {
      this.assaltante.onPlayerDodgeSuccess();
    }

    const playerAttack = this.player.attackHitbox();
    if (playerAttack && aabbOverlap(playerAttack, this.assaltante.hurtbox())) {
      this.assaltante.onPlayerHitLanded();
    }

    // Must run last: if a hit/dodge was resolved above this tick, the opportunity
    // needs to be removed before its own expiry check fires here — otherwise a
    // same-call race would close it as 'expired' one tick early.
    this.opportunities.step(stepMs);
  }
}
```

- [ ] **Step 2: Replace `src/combat/encounter.test.ts` in full**

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
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

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
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

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
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
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
      );
      const events: unknown[] = [];
      encounter.bus.on('opp.open', (e) => events.push(e));
      encounter.bus.on('opp.close', (e) => events.push(e));
      runFor(encounter, TELEGRAPH_MS + SWING_MS + 300);
      return events;
    }

    expect(scripted()).toEqual(scripted());
  });

  it('assaltante chases from outside attack range and eventually attacks', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 200, y: 0, width: 20, height: 20 },
    );
    let elapsed = 0;
    while (encounter.assaltante.state !== 'attacking' && elapsed < 10000) {
      encounter.step(STEP_MS);
      elapsed += STEP_MS;
    }
    expect(encounter.assaltante.state).toBe('attacking');
  });

  it('player moves via setPlayerMoveInput', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 500, y: 0, width: 20, height: 20 },
    );
    encounter.setPlayerMoveInput(1, 0);
    for (let i = 0; i < 30; i++) encounter.step(STEP_MS);
    expect(encounter.player.position.x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — the old 3-argument `new Encounter(...)` calls in the pre-existing tests no longer match the file, and `setPlayerMoveInput` doesn't exist yet

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (6 tests: 4 pre-existing + 2 new)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests across every file pass; typecheck clean (this is the first point where Tasks 1–4 are fully wired together — `src/scenes/ArenaScene.ts` will now fail to compile because it still calls the old 3-argument `Encounter` constructor and `setDistanceToPlayer`, which Task 5 fixes next; note this as an expected interim state if your typecheck touches that file)

- [ ] **Step 6: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire Encounter to position-driven movement, drop scalar distance API"
```

---

## Task 5: Arena scene — free movement, chase, camera follow

**Files:**
- Modify: `src/scenes/ArenaScene.ts` (full replacement below)

**Interfaces:**
- Consumes: `Encounter` (Task 4, constructor now 2-arg, `setPlayerMoveInput`), `PlayerController.position`/`AssaltanteController.position` getters (Tasks 2–3), `ARENA_BOUNDS` (Task 1's `movementDefs.ts`).
- Produces: nothing further downstream — this is the final task of this sub-project, validated by the manual playtest below (Phaser rendering/input stays out of Vitest's scope, per both this and the first sub-project's design spec).

This task adds no new automated tests — same reasoning as the first sub-project's Task 11: Phaser scene wiring isn't unit-testable, and all the logic it depends on (movement, chase, clamping) is already covered by Tasks 1–4's tests.

- [ ] **Step 1: Replace `src/scenes/ArenaScene.ts` in full**

```ts
// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS } from '../combat/movementDefs';

const STEP_MS = 1000 / 60;

export class ArenaScene extends Phaser.Scene {
  private encounter!: Encounter;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private playerRect!: Phaser.GameObjects.Rectangle;
  private assaltanteRect!: Phaser.GameObjects.Rectangle;
  private keys!: {
    light: Phaser.Input.Keyboard.Key;
    dodge: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: 20, height: 20 },
      { x: 400, y: 300, width: 20, height: 20 },
    );

    this.playerRect = this.add.rectangle(100, 300, 20, 20, 0x4caf50).setOrigin(0, 0);
    this.assaltanteRect = this.add.rectangle(400, 300, 20, 20, 0xf44336).setOrigin(0, 0);

    this.overlayText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    this.overlayText.setScrollFactor(0);
    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });

    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.encounter.step(stepMs));

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keys = {
      light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keys.light.on('down', () => this.encounter.player.tryLightAttack());
    this.keys.dodge.on('down', () => this.encounter.player.tryDodge());

    this.cameras.main.setBounds(ARENA_BOUNDS.x, ARENA_BOUNDS.y, ARENA_BOUNDS.width, ARENA_BOUNDS.height);
    this.cameras.main.startFollow(this.playerRect);
  }

  update(_time: number, delta: number): void {
    const dx = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const dy = (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    this.encounter.setPlayerMoveInput(dx, dy);

    this.loop.advance(delta);

    const playerPos = this.encounter.player.position;
    const assaltantePos = this.encounter.assaltante.position;
    this.playerRect.setPosition(playerPos.x, playerPos.y);
    this.assaltanteRect.setPosition(assaltantePos.x, assaltantePos.y);

    this.playerRect.setFillStyle(this.encounter.player.isInvulnerable ? 0x8bc34a : 0x4caf50);
    this.assaltanteRect.setFillStyle(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xf44336,
    );
  }
}
```

- [ ] **Step 2: Run the full automated test suite**

Run: `npx vitest run`
Expected: PASS — every test from Tasks 1–4 (movement, playerController, assaltanteController, encounter) plus every test carried over from the first sub-project (prng, eventBus, fixedTimestepLoop, opportunitySystem, collision, opportunityOverlay)

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors

- [ ] **Step 4: Manual playtest**

Run: `npm run dev`, open the printed local URL in a browser.

Verify, per the spec's "critério de pronto":
- WASD/arrow keys move the player freely in 8 directions; diagonal movement doesn't feel faster than cardinal movement.
- The player cannot walk past the edges of the arena (try holding a direction toward each of the four edges).
- Pressing `K` (dodge) while moving performs a dash in the direction you were moving; pressing `K` while standing still dashes in the direction you last faced (or right, if you haven't moved yet).
- The Assaltante (red square, starting far away) visibly walks in a straight line toward the player and eventually attacks (turns orange) once close enough — try letting it approach from the left, right, above, and below the player (move around it) and confirm the attack hitbox behavior looks directionally correct each time (dodge/punish still work as in the first sub-project's playtest).
- The camera follows the player and never shows empty space beyond the arena edges — walk to each edge of the arena and confirm the camera stops scrolling exactly at the boundary.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: wire free player movement, Assaltante chase, and camera follow into ArenaScene"
```

---

## Self-Review Notes

- **Spec coverage:** WASD 8-direction movement with normalized diagonal (Task 2), dash-based dodge (Task 2), movement blocked while attacking (Task 2, enforced by the existing `state === 'idle'` gate — tested), straight-line fixed-speed chase with no pathfinding (Task 3), rectangular arena bounds with clamping (Task 1 + enforced in Tasks 2/3), camera follow clamped to arena bounds via Phaser's native `setBounds`/`startFollow` (Task 5), design restriction preserved (`scenes/ArenaScene.ts` only reads `position`/`state`, never computes movement) (Task 5). The spec's mid-review addendum — directional attack hitbox — is covered in Task 3.
- **Not covered by design, correctly deferred:** the 3D/Blender visual pipeline (explicitly the next sub-project per the spec), pathfinding around obstacles, multiple rooms/PCG.
- **Type consistency:** `Vec2` defined once in `types.ts` (Task 1), reused verbatim by `movement.ts`, `movementDefs.ts`, `PlayerController`, `AssaltanteController`, and `ArenaScene` (Tasks 2, 3, 5). `AssaltanteController.step()`'s new signature (`stepMs, playerPosition: Vec2`) is defined in Task 3 and consumed with that exact shape in Task 4. `Encounter`'s new 2-argument constructor and `setPlayerMoveInput` are defined in Task 4 and consumed identically in Task 5. Both controllers' `position` getters return a **copy** (`{ x: this._position.x, y: this._position.y }`), not the live internal object, so `ArenaScene`/`Encounter` reading them cannot accidentally mutate simulation state — consistent with the first sub-project's `OpportunitySystem.activeOfType()` deferred-minor finding about live-reference leaks, avoided here from the start.
