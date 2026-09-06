# Registro de Ações + Entropia de Repertório (dim 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `PlayerController` to a data-driven action model, add the `sword_shield` weapon (light/heavy/charged), and wire the resulting action stream through a new `EntropyAccumulator` into `ProfileAccumulator.snapshot()` as dimension 2 (`action_repertoire`) of the player profile.

**Architecture:** `combat/actionRegistry.ts` holds `ActionDef`s as data; `PlayerController` becomes a generic 3-state machine (`idle`/`acting`/`dodging`) that reads timing/reach from whichever `ActionDef` is current instead of hardcoded constants. `player.action` events carry `actionId`/`actionType`/`weaponId`; `dodge` moves to its own `player.dodge` event so it never pollutes the dim-2 taxonomy. `profile/entropyAccumulator.ts` is a new, generic-over-labels sibling to the existing `DecayedRatio`-based ratio tracking, and `ProfileAccumulator` coordinates one `EntropyAccumulator` per Family B skill the same way it already coordinates ratio skills.

**Tech Stack:** TypeScript, Vitest (TDD), no new npm dependencies (see spec §8.1-8.3 — hand-rolled state machine and entropy math, both already-adopted patterns in this codebase).

**Spec:** `docs/superpowers/specs/2026-09-06-registro-acoes-entropia-repertorio-design.md`

## Global Constraints

- No new npm dependencies — the spec's §8.1-8.3 evaluated and rejected XState/fiume/robot for the state machine and `shannon-entropy`/`binary-shannon-entropy` for the math; everything here is hand-rolled TypeScript, matching existing `combat/` and `profile/` code style.
- `n = 5` is **fixed** for the dim-2 taxonomy (`ACTION_TYPES`), not the count of action types actually implemented. `throw` and `utility` stay in the taxonomy with zero `ActionDef`s this round — they must count as unused-but-available options, not be excluded from `n`.
- Determinism: no real time or `Math.random` in any new unit (`EntropyAccumulator`, `DecayedCount` are pure; `PlayerController` stays driven by `stepMs` like today).
- `dodge` never emits `player.action` — it gets its own `player.dodge` event so it can never appear as a Family B action-repertoire label.
- Out of scope for this plan: spec §8.5's 3D pre-rendered asset pipeline (KayKit/Blender) and weapon-effect tooling (Phaser postFX/Particle Editor). That's an art/tooling pipeline, not code with a TDD cycle, and spec §2.2 explicitly excludes "qualquer trabalho visual" from this sub-project. It needs its own spec before it gets a plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/combat/actionRegistry.ts` (new) | `ActionType`, `ACTION_TYPES`, `ChargeSpec`, `ActionDef`, the `sword_shield` action table, and `resolveAction()`. |
| `src/combat/actionDefs.ts` (edit) | Loses `LIGHT_ATTACK` (now a registry entry); keeps `ActionPhaseTiming`, `DodgeTiming`, `DODGE`, `totalDurationMs`. |
| `src/combat/types.ts` (edit) | `PlayerState` renamed `'attacking'` → `'acting'`. |
| `src/core/events.ts` (edit) | `PlayerActionPayload` gets `actionId`/`actionType`/`weaponId` (drops `action`); new `player.dodge` event. |
| `src/opportunity/types.ts` (edit) | `ActionId` becomes a plain `string` alias (was a 2-literal union) — it's now an action-registry id. |
| `src/combat/playerController.ts` (edit) | Generic `idle`/`acting`/`dodging` state machine driven by `ActionDef`; owns the `charged` hold/release cycle. |
| `src/scenes/ArenaScene.ts` (edit) | Key bindings updated to `tryAction(...)`/`releaseAction()`; adds heavy/charged keys so the new actions are reachable in play. |
| `src/debug/hudState.ts` (edit) | Listens to `player.dodge` instead of filtering `player.action` for `action === 'dodge'`. |
| `src/profile/decayedCount.ts` (new) | `DecayedCount` — single decayed counter, mirrors `DecayedRatio`. |
| `src/profile/entropyAccumulator.ts` (new) | `EntropyAccumulator` — normalized Shannon entropy over a fixed label set, two independent clocks. |
| `src/profile/types.ts` (edit) | `ProfileSnapshotPayload.domain` becomes `Record<SkillId, number | null>`. |
| `src/profile/profileAccumulator.ts` (edit) | Adds `recordAction()` and an `entropyDims` map; `domain()`/`deficit()` become nullable and route to `EntropyAccumulator` for Family B skills; `snapshot()` includes them. |
| `src/combat/encounter.ts` (edit) | `player.action` handler now calls `profile.recordAction()` and routes *any* action (not just a hardcoded literal) as a "wrong action" during the Assaltante's attack telegraph. |

Corresponding test files: `actionRegistry.test.ts`, `decayedCount.test.ts`, `entropyAccumulator.test.ts` (new); `hudState.test.ts`, `playerController.test.ts`, `profileAccumulator.test.ts`, `encounter.test.ts` (edited).

---

### Task 1: `combat/actionRegistry.ts` — data-driven action registry

**Files:**
- Create: `src/combat/actionRegistry.ts`
- Create: `src/combat/actionRegistry.test.ts`

**Interfaces:**
- Consumes: `ActionPhaseTiming` from `src/combat/actionDefs.ts` (already exists, unchanged).
- Produces: `ActionType`, `ACTION_TYPES: readonly ActionType[]`, `ChargeSpec { minHoldMs, maxHoldMs, reachMax }`, `ActionDef { id, weaponId, actionType, timing, reach, charge? }`, `SWORD_SHIELD_ACTIONS: ActionDef[]`, `ACTION_REGISTRY: ReadonlyMap<string, ActionDef>`, `resolveAction(id: string): ActionDef` (throws on unknown id) — all consumed by Task 5 (`PlayerController`) and Task 6 (`ProfileAccumulator`, via `ActionType`/`ACTION_TYPES`).

Note on `ChargeSpec.reachMax`: the spec's §3.1 snippet only lists `minHoldMs`/`maxHoldMs` on `ChargeSpec`, but §3.2 requires reach to interpolate between a base value (at `minHoldMs`) and a max value (at `maxHoldMs`) — `ActionDef.reach` only has room for one number. `reachMax` on `ChargeSpec` is the base value's counterpart; this is a necessary refinement of the spec's data shape, not a deviation from its intent. Damage is *not* interpolated in this task — the game has no damage/HP system yet (combat is pure hit/miss AABB overlap), so the spec's "dano" half of that sentence has nothing to attach to yet.

- [ ] **Step 1: Write the failing tests**

```ts
// src/combat/actionRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { ACTION_REGISTRY, ACTION_TYPES, resolveAction, SWORD_SHIELD_ACTIONS } from './actionRegistry';

