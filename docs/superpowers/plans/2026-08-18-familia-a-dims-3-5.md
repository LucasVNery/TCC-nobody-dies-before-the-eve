# Família A, Dimensões 3 e 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `Encounter`'s existing `ProfileAccumulator` (unused since the previous sub-project) to real game data for the two Family A dimensions that are implementable today: dim 3 (punish conversion, via `opp.close` events) and dim 5 (operational distance, via per-tick position tracking).

**Architecture:** All changes live in `src/combat/encounter.ts` — no new files. `Encounter` already owns the `EventBus` and both controllers' positions; this sub-project only adds a `ProfileAccumulator` field, one bus subscription, and one calculation inside `step()`.

**Tech Stack:** TypeScript (strict), Vitest. No Phaser involvement.

**Spec:** `docs/superpowers/specs/2026-08-18-familia-a-dims-3-5-design.md`

## Global Constraints

- No automatic room/encounter boundary trigger is introduced — `applyRoomBoundary()`/`applyEncounterBoundary()` remain exclusively manually callable (tests call them directly), per the explicit, twice-validated decision that inventing boundary semantics before rooms/PCG exist would encode a fiction.
- No changes to `AssaltanteController`, `PlayerController`, `OpportunitySystem`, or `ProfileAccumulator` — this sub-project only wires `Encounter`.
- TypeScript `strict: true`.
- `ATTACK_REACH` (already defined in `src/combat/movementDefs.ts`) is the "alcance corpo-a-corpo" threshold for dim 5 — no new constant.

---

## Task 1: Wire `Encounter` to `ProfileAccumulator` for dims 3 and 5

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `ProfileAccumulator` (`src/profile/profileAccumulator.ts`, already exists — `recordOutcome(skill, outcome)`, `record(skill, numerator, denominator)`, `applyRoomBoundary()`, `domain(skill, clock)`), `ATTACK_REACH` (`src/combat/movementDefs.ts`, already exists).
- Produces: `Encounter.profile: ProfileAccumulator` (public readonly field). This is the final task of this sub-project — no further tasks consume its output.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `src/combat/encounter.test.ts`, inside the existing `describe('Encounter', ...)` block (after the last `it(...)`):

```ts
  it('a punish opportunity resolved as taken raises the punish skill domain above the uniform prior', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.assaltante.state).toBe('recovering');

    encounter.player.tryLightAttack();
    runFor(encounter, 300);

    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.domain('punish', 'trait')).toBeGreaterThan(0.5);
  });

  it('staying within ATTACK_REACH the whole time drives the distance skill domain toward 1', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );
    runFor(encounter, 2000);
    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.domain('distance', 'trait')).toBeGreaterThan(0.9);
  });

  it('staying outside ATTACK_REACH drives the distance skill domain toward 0', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 500, y: 0, width: 20, height: 20 },
    );
    runFor(encounter, 500); // not enough time for the (slower) Assaltante to close a ~480px gap into ATTACK_REACH
    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.domain('distance', 'trait')).toBeLessThan(0.1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `encounter.profile` is `undefined` (property does not exist on `Encounter` yet).

- [ ] **Step 3: Add the `profile` field and its two data sources**

In `src/combat/encounter.ts`, replace the file's contents in full:

```ts
// src/combat/encounter.ts
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { PlayerController } from './playerController';
import { AssaltanteController } from './assaltanteController';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { aabbOverlap } from './collision';
import { ATTACK_REACH } from './movementDefs';
import type { AABB } from './types';

export class Encounter {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  readonly profile: ProfileAccumulator;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = new ProfileAccumulator();

    this.bus.on('player.action', (e) => {
      if (e.action === 'light_attack' && this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.action);
      }
    });

    this.bus.on('opp.close', (e) => {
      if (e.type === 'punish' && e.outcome !== 'invalid') {
        this.profile.recordOutcome('punish', e.outcome);
      }
    });
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

    const dx = this.assaltante.position.x - this.player.position.x;
    const dy = this.assaltante.position.y - this.player.position.y;
    const distance = Math.hypot(dx, dy);
    this.profile.record('distance', distance <= ATTACK_REACH ? stepMs : 0, stepMs);
  }
}
```

Note: the `opp.close` handler's `if (e.type === 'punish' && e.outcome !== 'invalid')` guard narrows `e.outcome` from `OppOutcome` (`'taken'|'missed'|'expired'|'invalid'`) to exactly `'taken'|'missed'|'expired'` — TypeScript's control-flow narrowing makes this assignable to `ProfileAccumulator.recordOutcome`'s `ProfileOutcome` parameter with no cast needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (11 tests — 8 existing + 3 new)

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all three succeed. No regression in the suite inherited from the five prior sub-projects.

- [ ] **Step 6: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire Encounter's ProfileAccumulator to real punish outcomes and operational distance (Family A dims 3+5)"
```

---

## Self-Review Notes

- **Spec coverage:** dim 3 wiring via `opp.close` subscription (§4/§5), dim 5 wiring via per-tick distance tracking (§4/§5), no automatic boundary trigger introduced (§1/§2 constraint), tests exercising both dimensions end-to-end through `Encounter.step()` (§6) — all covered by this single task.
- **Not covered by design, correctly deferred:** dims 6/7, Family B, deficit-target selection, real room/encounter boundaries — all explicitly out of scope per the spec's §1 and §8.
- **Type consistency:** `ProfileAccumulator`'s public method names/signatures (`recordOutcome`, `record`, `applyRoomBoundary`, `domain`) are unchanged from the prior sub-project — this task only calls them, doesn't modify them. `ATTACK_REACH` is reused verbatim from `movementDefs.ts`, already used elsewhere in `combat/` for the same "melee reach" concept.
