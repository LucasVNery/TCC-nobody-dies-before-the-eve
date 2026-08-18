# Ciclo de Vida da Oportunidade (Quatro Outcomes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `OppOutcome` from two to four values (`taken`/`missed`/`expired`/`invalid`) with the precedence table `invalid > taken > missed > expired`, and wire the two real triggers already possible with the current game: attacking during a `dodge` window (→ `missed`) and never entering `ATTACK_REACH` during a `punish` window (→ `invalid`/`out_of_range`).

**Architecture:** All changes live in `src/opportunity/` (types + the `OpportunitySystem`'s validation and expiry hook) and `src/combat/` (`AssaltanteController`'s new wrong-action/range-tracking logic, `Encounter`'s new bus subscription). No new files, no new folders — this extends the existing `OpportunitySystem` rather than introducing a new subsystem.

**Tech Stack:** Phaser 3.80, TypeScript (strict), Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-ciclo-vida-oportunidade-design.md`

## Global Constraints

- Precedence `invalid > taken > missed > expired` is preserved structurally (resolving an already-closed opportunity is a no-op), not by an explicit arbitration mechanism.
- `OpportunitySystem.resolve()` must throw an `Error` if called with `outcome: 'invalid'` and no `reason` — this is the one new validation boundary in this sub-project.
- Only one `InvalidReason` (`'out_of_range'`) is actually emitted by this sub-project; the other five stay in the type for later sub-projects, per the spec's §1.
- `Math.random()` remains banned in `core/`, `combat/`, `ai/`, `opportunity/`.
- TypeScript `strict: true`.
- No changes to `src/scenes/`, `src/visual/`, or `src/debug/` — this sub-project is pure logic.

---

## Task 1: Four-outcome `OppOutcome`, `InvalidReason`, and `OpportunitySystem` validation + expiry hook

**Files:**
- Modify: `src/opportunity/types.ts`
- Modify: `src/opportunity/opportunitySystem.ts`
- Test: `src/opportunity/opportunitySystem.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid'`, `ActionId = 'light_attack' | 'dodge'`, `InvalidReason = 'other_source_hitstun' | 'out_of_range' | 'player_dead' | 'tool_locked' | 'source_interrupted' | 'overlapping_priority'` (all from `src/opportunity/types.ts`). `OppClosePayload` gains optional `reason?: InvalidReason` and `attempt?: ActionId`. `OpportunitySystem.open(type, src, windowMs, onExpire?: () => { outcome: 'expired' | 'invalid'; reason?: InvalidReason })` and `OpportunitySystem.resolve(opp_id, outcome, extras?: { reason?: InvalidReason; attempt?: ActionId })`. Consumed by `src/combat/assaltanteController.ts` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/opportunity/opportunitySystem.test.ts`, inside the existing `describe('OpportunitySystem', ...)` block (after the last `it(...)`):

```ts
  it('resolve() with outcome invalid requires and forwards a reason', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 500);
    sys.resolve(id, 'invalid', { reason: 'out_of_range' });
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'punish',
      outcome: 'invalid',
      reason: 'out_of_range',
    });
  });

  it('resolve() with outcome invalid and no reason throws and does not close the opportunity', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    const id = sys.open('punish', 'assaltante.recover', 500);
    bus.on('opp.close', closeHandler);
    expect(() => sys.resolve(id, 'invalid')).toThrow();
    expect(closeHandler).not.toHaveBeenCalled();
    expect(sys.activeOfType('punish')).toHaveLength(1);
  });

  it('resolve() with outcome missed forwards the attempt', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('dodge', 'assaltante.attack', 400);
    sys.resolve(id, 'missed', { attempt: 'light_attack' });
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'dodge',
      outcome: 'missed',
      attempt: 'light_attack',
    });
  });

  it('open() with onExpire uses its result on timeout instead of expired', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 100, () => ({
      outcome: 'invalid',
      reason: 'out_of_range',
    }));
    sys.step(100);
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'punish',
      outcome: 'invalid',
      reason: 'out_of_range',
    });
  });

  it('every opened opportunity eventually gets exactly one opp.close (denominator conservation)', () => {
    const { bus, sys } = makeSystem();
    const opened = new Set<string>();
    const closed = new Set<string>();
    bus.on('opp.open', (e) => opened.add(e.opp_id));
    bus.on('opp.close', (e) => closed.add(e.opp_id));

    const a = sys.open('dodge', 'src1', 100);
    sys.resolve(a, 'taken');
    const b = sys.open('punish', 'src2', 200);
    sys.step(200); // expires b
    const c = sys.open('dodge', 'src3', 100, () => ({ outcome: 'invalid', reason: 'out_of_range' }));
    sys.step(100); // resolves c via onExpire

    expect(closed).toEqual(opened);
    expect(opened.size).toBe(3);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/opportunity/opportunitySystem.test.ts`
Expected: FAIL — `'invalid'`/`'missed'` are not assignable to the current `OppOutcome`, and `open()` doesn't accept a fourth argument (TypeScript compile errors surface as Vitest failures).

- [ ] **Step 3: Update `src/opportunity/types.ts`**

Replace the file's contents in full:

```ts
// src/opportunity/types.ts
export type OppType = 'dodge' | 'punish';
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';
export type ActionId = 'light_attack' | 'dodge';
export type InvalidReason =
  | 'other_source_hitstun'
  | 'out_of_range'
  | 'player_dead'
  | 'tool_locked'
  | 'source_interrupted'
  | 'overlapping_priority';

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
  reason?: InvalidReason;
  attempt?: ActionId;
}
```

- [ ] **Step 4: Update `src/opportunity/opportunitySystem.ts`**

Replace the file's contents in full:

```ts
// src/opportunity/opportunitySystem.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OppType, OppOutcome, InvalidReason, ActionId } from './types';

export type ExpiryResult = { outcome: 'expired' | 'invalid'; reason?: InvalidReason };

export interface ActiveOpp {
  opp_id: string;
  type: OppType;
  src: string;
  remainingMs: number;
  onExpire?: () => ExpiryResult;
}

export interface ResolveExtras {
  reason?: InvalidReason;
  attempt?: ActionId;
}

export class OpportunitySystem {
  private active: ActiveOpp[] = [];
  private nextId = 1;

  constructor(private bus: EventBus<GameEvents>) {}

  open(type: OppType, src: string, windowMs: number, onExpire?: () => ExpiryResult): string {
    const opp_id = `opp_${this.nextId++}`;
    this.active.push({ opp_id, type, src, remainingMs: windowMs, onExpire });
    this.bus.emit('opp.open', { opp_id, type, src, window_ms: windowMs });
    return opp_id;
  }

  resolve(opp_id: string, outcome: Exclude<OppOutcome, 'expired'>, extras?: ResolveExtras): void {
    if (outcome === 'invalid' && !extras?.reason) {
      throw new Error('invalid outcome requires a reason');
    }
    const idx = this.active.findIndex((o) => o.opp_id === opp_id);
    if (idx === -1) return;
    const opp = this.active[idx];
    this.active.splice(idx, 1);
    this.bus.emit('opp.close', {
      opp_id: opp.opp_id,
      type: opp.type,
      outcome,
      ...(extras?.reason ? { reason: extras.reason } : {}),
      ...(extras?.attempt ? { attempt: extras.attempt } : {}),
    });
  }

  step(stepMs: number): void {
    const stillActive: ActiveOpp[] = [];
    for (const opp of this.active) {
      opp.remainingMs -= stepMs;
      if (opp.remainingMs <= 0) {
        const result: ExpiryResult = opp.onExpire?.() ?? { outcome: 'expired' };
        this.bus.emit('opp.close', {
          opp_id: opp.opp_id,
          type: opp.type,
          outcome: result.outcome,
          ...(result.reason ? { reason: result.reason } : {}),
        });
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/opportunity/opportunitySystem.test.ts`
Expected: PASS (10 tests — 5 existing + 5 new). The existing tests must still pass unchanged: since `extras`/`onExpire` are optional and the spread adds no keys when absent, the exact-match `toHaveBeenCalledWith({...})` assertions in the pre-existing tests keep matching object shape without `reason`/`attempt`.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: both succeed. This confirms no other file broke from the `OppOutcome`/`OppClosePayload` type changes (nothing else in the codebase currently narrows `OppOutcome` to two values).

- [ ] **Step 7: Commit**

```bash
git add src/opportunity/types.ts src/opportunity/opportunitySystem.ts src/opportunity/opportunitySystem.test.ts
git commit -m "feat: expand OppOutcome to four values with invalid-reason validation and a custom expiry hook"
```

---

## Task 2: `AssaltanteController` — wrong-action → `missed`, out-of-range punish → `invalid`

**Files:**
- Modify: `src/combat/assaltanteController.ts`
- Test: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Consumes: `ActionId`, `ExpiryResult`-shaped return values (Task 1's `OpportunitySystem.open`/`resolve`).
- Produces: `AssaltanteController.onPlayerWrongAction(attempt: ActionId): void`. Consumed by `src/combat/encounter.ts` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/combat/assaltanteController.test.ts`, inside the existing `describe('AssaltanteController', ...)` block (after the last `it(...)`):

```ts
  it('onPlayerWrongAction resolves the active dodge opportunity as missed with the given attempt', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking, opens dodge
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerWrongAction('light_attack');
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'missed', attempt: 'light_attack' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('onPlayerWrongAction outside the attacking state is a no-op', () => {
    const { enemy, bus } = makeAssaltante();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerWrongAction('light_attack'); // still idle, no active dodge opportunity
    expect(closeHandler).not.toHaveBeenCalled();
  });

  it('punish opportunity expires normally when the player is in range at some point during the window', () => {
    const { enemy, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    elapsed = 0;
    while (enemy.state === 'recovering' && elapsed < 1000) {
      enemy.step(16, { x: 70, y: 0 }); // stays within ATTACK_REACH (45) the whole window
      elapsed += 16;
    }
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'expired' }),
    );
  });

  it('punish opportunity resolves as invalid/out_of_range when the player never enters range during the window', () => {
    const { enemy, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    elapsed = 0;
    while (enemy.state === 'recovering' && elapsed < 1000) {
      enemy.step(16, { x: 1000, y: 0 }); // far outside ATTACK_REACH the whole window
      elapsed += 16;
    }
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'invalid', reason: 'out_of_range' }),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `enemy.onPlayerWrongAction is not a function`, and the punish-expiry tests fail because today every punish window always closes as `'expired'` regardless of range.

- [ ] **Step 3: Add the `ActionId` import**

In `src/combat/assaltanteController.ts`, add to the top-of-file imports (after the existing `import type { AABB, EnemyState, Vec2 } from './types';`):

```ts
import type { ActionId } from '../opportunity/types';
```

- [ ] **Step 4: Add the range-tracking field**

Add this private field next to the existing `private attackDirection: Vec2 = { x: -1, y: 0 };`:

```ts
  private playerWasInRangeDuringPunish = false;
```

- [ ] **Step 5: Reset the flag and pass `onExpire` when opening the punish opportunity**

Replace this block inside `step()`:

```ts
    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= TELEGRAPH_MS + SWING_MS) {
        this.state = 'recovering';
        this.phaseElapsedMs = 0;
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', RECOVERY_MS);
      }
      return;
    }
```

with:

```ts
    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= TELEGRAPH_MS + SWING_MS) {
        this.state = 'recovering';
        this.phaseElapsedMs = 0;
        this.playerWasInRangeDuringPunish = false;
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', RECOVERY_MS, () =>
          this.playerWasInRangeDuringPunish
            ? { outcome: 'expired' }
            : { outcome: 'invalid', reason: 'out_of_range' },
        );
      }
      return;
    }
```

- [ ] **Step 6: Track range during `recovering`**

Replace this block:

```ts
    if (this.state === 'recovering') {
      if (this.phaseElapsedMs >= RECOVERY_MS) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.activeOppId = null;
      }
      return;
    }
```

with:

```ts
    if (this.state === 'recovering') {
      if (distanceToPlayer <= ATTACK_REACH) {
        this.playerWasInRangeDuringPunish = true;
      }
      if (this.phaseElapsedMs >= RECOVERY_MS) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.activeOppId = null;
      }
      return;
    }
```

- [ ] **Step 7: Add `onPlayerWrongAction`**

Add this method next to the existing `onPlayerDodgeSuccess`/`onPlayerHitLanded`:

```ts
  onPlayerWrongAction(attempt: ActionId): void {
    if (this.state === 'attacking' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'missed', { attempt });
      this.activeOppId = null;
    }
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (17 tests — 13 existing + 4 new)

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: both succeed.

- [ ] **Step 10: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: resolve wrong-action dodge attempts as missed and out-of-range punish windows as invalid"
```

---

## Task 3: `Encounter` — wire the wrong-action trigger end-to-end

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `AssaltanteController.onPlayerWrongAction` (Task 2), the existing `player.action` bus event (already emitted by `PlayerController.tryLightAttack()`).
- Produces: no new public interface — this task only adds a bus subscription inside `Encounter`'s constructor. This is the final task of the sub-project; no further tasks consume its output.

- [ ] **Step 1: Write the failing test**

Add this test to `src/combat/encounter.test.ts`, inside the existing `describe('Encounter', ...)` block (after the last `it(...)`):

```ts
  it('attacking during the Assaltante telegraph resolves the dodge opportunity as missed', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    encounter.player.tryLightAttack();
    runFor(encounter, STEP_MS);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string; attempt?: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('missed');
    expect((dodgeClose as any).attempt).toBe('light_attack');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — the dodge opportunity currently closes as `expired` (nothing reacts to `tryLightAttack()` while the Assaltante is attacking), so `dodgeClose.outcome` is `'expired'`, not `'missed'`.

- [ ] **Step 3: Subscribe to `player.action` in the `Encounter` constructor**

In `src/combat/encounter.ts`, replace the constructor:

```ts
  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
  }
```

with:

```ts
  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);

    this.bus.on('player.action', (e) => {
      if (e.action === 'light_attack' && this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction('light_attack');
      }
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (8 tests — 7 existing + 1 new)

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all three succeed. No regression in the suite inherited from the three prior sub-projects.

- [ ] **Step 6: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire wrong-action dodge attempts into Encounter end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** four-value `OppOutcome` + `invalid`-requires-`reason` validation (Task 1), `onExpire` hook (Task 1), wrong-action `missed` trigger (Tasks 2-3), out-of-range punish `invalid` trigger (Task 2), denominator-conservation test (Task 1), end-to-end integration test (Task 3) — all match the spec's §4/§6/§7.
- **Not covered by design, correctly deferred:** the other five `InvalidReason` values, decayed accumulators, the 7 profile dimensions, deficit-target selection, rule weights — all explicitly out of scope per the spec's §1 and §8.
- **Type consistency:** `ActionId`, `InvalidReason`, `ExpiryResult` defined once in Task 1 (`opportunity/types.ts` and `opportunitySystem.ts`) and reused verbatim in Tasks 2-3. `OpportunitySystem`'s public method names (`open`, `resolve`, `step`, `activeOfType`) are unchanged from their original definition — only `open`'s and `resolve`'s parameter lists grew with optional arguments, so no existing call site in `AssaltanteController`'s pre-existing code (`onPlayerDodgeSuccess`, `onPlayerHitLanded`) needs to change.
- **Precedence check:** `taken > missed` holds structurally, not by explicit arbitration: `onPlayerDodgeSuccess()` (a successful dodge, i.e. pressing K) and `onPlayerWrongAction('light_attack')` (pressing J instead) are triggered by mutually exclusive player inputs, so they can never both fire for the same dodge window. Whichever one does fire calls `OpportunitySystem.resolve()`, which removes the opportunity from `active`; resolving an already-removed opportunity is a pre-existing no-op, so no double-resolution is possible regardless of call order.