describe('actionRegistry', () => {
  it('ACTION_TYPES has exactly 5 members (n is fixed regardless of how many are implemented)', () => {
    expect(ACTION_TYPES).toHaveLength(5);
    expect(ACTION_TYPES).toEqual(['light', 'heavy', 'charged', 'throw', 'utility']);
  });

  it('resolveAction() returns the matching ActionDef', () => {
    const action = resolveAction('sword_shield.light');
    expect(action.actionType).toBe('light');
    expect(action.weaponId).toBe('sword_shield');
  });

  it('resolveAction() throws for an unknown id', () => {
    expect(() => resolveAction('nope')).toThrow();
  });

  it('charge is present if and only if actionType is charged', () => {
    for (const action of SWORD_SHIELD_ACTIONS) {
      expect(action.charge !== undefined).toBe(action.actionType === 'charged');
    }
  });

  it('the sword_shield charged action has consistent hold bounds', () => {
    const charged = resolveAction('sword_shield.charged');
    expect(charged.charge!.minHoldMs).toBeLessThan(charged.charge!.maxHoldMs);
    expect(charged.charge!.reachMax).toBeGreaterThan(charged.reach);
  });

  it('ACTION_REGISTRY contains exactly the sword_shield actions for now', () => {
    expect(ACTION_REGISTRY.size).toBe(SWORD_SHIELD_ACTIONS.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: FAIL — `Cannot find module './actionRegistry'`.

- [ ] **Step 3: Implement `combat/actionRegistry.ts`**

```ts
// src/combat/actionRegistry.ts
import type { ActionPhaseTiming } from './actionDefs';

export type ActionType = 'light' | 'heavy' | 'charged' | 'throw' | 'utility';

export const ACTION_TYPES: readonly ActionType[] = ['light', 'heavy', 'charged', 'throw', 'utility'];

export interface ChargeSpec {
  minHoldMs: number;
  maxHoldMs: number;
  /**
   * Reach at maxHoldMs; ActionDef.reach is the base value at minHoldMs.
   * Not in the design doc's §3.1 snippet — added because linear
   * interpolation (§3.2) needs two endpoints and ActionDef only carries
   * one `reach` field.
   */
  reachMax: number;
}

export interface ActionDef {
  id: string;
  weaponId: string;
  actionType: ActionType;
  timing: ActionPhaseTiming;
  reach: number;
  charge?: ChargeSpec;
}

export const SWORD_SHIELD_ACTIONS: ActionDef[] = [
  {
    id: 'sword_shield.light',
    weaponId: 'sword_shield',
    actionType: 'light',
    timing: { startupMs: 100, activeMs: 100, recoveryMs: 150 },
    reach: 45,
  },
  {
    id: 'sword_shield.heavy',
    weaponId: 'sword_shield',
    actionType: 'heavy',
    timing: { startupMs: 220, activeMs: 120, recoveryMs: 300 },
    reach: 55,
  },
  {
    id: 'sword_shield.charged',
    weaponId: 'sword_shield',
    actionType: 'charged',
    // startupMs mirrors charge.minHoldMs for documentation only — the
    // charged lifecycle in PlayerController drives startup from
    // charge.minHoldMs/maxHoldMs, not from timing.startupMs.
    timing: { startupMs: 150, activeMs: 140, recoveryMs: 350 },
    reach: 50,
    charge: { minHoldMs: 150, maxHoldMs: 900, reachMax: 70 },
  },
];

function buildRegistry(weaponActionLists: readonly ActionDef[][]): ReadonlyMap<string, ActionDef> {
  const map = new Map<string, ActionDef>();
  for (const list of weaponActionLists) {
    for (const action of list) {
      if (map.has(action.id)) throw new Error(`duplicate action id: ${action.id}`);
      map.set(action.id, action);
    }
  }
  return map;
}

export const ACTION_REGISTRY: ReadonlyMap<string, ActionDef> = buildRegistry([SWORD_SHIELD_ACTIONS]);

export function resolveAction(id: string): ActionDef {
  const action = ACTION_REGISTRY.get(id);
  if (!action) throw new Error(`unknown action id: ${id}`);
  return action;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (only this new file is exercised so far; unrelated pre-existing files are untouched)

```bash
git add src/combat/actionRegistry.ts src/combat/actionRegistry.test.ts
git commit -m "feat: add data-driven action registry with sword_shield actions"
```

---

### Task 2: `profile/decayedCount.ts` — single decayed counter

**Files:**
- Create: `src/profile/decayedCount.ts`
- Create: `src/profile/decayedCount.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces: `DecayedCount { add(n?: number): void; decay(gamma: number): void; reset(): void; get value(): number }` — consumed by Task 3 (`EntropyAccumulator`).

- [ ] **Step 1: Write the failing tests** (mirrors `src/profile/decayedRatio.test.ts`)

```ts
// src/profile/decayedCount.test.ts
import { describe, it, expect } from 'vitest';
import { DecayedCount } from './decayedCount';

describe('DecayedCount', () => {
  it('starts at zero', () => {
    const c = new DecayedCount();
    expect(c.value).toBe(0);
  });

  it('add() accumulates into a pending buffer invisible until decay()', () => {
    const c = new DecayedCount();
    c.add(3);
    expect(c.value).toBe(0);
  });

  it('add() defaults to incrementing by 1', () => {
    const c = new DecayedCount();
    c.add();
    c.decay(1);
    expect(c.value).toBe(1);
  });

  it('decay() folds pending into the total by gamma and clears pending', () => {
    const c = new DecayedCount();
    c.add(3);
    c.decay(0.8);
    expect(c.value).toBe(3);
    c.decay(0.8); // no new pending
    expect(c.value).toBeCloseTo(2.4);
  });

  it('reset() zeroes both total and pending', () => {
    const c = new DecayedCount();
    c.add(3);
    c.decay(0.8);
    c.reset();
    expect(c.value).toBe(0);
    c.decay(0.8); // no new pending after reset
    expect(c.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/profile/decayedCount.test.ts`
Expected: FAIL — `Cannot find module './decayedCount'`.

- [ ] **Step 3: Implement `profile/decayedCount.ts`**

```ts
// src/profile/decayedCount.ts — mirrors DecayedRatio for a single counter
export class DecayedCount {
  private count = 0;
  private pending = 0;

  add(n = 1): void {
    this.pending += n;
  }

  decay(gamma: number): void {
    this.count = gamma * this.count + this.pending;
    this.pending = 0;
  }

  reset(): void {
    this.count = 0;
    this.pending = 0;
  }

  get value(): number {
    return this.count;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/profile/decayedCount.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/profile/decayedCount.ts src/profile/decayedCount.test.ts
git commit -m "feat: add DecayedCount, mirroring DecayedRatio for a single counter"
```

---

### Task 3: `profile/entropyAccumulator.ts` — normalized Shannon entropy

**Files:**
- Create: `src/profile/entropyAccumulator.ts`
- Create: `src/profile/entropyAccumulator.test.ts`

**Interfaces:**
- Consumes: `DecayedCount` from Task 2; `Clock` type from `src/profile/types.ts` (already exists: `'trait' | 'state'`).
- Produces: `EntropyAccumulator` with `record(label): void` (throws on unknown label), `decayTrait(gamma): void`, `decayState(gamma): void`, `reset(): void`, `domain(clock): number | null`, `deficit(clock): number | null`, `confidence(clock): number`, `totalCount(clock): number`, `counts(clock): Record<string, number>` — consumed by Task 6 (`ProfileAccumulator`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/profile/entropyAccumulator.test.ts
import { describe, it, expect } from 'vitest';
import { EntropyAccumulator } from './entropyAccumulator';

const LABELS = ['a', 'b', 'c', 'd', 'e'] as const;

function recordAndDecay(acc: EntropyAccumulator, label: string, times: number) {
  for (let i = 0; i < times; i++) acc.record(label);
}

describe('EntropyAccumulator', () => {
  it('domain() is null with zero samples', () => {
    const acc = new EntropyAccumulator(LABELS);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeNull();
  });

  it('domain() is null with exactly one label used (n effective < 2)', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 5);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeNull();
  });

  it('domain() is 1 (within epsilon) for a uniform distribution over all 5 labels', () => {
    const acc = new EntropyAccumulator(LABELS);
    for (const label of LABELS) recordAndDecay(acc, label, 10);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(1, 6);
  });

  it('domain() is ln(2)/ln(5) for a 50/50 split over 2 of the 5 labels', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
  });

  it('deficit() is 1 - domain(), and null when domain() is null', () => {
    const acc = new EntropyAccumulator(LABELS);
    acc.decayTrait(1);
    expect(acc.deficit('trait')).toBeNull();

    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    expect(acc.deficit('trait')).toBeCloseTo(1 - Math.log(2) / Math.log(5), 6);
  });

  it('confidence increases monotonically with more samples and approaches 1', () => {
    const acc = new EntropyAccumulator(LABELS);
    const readings: number[] = [];
    for (let i = 0; i < 5; i++) {
      recordAndDecay(acc, 'a', 25);
      acc.decayTrait(1);
      readings.push(acc.confidence('trait'));
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1]);
    }
    expect(readings[readings.length - 1]).toBeGreaterThan(0.8);
  });

  it('record() with an unknown label throws', () => {
    const acc = new EntropyAccumulator(LABELS);
    expect(() => acc.record('unknown')).toThrow();
  });

  it('decayTrait() and decayState() are independent clocks', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);

    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
    expect(acc.domain('state')).toBeNull(); // state clock not decayed yet

    acc.decayState(1);
    expect(acc.domain('state')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
  });

  it('reset() clears both clocks', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    acc.decayState(1);
    acc.reset();
    expect(acc.domain('trait')).toBeNull();
    expect(acc.domain('state')).toBeNull();
    expect(acc.totalCount('trait')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/profile/entropyAccumulator.test.ts`
Expected: FAIL — `Cannot find module './entropyAccumulator'`.

- [ ] **Step 3: Implement `profile/entropyAccumulator.ts`**

```ts
// src/profile/entropyAccumulator.ts
import { DecayedCount } from './decayedCount';
import type { Clock } from './types';

export class EntropyAccumulator {
  private readonly labelSet: ReadonlySet<string>;
  private readonly n: number;
  private trait = new Map<string, DecayedCount>();
  private state = new Map<string, DecayedCount>();

  constructor(
    private readonly labels: readonly string[],
    private readonly kappa = 25,
  ) {
    this.labelSet = new Set(labels);
    this.n = labels.length;
    for (const label of labels) {
      this.trait.set(label, new DecayedCount());
      this.state.set(label, new DecayedCount());
    }
  }

  record(label: string): void {
    if (!this.labelSet.has(label)) throw new Error(`unknown label: ${label}`);
    this.trait.get(label)!.add(1);
    this.state.get(label)!.add(1);
  }

  decayTrait(gamma: number): void {
    for (const c of this.trait.values()) c.decay(gamma);
  }

  decayState(gamma: number): void {
    for (const c of this.state.values()) c.decay(gamma);
  }

  reset(): void {
    for (const c of this.trait.values()) c.reset();
    for (const c of this.state.values()) c.reset();
  }

  domain(clock: Clock): number | null {
    const counts = Object.values(this.counts(clock)).filter((v) => v > 0);
    if (counts.length < 2) return null;
    const total = counts.reduce((a, b) => a + b, 0);
    const negEntropy = counts.reduce((acc, c) => {
      const p = c / total;
      return acc + p * Math.log(p);
    }, 0);
    return -negEntropy / Math.log(this.n);
  }

  deficit(clock: Clock): number | null {
    const d = this.domain(clock);
    return d === null ? null : 1 - d;
  }

  confidence(clock: Clock): number {
    const total = this.totalCount(clock);
    return total / (total + this.kappa);
  }

  totalCount(clock: Clock): number {
    return Object.values(this.counts(clock)).reduce((a, b) => a + b, 0);
  }

  counts(clock: Clock): Record<string, number> {
    const map = clock === 'trait' ? this.trait : this.state;
    const out: Record<string, number> = {};
    for (const [label, c] of map) out[label] = c.value;
    return out;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/profile/entropyAccumulator.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/profile/entropyAccumulator.ts src/profile/entropyAccumulator.test.ts
git commit -m "feat: add EntropyAccumulator (normalized Shannon entropy over a fixed label set)"
```

---

### Task 4: Breaking event/type schema change + `HudState`

This is a pure data-shape refactor: `player.action` gets a new payload shape and `dodge` becomes its own event. `combat/playerController.ts`, `combat/encounter.ts`, and their tests will **not** compile again until Task 5/7 land — that's expected and fixed by those tasks, not a regression introduced here. `HudState` is the one consumer this task fully fixes and re-tests, because it's small and self-contained.

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/opportunity/types.ts`
- Modify: `src/combat/types.ts`
- Modify: `src/combat/actionDefs.ts`
- Modify: `src/debug/hudState.ts`
- Modify: `src/debug/hudState.test.ts`

**Interfaces:**
- Consumes: `ActionType` from Task 1's `src/combat/actionRegistry.ts`.
- Produces: `PlayerActionPayload { actionId: string; actionType: ActionType; weaponId: string; opp_id?: string }`, `PlayerDodgePayload = Record<string, never>`, `GameEvents['player.dodge']` — consumed by Task 5 (`PlayerController`) and Task 7 (`Encounter`).

- [ ] **Step 1: Update `src/core/events.ts`**

```ts
// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';
import type { ActionType } from '../combat/actionRegistry';

export interface PlayerActionPayload {
  actionId: string;
  actionType: ActionType;
  weaponId: string;
  opp_id?: string;
}

export type PlayerDodgePayload = Record<string, never>;

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
};
```

- [ ] **Step 2: Update `src/opportunity/types.ts`**

Change only the `ActionId` line:

```ts
// The action registry's string id (e.g. 'sword_shield.light') of the action a
// player attempted while an opportunity window was open. Was a fixed 2-literal
// union before the action registry existed (2026-09-06 refactor).
export type ActionId = string;
```

- [ ] **Step 3: Update `src/combat/types.ts`**

```ts
export type PlayerState = 'idle' | 'acting' | 'dodging';
```

(`EnemyState` is untouched — its own `'attacking'` literal is a separate type and stays as-is.)

- [ ] **Step 4: Update `src/combat/actionDefs.ts`** — remove `LIGHT_ATTACK`

```ts
// src/combat/actionDefs.ts
export interface ActionPhaseTiming {
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
}

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

- [ ] **Step 5: Write the failing `HudState` tests**

Replace the dodge-related emits in `src/debug/hudState.test.ts`:

```ts
// src/debug/hudState.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { HudState } from './hudState';

describe('HudState', () => {
  it('starts with zeroed counters', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    expect(render).toHaveBeenCalledWith({
      dashAttempts: 0,
      effectiveDashes: 0,
      wastedDashes: 0,
      bossHitsLanded: 0,
    });
  });

  it('counts a dodge as a dash attempt', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, wastedDashes: 1 }),
    );
  });

  it('does not count a light attack as a dash attempt', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.action', { actionId: 'sword_shield.light', actionType: 'light', weaponId: 'sword_shield' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ dashAttempts: 0 }));
  });

  it('a dash opportunity resolved as taken counts as effective, not wasted', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, effectiveDashes: 1, wastedDashes: 0 }),
    );
  });

  it('a dash opportunity resolved as expired does not count as effective', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, effectiveDashes: 0, wastedDashes: 1 }),
    );
  });

  it('a punish opportunity resolved as taken counts as a boss hit landed', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ bossHitsLanded: 1 }));
  });

  it('a punish opportunity resolved as expired does not count as a boss hit landed', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ bossHitsLanded: 0 }));
  });
});
```

- [ ] **Step 6: Run the `HudState` tests to verify they fail**

Run: `npx vitest run src/debug/hudState.test.ts`
Expected: FAIL — `dashAttempts` stays 0 on the `player.dodge` emits, because `hudState.ts` still listens on `player.action`.

- [ ] **Step 7: Update `src/debug/hudState.ts`**

Replace the `player.action` listener with one on `player.dodge`:

```ts
this.bus.on('player.dodge', () => {
  this.dashAttempts += 1;
  this.renderNow();
});
```

(Remove the old `this.bus.on('player.action', (e) => { if (e.action !== 'dodge') return; ... })` block entirely — nothing else in `HudState` reads `player.action`.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/debug/hudState.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add src/core/events.ts src/opportunity/types.ts src/combat/types.ts src/combat/actionDefs.ts src/debug/hudState.ts src/debug/hudState.test.ts
git commit -m "refactor!: split player.dodge from player.action; actionId/actionType/weaponId payload

BREAKING: PlayerActionPayload.action is gone, replaced by actionId/actionType/weaponId.
PlayerController, Encounter, and their tests are updated in the next two tasks."
```

---

### Task 5: `PlayerController` rewrite — data-driven, generic `charged` cycle

**Files:**
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/playerController.test.ts`
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `ActionDef`, `resolveAction` from Task 1; `PlayerActionPayload`/`player.dodge` from Task 4; `PlayerState` (`'idle' | 'acting' | 'dodging'`) from Task 4.
- Produces: `PlayerController.tryAction(actionId: string): void` (throws for an unknown id, no-ops if not idle), `releaseAction(): void`, `attackHitbox(): AABB | null` (now reach/timing-aware) — consumed by Task 7 (`Encounter`).

- [ ] **Step 1: Write the failing tests**

Full replacement of `src/combat/playerController.test.ts`:

```ts
// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { DODGE } from './actionDefs';
import { SWORD_SHIELD_ACTIONS } from './actionRegistry';
import { PLAYER_MOVE_SPEED, ARENA_BOUNDS } from './movementDefs';

const LIGHT = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'light')!;
const HEAVY = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'heavy')!;
const CHARGED = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'charged')!;

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

  it('tryAction() resolves via the registry, transitions to acting, and emits player.action', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(LIGHT.id);
    expect(player.state).toBe('acting');
    expect(handler).toHaveBeenCalledWith({
      actionId: LIGHT.id,
      actionType: 'light',
      weaponId: LIGHT.weaponId,
    });
  });

  it('tryAction() with an unknown id throws and does not change state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('nope')).toThrow();
    expect(player.state).toBe('idle');
  });

  it('ignores tryAction while not idle', () => {
    const { bus, player } = makePlayer();
    player.tryDodge();
    const handler = vi.fn();
    bus.on('player.action', handler);
    expect(() => player.tryAction(LIGHT.id)).not.toThrow();
    expect(player.state).toBe('dodging');
    expect(handler).not.toHaveBeenCalled();
  });

  it('light attack: hitbox is null during startup, present during active, and back to idle after full duration', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    expect(player.attackHitbox()).not.toBeNull();

    player.step(LIGHT.timing.activeMs + LIGHT.timing.recoveryMs);
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
  });

  it('heavy attack follows its own startup/active/recovery timing and reach', () => {
    const { player } = makePlayer();
    player.tryAction(HEAVY.id);
    player.step(HEAVY.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.width).toBeCloseTo(HEAVY.reach);

    player.step(HEAVY.timing.activeMs + HEAVY.timing.recoveryMs);
    expect(player.state).toBe('idle');
  });

  it('charged: released before minHoldMs cancels back to idle without ever producing a hitbox', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs - 20);
    player.releaseAction();
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
  });

  it('charged: held past maxHoldMs auto-triggers with reach clamped to the max', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.maxHoldMs + 500); // way past max — must clamp, not overshoot
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.width).toBeCloseTo(CHARGED.charge!.reachMax);
  });

  it('charged: released between minHoldMs and maxHoldMs fires with a linearly interpolated reach', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    const holdMs = (CHARGED.charge!.minHoldMs + CHARGED.charge!.maxHoldMs) / 2;
    player.step(holdMs);
    player.releaseAction();
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2;
    expect(hitbox!.width).toBeCloseTo(midpointReach);
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

  it('emits player.dodge, not player.action, on dodge', () => {
    const { bus, player } = makePlayer();
    const actionHandler = vi.fn();
    const dodgeHandler = vi.fn();
    bus.on('player.action', actionHandler);
    bus.on('player.dodge', dodgeHandler);
    player.tryDodge();
    expect(dodgeHandler).toHaveBeenCalledWith({});
    expect(actionHandler).not.toHaveBeenCalled();
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

  it('ignores moveInput while acting', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
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

  it('exposes the last movement direction via facing, for visual/HUD purposes', () => {
    const { player } = makePlayer();
    expect(player.facing).toEqual({ x: 1, y: 0 });
    player.setMoveInput(0, 1);
    player.step(16);
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `playerController.ts` still imports the now-removed `LIGHT_ATTACK` and has no `tryAction`/`releaseAction`.

- [ ] **Step 3: Rewrite `src/combat/playerController.ts`**

```ts
// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState, Vec2 } from './types';
import { DODGE } from './actionDefs';
import { resolveAction, type ActionDef } from './actionRegistry';
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena, directionalHitbox } from './movement';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private currentAction: ActionDef | null = null;
  private chargeHeldMs = 0;
  private chargeTriggered = false;
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

  get facing(): Vec2 {
    return { x: this.lastDirection.x, y: this.lastDirection.y };
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'acting' || !this.currentAction) return null;

    if (this.currentAction.actionType === 'charged') {
      if (!this.chargeTriggered) return null;
      if (this.phaseElapsedMs >= this.currentAction.timing.activeMs) return null;
      return directionalHitbox(this._position, this.width, this.height, this.lastDirection, this.chargedReach());
    }

    const { startupMs, activeMs } = this.currentAction.timing;
    const inActive = this.phaseElapsedMs >= startupMs && this.phaseElapsedMs < startupMs + activeMs;
    if (!inActive) return null;
    return directionalHitbox(this._position, this.width, this.height, this.lastDirection, this.currentAction.reach);
  }

  setMoveInput(dx: number, dy: number): void {
    this.moveInput = { x: dx, y: dy };
  }

  tryAction(actionId: string): void {
    if (this.state !== 'idle') return;
    const action = resolveAction(actionId); // throws for unknown ids, before any state mutation

    this.state = 'acting';
    this.phaseElapsedMs = 0;
    this.currentAction = action;
    this.chargeHeldMs = 0;
    this.chargeTriggered = action.actionType !== 'charged';
    this.bus.emit('player.action', {
      actionId: action.id,
      actionType: action.actionType,
      weaponId: action.weaponId,
    });
  }

  releaseAction(): void {
    if (this.state !== 'acting' || !this.currentAction) return;
    if (this.currentAction.actionType !== 'charged' || this.chargeTriggered) return;

    if (this.chargeHeldMs >= this.currentAction.charge!.minHoldMs) {
      this.chargeTriggered = true;
      this.phaseElapsedMs = 0;
    } else {
      this.cancelAction();
    }
  }

  tryDodge(): void {
    if (this.state !== 'idle' || this.dodgeCooldownRemainingMs > 0) return;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.dashDirection = this.lastDirection;
    this.bus.emit('player.dodge', {});
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

    if (this.state === 'acting') {
      this.stepActing(stepMs);
      return;
    }

    // dodging
    this.phaseElapsedMs += stepMs;
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
  }

  private stepActing(stepMs: number): void {
    const action = this.currentAction!;

    if (action.actionType === 'charged' && !this.chargeTriggered) {
      const charge = action.charge!;
      this.chargeHeldMs = Math.min(this.chargeHeldMs + stepMs, charge.maxHoldMs);
      if (this.chargeHeldMs >= charge.maxHoldMs) {
        this.chargeTriggered = true;
        this.phaseElapsedMs = 0;
      }
      return;
    }

    this.phaseElapsedMs += stepMs;
    const totalMs =
      action.actionType === 'charged'
        ? action.timing.activeMs + action.timing.recoveryMs
        : action.timing.startupMs + action.timing.activeMs + action.timing.recoveryMs;

    if (this.phaseElapsedMs >= totalMs) {
      this.cancelAction();
    }
  }

  private cancelAction(): void {
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this.currentAction = null;
    this.chargeHeldMs = 0;
    this.chargeTriggered = false;
  }

  private chargedReach(): number {
    const action = this.currentAction!;
    const charge = action.charge!;
    const ratio = (this.chargeHeldMs - charge.minHoldMs) / (charge.maxHoldMs - charge.minHoldMs);
    const clamped = Math.max(0, Math.min(1, ratio));
    return action.reach + (charge.reachMax - action.reach) * clamped;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Fix `src/scenes/ArenaScene.ts`** — rename the call site and add heavy/charged keys so the new actions are reachable in play

In the `keys` field declaration, add two entries:

```ts
private keys!: {
  light: Phaser.Input.Keyboard.Key;
  heavy: Phaser.Input.Keyboard.Key;
  charged: Phaser.Input.Keyboard.Key;
  dodge: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};
```

In the keyboard setup block, replace:

```ts
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
```

with:

```ts
this.keys = {
  light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
  heavy: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L),
  charged: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.U),
  dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
  up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
  down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
  left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
  right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
};
this.keys.light.on('down', () => this.encounter.player.tryAction('sword_shield.light'));
this.keys.heavy.on('down', () => this.encounter.player.tryAction('sword_shield.heavy'));
this.keys.charged.on('down', () => this.encounter.player.tryAction('sword_shield.charged'));
this.keys.charged.on('up', () => this.encounter.player.releaseAction());
this.keys.dodge.on('down', () => this.encounter.player.tryDodge());
```

And update the on-screen controls text:

```ts
const controlsText = this.add.text(
  590,
  10,
  [
    'Controls:',
    '  WASD  - move',
    '  J     - light attack',
    '  L     - heavy attack',
    '  U     - hold: charged attack (release to swing)',
    '          (use during boss "recovering" to punish)',
    '  K     - dodge',
    '          (use during boss "attacking" telegraph for i-frames)',
  ],
  { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' },
);
```

- [ ] **Step 6: Typecheck the files touched so far**

Run: `npx tsc --noEmit` — expect remaining errors only in `src/combat/encounter.ts` and `src/combat/encounter.test.ts` (fixed in Task 7). Confirm no errors reference `playerController.ts`, `actionRegistry.ts`, `ArenaScene.ts`, `hudState.ts`, `events.ts`, `types.ts`, or `actionDefs.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts src/scenes/ArenaScene.ts
git commit -m "refactor: PlayerController reads ActionDefs from the registry, adds charged hold/release cycle"
```

---

### Task 6: `ProfileAccumulator` extension — Family B coordination

**Files:**
- Modify: `src/profile/types.ts`
- Modify: `src/profile/profileAccumulator.ts`
- Modify: `src/profile/profileAccumulator.test.ts`

**Interfaces:**
- Consumes: `EntropyAccumulator` from Task 3; `ACTION_TYPES`, `ActionType` from Task 1.
- Produces: `ProfileAccumulator.recordAction(actionType: ActionType): void`; `domain()`/`deficit()` now return `number | null`; `snapshot()` includes Family B skills — consumed by Task 7 (`Encounter`).

- [ ] **Step 1: Update `src/profile/types.ts`**

```ts
export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  /** tuple order: [aproveitadas (numerator), oportunidades (denominator)] — decayed counts, relógio traço only */
  counts: Record<SkillId, [number, number]>;
  domain: Record<SkillId, number | null>;
  confidence: Record<SkillId, number>;
  target: SkillId | null; // sempre null neste sub-projeto — seleção de alvo é passo 6 do §8
  lambda: number;         // sempre 0 neste sub-projeto — pesos de regra são passo 7 do §8
}
```

- [ ] **Step 2: Write the failing tests** — append to `src/profile/profileAccumulator.test.ts`, inside a new `describe` block before the file's closing `});`:

```ts
describe('ProfileAccumulator — action repertoire (Família B, dim 2)', () => {
  it('a skill with no actions recorded has a null domain and deficit', () => {
    const acc = new ProfileAccumulator();
    acc.applyRoomBoundary();
    expect(acc.domain('action_repertoire', 'trait')).toBeNull();
    expect(acc.deficit('action_repertoire', 'trait')).toBeNull();
  });

  it('recordAction() feeds the action_repertoire entropy dimension', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 6; i++) acc.recordAction('light');
    for (let i = 0; i < 3; i++) acc.recordAction('heavy');
    acc.recordAction('charged');
    acc.applyRoomBoundary();

    const domain = acc.domain('action_repertoire', 'trait');
    expect(domain).not.toBeNull();
    expect(domain!).toBeGreaterThan(0);
    expect(domain!).toBeLessThan(1);
  });

  it('only one action type ever used keeps the domain null (n effective < 2)', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordAction('light');
    acc.applyRoomBoundary();
    expect(acc.domain('action_repertoire', 'trait')).toBeNull();
  });

  it('applyRoomBoundary decays the entropy dimension even with no new recorded actions', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('light');
    acc.recordAction('heavy');
    acc.applyRoomBoundary();
    const firstConfidence = acc.confidence('action_repertoire', 'trait');

    acc.applyRoomBoundary(); // no new actions: total count should shrink by TRAIT_GAMMA
    const secondConfidence = acc.confidence('action_repertoire', 'trait');
    expect(secondConfidence).toBeLessThan(firstConfidence);
  });

  it('resetSession clears the entropy dimension', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('light');
    acc.recordAction('heavy');
    acc.applyRoomBoundary();
    acc.resetSession();
    expect(acc.domain('action_repertoire', 'trait')).toBeNull();
  });

  it('snapshot includes action_repertoire once folded, with domain null or numeric explicitly present', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('light');
    acc.applyRoomBoundary(); // one label only -> domain null, but still folded/present
    const snap = acc.snapshot('room.exit');
    expect('action_repertoire' in snap.domain).toBe(true);
    expect(snap.domain.action_repertoire).toBeNull();
    expect(snap.counts.action_repertoire).toEqual([1, 1]);
  });

  it('snapshot omits action_repertoire before any boundary has folded it', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('light');
    const snap = acc.snapshot('room.exit');
    expect(snap.counts.action_repertoire).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: FAIL — `acc.recordAction is not a function`.

- [ ] **Step 4: Rewrite `src/profile/profileAccumulator.ts`**

```ts
// src/profile/profileAccumulator.ts
import type { SkillId, Clock, ProfileSnapshotPayload, ProfileOutcome } from './types';
import { DecayedRatio } from './decayedRatio';
import { EntropyAccumulator } from './entropyAccumulator';
import { ACTION_TYPES, type ActionType } from '../combat/actionRegistry';

const TRAIT_GAMMA = 0.87;
const STATE_GAMMA = 0.55;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const DEFAULT_CONFIDENCE_KAPPA = 10;

interface SkillRatios {
  domain: DecayedRatio;
  omission: DecayedRatio;
  folded: boolean;
}

function makeSkillRatios(): SkillRatios {
  return { domain: new DecayedRatio(), omission: new DecayedRatio(), folded: false };
}

interface EntropyDim {
  acc: EntropyAccumulator;
  folded: boolean;
}

export class ProfileAccumulator {
  private trait = new Map<SkillId, SkillRatios>();
  private state = new Map<SkillId, SkillRatios>();
  private entropyDims = new Map<SkillId, EntropyDim>();

  constructor(private confidenceKappa: number = DEFAULT_CONFIDENCE_KAPPA) {
    this.entropyDims.set('action_repertoire', { acc: new EntropyAccumulator(ACTION_TYPES), folded: false });
  }

  record(skill: SkillId, numerator: number, denominator: number): void {
    this.ratiosFor(this.trait, skill).domain.add(numerator, denominator);
    this.ratiosFor(this.state, skill).domain.add(numerator, denominator);
  }

  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void {
    this.record(skill, outcome === 'taken' ? 1 : 0, 1);

    if (outcome === 'missed' || outcome === 'expired') {
      const omissionNumerator = outcome === 'expired' ? 1 : 0;
      this.ratiosFor(this.trait, skill).omission.add(omissionNumerator, 1);
      this.ratiosFor(this.state, skill).omission.add(omissionNumerator, 1);
    }
  }

  recordAction(actionType: ActionType): void {
    this.entropyDims.get('action_repertoire')!.acc.record(actionType);
  }

  applyRoomBoundary(): void {
    this.decayClock(this.trait, TRAIT_GAMMA);
    for (const dim of this.entropyDims.values()) {
      dim.acc.decayTrait(TRAIT_GAMMA);
      dim.folded = true;
    }
  }

  applyEncounterBoundary(): void {
    this.decayClock(this.state, STATE_GAMMA);
    for (const dim of this.entropyDims.values()) {
      dim.acc.decayState(STATE_GAMMA);
    }
  }

  resetSession(): void {
    this.trait.clear();
    this.state.clear();
    for (const dim of this.entropyDims.values()) {
      dim.acc.reset();
      dim.folded = false;
    }
  }

  domain(skill: SkillId, clock: Clock): number | null {
    const dim = this.entropyDims.get(skill);
    if (dim) return dim.acc.domain(clock);

    const r = this.clockFor(clock).get(skill);
    const num = r?.domain.num ?? 0;
    const den = r?.domain.den ?? 0;
    return (num + BETA_ALPHA) / (den + BETA_ALPHA + BETA_BETA);
  }

  confidence(skill: SkillId, clock: Clock): number {
    const dim = this.entropyDims.get(skill);
    if (dim) return dim.acc.confidence(clock);

    const den = this.clockFor(clock).get(skill)?.domain.den ?? 0;
    return den / (den + this.confidenceKappa);
  }

  deficit(skill: SkillId, clock: Clock): number | null {
    const d = this.domain(skill, clock);
    return d === null ? null : 1 - d;
  }

  /**
   * Fração das oportunidades "não aproveitadas" que expiraram sem tentativa,
   * em vez de terem sido tentadas e erradas (§2.4 do doc de perfil). `null`
   * quando nenhum `missed`/`expired` foi registrado ainda para essa skill
   * nesse relógio — não confundir com `0`.
   */
  omission(skill: SkillId, clock: Clock): number | null {
    const r = this.clockFor(clock).get(skill)?.omission;
    if (!r || r.den === 0) return null;
    return r.num / r.den;
  }

  /**
   * Empacota o relógio traço no formato do §7. Só inclui skills que já
   * passaram por pelo menos uma `applyRoomBoundary()` — evidência ainda
   * pendente (registrada via `record()`/`recordOutcome()`/`recordAction()`
   * mas não decaída) não aparece aqui. Para incluir a sala que acabou de
   * terminar, chame `applyRoomBoundary()` imediatamente antes de
   * `snapshot('room.exit')`.
   */
  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload {
    const counts: Record<SkillId, [number, number]> = {};
    const domain: Record<SkillId, number | null> = {};
    const confidence: Record<SkillId, number> = {};

    for (const [skill, r] of this.trait) {
      if (!r.folded) continue;
      counts[skill] = [r.domain.num, r.domain.den];
      domain[skill] = this.domain(skill, 'trait');
      confidence[skill] = this.confidence(skill, 'trait');
    }

    for (const [skill, dim] of this.entropyDims) {
      if (!dim.folded) continue;
      const labelCounts = dim.acc.counts('trait');
      const usedLabels = Object.values(labelCounts).filter((v) => v > 0).length;
      counts[skill] = [usedLabels, dim.acc.totalCount('trait')];
      domain[skill] = dim.acc.domain('trait');
      confidence[skill] = dim.acc.confidence('trait');
    }

    return { at, counts, domain, confidence, target: null, lambda: 0 };
  }

  private clockFor(clock: Clock): Map<SkillId, SkillRatios> {
    return clock === 'trait' ? this.trait : this.state;
  }

  private ratiosFor(clockMap: Map<SkillId, SkillRatios>, skill: SkillId): SkillRatios {
    let r = clockMap.get(skill);
    if (!r) {
      r = makeSkillRatios();
      clockMap.set(skill, r);
    }
    return r;
  }

  private decayClock(clockMap: Map<SkillId, SkillRatios>, gamma: number): void {
    for (const r of clockMap.values()) {
      r.domain.decay(gamma);
      r.omission.decay(gamma);
      r.folded = true;
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: PASS (all pre-existing Family A tests plus the 7 new Family B tests).

- [ ] **Step 6: Commit**

```bash
git add src/profile/types.ts src/profile/profileAccumulator.ts src/profile/profileAccumulator.test.ts
git commit -m "feat: ProfileAccumulator coordinates EntropyAccumulator dims alongside ratio skills"
```

---

### Task 7: `Encounter` integration + end-to-end critério de pronto

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `PlayerController.tryAction`/`releaseAction` (Task 5), `ProfileAccumulator.recordAction` (Task 6), `PlayerActionPayload` (Task 4).
- Produces: nothing new downstream — this is the final integration point for this sub-project.

- [ ] **Step 1: Update `src/combat/encounter.ts`**

Replace the `player.action` handler:

```ts
this.bus.on('player.action', (e) => {
  this.profile.recordAction(e.actionType);
  if (this.assaltante.state === 'attacking') {
    this.assaltante.onPlayerWrongAction(e.actionId);
  }
});
```

(Previously this checked `e.action === 'light_attack'`; now that `dodge` has its own `player.dodge` event, *any* `player.action` received while the Assaltante is mid-telegraph is by definition the wrong response, so the literal check is gone.)

- [ ] **Step 2: Update `src/combat/encounter.test.ts`**

Three call-site renames (`tryLightAttack()` → `tryAction('sword_shield.light')`) and one literal fix:

- Line with `encounter.player.tryLightAttack();` inside `'landing a hit during recovery resolves the punish opportunity as taken'` → `encounter.player.tryAction('sword_shield.light');`
- Line with `encounter.player.tryLightAttack();` inside `'attacking during the Assaltante telegraph resolves the dodge opportunity as missed'` → `encounter.player.tryAction('sword_shield.light');`, and the assertion `expect((dodgeClose as any).attempt).toBe('light_attack');` → `expect((dodgeClose as any).attempt).toBe('sword_shield.light');`
- Line with `encounter.player.tryLightAttack();` inside `'a punish opportunity resolved as taken raises the punish skill domain above the uniform prior'` → `encounter.player.tryAction('sword_shield.light');`

Then append the critério de pronto tests (§2.3 of the spec) at the end of the `describe('Encounter', ...)` block, before its closing `});`:

```ts
it('the action-repertoire dimension end to end: a mixed sequence of light/heavy/charged actions yields the hand-computed entropy at room.exit', () => {
  const encounter = new Encounter(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 1000, y: 0, width: 20, height: 20 }, // far enough away to stay out of the way
  );

  function doLight() {
    encounter.player.tryAction('sword_shield.light');
    runFor(encounter, 400); // > light's total duration (350ms)
  }
  function doHeavy() {
    encounter.player.tryAction('sword_shield.heavy');
    runFor(encounter, 700); // > heavy's total duration (640ms)
  }
  function doCharged() {
    encounter.player.tryAction('sword_shield.charged');
    runFor(encounter, 300); // still charging (< maxHoldMs 900), > minHoldMs 150
    encounter.player.releaseAction();
    runFor(encounter, 600); // > charged's active+recovery (140+350=490ms)
  }

  for (let i = 0; i < 6; i++) doLight();
  for (let i = 0; i < 3; i++) doHeavy();
  doCharged();

  encounter.profile.applyRoomBoundary();
  const snap = encounter.profile.snapshot('room.exit');

  const counts = { light: 6, heavy: 3, charged: 1 };
  const total = 10;
  const H =
    -Object.values(counts).reduce((acc, c) => {
      const p = c / total;
      return acc + p * Math.log(p);
    }, 0) / Math.log(5);

  expect(snap.domain.action_repertoire).toBeCloseTo(H, 6);
  expect(snap.counts.action_repertoire).toEqual([3, 10]);
});

it('using only light attacks keeps the action-repertoire domain null and ineligible as a deficit target', () => {
  const encounter = new Encounter(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 1000, y: 0, width: 20, height: 20 },
  );

  for (let i = 0; i < 5; i++) {
    encounter.player.tryAction('sword_shield.light');
    runFor(encounter, 400);
  }

  encounter.profile.applyRoomBoundary();
  const snap = encounter.profile.snapshot('room.exit');
  expect(snap.domain.action_repertoire).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (all pre-existing tests plus the 2 new critério-de-pronto tests).

- [ ] **Step 4: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire action_repertoire (dim 2) end to end through Encounter"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — every test file in `src/`, including `assaltanteController.test.ts` and `opportunitySystem.test.ts`, which are untouched by this plan (their `attempt: 'light_attack'` fixture strings still typecheck now that `ActionId` is `string`, and don't need to reflect a real registry id since neither file validates against the registry).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: If anything fails**

Re-open the specific task above whose file caused the failure, fix it there (not with an ad hoc patch here), then re-run Steps 1-2.

- [ ] **Step 4: Final commit** (only if Steps 1-3 required changes; otherwise this task produces no diff and nothing to commit)

---

## Self-Review Notes

**Spec coverage:**
- §2.1 refactor of `PlayerController` → Task 5. `combat/actionRegistry.ts` → Task 1. `sword_shield` 3 actions → Task 1. `player.action` schema change → Task 4. `DecayedCount` → Task 2. `EntropyAccumulator` → Task 3. Dim 2 end-to-end → Task 7. `ProfileAccumulator` coordination → Task 6. `ProfileSnapshotPayload.domain` type → Task 6. D9 revision to `especificacao-perfil-instrumentacao-v2.md` → already committed (2026-09-06, before this plan was written); not a task here.
- §2.2 exclusions (2nd/3rd weapon, defensive kit, boss adaptation, dim 7, visual work) → correctly absent from every task above.
- §2.3 critério de pronto → both integration tests in Task 7, Step 2.
- §3.3 `dodge` moved off `player.action` → Task 4.
- §4.3 charged lifecycle → Task 5 (`stepActing`/`releaseAction`/`chargedReach`).
- §5.4 null-domain cases → `EntropyAccumulator.domain()` in Task 3, exercised again through `ProfileAccumulator` in Task 6 and `Encounter` in Task 7.
- §7 test table → every row maps to a task's test file (`actionRegistry` → Task 1; `EntropyAccumulator` → Task 3; `PlayerController` → Task 5; `ProfileAccumulator` → Task 6; `Encounter` → Task 7). `DecayedCount` → Task 2.
- §8.5 (visual pipeline) → explicitly out of scope per the Global Constraints section; needs its own spec before a plan.

**Placeholder scan:** no TBD/TODO, no "add error handling" hand-waves, no "similar to Task N" — every step above ships literal code or a literal test.

**Type consistency:** `ActionDef`/`ChargeSpec`/`ActionType`/`ACTION_TYPES`/`resolveAction` (Task 1) are used with identical names and shapes in Tasks 4-7. `PlayerActionPayload`/`PlayerDodgePayload` (Task 4) match the emit calls in Task 5 and the handler in Task 7. `EntropyAccumulator`'s public method names (`record`, `decayTrait`, `decayState`, `reset`, `domain`, `deficit`, `confidence`, `totalCount`, `counts`) from Task 3 are exactly what Task 6's `ProfileAccumulator` calls.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-06-registro-acoes-entropia-repertorio.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
