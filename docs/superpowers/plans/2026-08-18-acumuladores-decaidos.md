# Acumuladores Decaídos + profile.snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ProfileAccumulator` — a pure, testable class holding two independent decayed-count clocks (`trait`/`state`) per arbitrary `SkillId`, the Family A domain/confidence/deficit formulas over those counts, and the `profile.snapshot` payload shape — with no wiring to any real game event yet.

**Architecture:** New `src/profile/` module, fully decoupled from `combat/`, `opportunity/`, `ai/`, and the shared `EventBus`/`GameEvents` — mirrors the decoupling of `combat/movement.ts`. One class, two files (types + implementation), one test file.

**Tech Stack:** TypeScript (strict), Vitest. No Phaser involvement — this sub-project touches no scene/visual code.

**Spec:** `docs/superpowers/specs/2026-08-18-acumuladores-decaidos-design.md`

## Global Constraints

- `src/profile/` imports nothing from `combat/`, `opportunity/`, `ai/`, `core/eventBus`, or `core/events` — only its own types.
- No changes to any existing file — this sub-project only adds new files.
- `Math.random()` remains banned in `core/`, `combat/`, `ai/`, `opportunity/` (not applicable here — `profile/` has no randomness either, but the ban is project-wide by convention).
- TypeScript `strict: true`.
- Formulas are fixed per the spec: `domínio = (aproveitadas + 1) / (oportunidades + 2)` (α=β=1), `confiança = oportunidades / (oportunidades + 10)` (κ=10), `déficit = 1 - domínio`. `γ_traço = 0.87`, `γ_estado = 0.55`.

---

## Task 1: `ProfileAccumulator`

**Files:**
- Create: `src/profile/types.ts`
- Create: `src/profile/profileAccumulator.ts`
- Test: `src/profile/profileAccumulator.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task of this sub-project).
- Produces: `SkillId = string`, `Clock = 'trait' | 'state'`, `ProfileSnapshotPayload` (from `src/profile/types.ts`), and `class ProfileAccumulator` with `recordOutcome(skill: SkillId, taken: boolean): void`, `applyRoomBoundary(): void`, `applyEncounterBoundary(): void`, `resetSession(): void`, `domain(skill: SkillId, clock: Clock): number`, `confidence(skill: SkillId, clock: Clock): number`, `deficit(skill: SkillId, clock: Clock): number`, `snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload` (from `src/profile/profileAccumulator.ts`). No later task in this plan consumes it — this is the sub-project's only task; a future sub-project (Family A/B dimensions) will consume it.

- [ ] **Step 1: Create `src/profile/types.ts`**

```ts
// src/profile/types.ts
export type SkillId = string;
export type Clock = 'trait' | 'state';

export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  counts: Record<SkillId, [number, number]>; // [aproveitadas, oportunidades], relógio traço
  domain: Record<SkillId, number>;
  confidence: Record<SkillId, number>;
  target: SkillId | null;
  lambda: number;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/profile/profileAccumulator.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from './profileAccumulator';

describe('ProfileAccumulator', () => {
  it('a skill never recorded starts with domain 0.5 (uniform prior), confidence 0, deficit 0.5', () => {
    const acc = new ProfileAccumulator();
    expect(acc.domain('punish', 'trait')).toBeCloseTo(0.5);
    expect(acc.confidence('punish', 'trait')).toBe(0);
    expect(acc.deficit('punish', 'trait')).toBeCloseTo(0.5);
  });

  it('recordOutcome followed by applyRoomBoundary updates trait domain and confidence', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 9; i++) acc.recordOutcome('punish', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    // pending folded into a zero total: aproveitadas=9, oportunidades=10
    expect(acc.domain('punish', 'trait')).toBeCloseTo((9 + 1) / (10 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(10 / (10 + 10));
  });

  it('applyRoomBoundary decays existing totals by gamma even with no new records', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('punish', true);
    acc.applyRoomBoundary(); // total = {10, 10}
    acc.applyRoomBoundary(); // no new pending: total = {0.87*10, 0.87*10} = {8.7, 8.7}
    expect(acc.domain('punish', 'trait')).toBeCloseTo((8.7 + 1) / (8.7 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(8.7 / (8.7 + 10));
  });

  it('applyEncounterBoundary decays existing totals by its own gamma', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('dodge', true);
    acc.applyEncounterBoundary(); // total = {10, 10}
    acc.applyEncounterBoundary(); // total = {0.55*10, 0.55*10} = {5.5, 5.5}
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5.5 + 1) / (5.5 + 2));
  });

  it('the trait and state clocks are independent: only their own boundary call decays them', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary();
    // state clock untouched: applyEncounterBoundary was never called
    expect(acc.domain('dodge', 'state')).toBeCloseTo(0.5);
    expect(acc.confidence('dodge', 'state')).toBe(0);

    acc.applyEncounterBoundary();
    // now the state clock folds in the same pending the trait clock already consumed
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5 + 1) / (5 + 2));
    // the trait clock (already boundary'd earlier) is unaffected by this call
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((5 + 1) / (5 + 2));
  });

  it('multiple room boundaries accumulate rather than reset between calls', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary(); // total = {1, 1}
    acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary(); // total = {0.87*1 + 1, 0.87*1 + 1} = {1.87, 1.87}
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((1.87 + 1) / (1.87 + 2));
  });

  it('resetSession zeroes both clocks and pending buffers', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary();
    acc.resetSession();
    expect(acc.domain('dodge', 'trait')).toBeCloseTo(0.5);
    expect(acc.domain('dodge', 'state')).toBeCloseTo(0.5);
    expect(acc.confidence('dodge', 'trait')).toBe(0);
    expect(acc.confidence('dodge', 'state')).toBe(0);
  });

  it('snapshot() reflects only the trait clock, with target null and lambda 0', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 3; i++) acc.recordOutcome('punish', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary(); // state clock also updated — must not leak into the snapshot

    const snap = acc.snapshot('room.exit');
    expect(snap.at).toBe('room.exit');
    expect(snap.counts.punish).toEqual([3, 4]);
    expect(snap.domain.punish).toBeCloseTo((3 + 1) / (4 + 2));
    expect(snap.confidence.punish).toBeCloseTo(4 / (4 + 10));
    expect(snap.target).toBeNull();
    expect(snap.lambda).toBe(0);
  });

  it('snapshot() includes multiple skills simultaneously', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    const snap = acc.snapshot('boss.entry');
    expect(Object.keys(snap.counts).sort()).toEqual(['dodge', 'punish']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: FAIL — `Cannot find module './profileAccumulator'`

- [ ] **Step 4: Write the implementation**

```ts
// src/profile/profileAccumulator.ts
import type { SkillId, Clock, ProfileSnapshotPayload } from './types';

const TRAIT_GAMMA = 0.87;
const STATE_GAMMA = 0.55;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const CONFIDENCE_KAPPA = 10;

interface SkillCounts {
  aproveitadas: number;
  oportunidades: number;
}

function emptyCounts(): SkillCounts {
  return { aproveitadas: 0, oportunidades: 0 };
}

export class ProfileAccumulator {
  private traitTotals = new Map<SkillId, SkillCounts>();
  private stateTotals = new Map<SkillId, SkillCounts>();
  private traitPending = new Map<SkillId, SkillCounts>();
  private statePending = new Map<SkillId, SkillCounts>();

  recordOutcome(skill: SkillId, taken: boolean): void {
    this.addToPending(this.traitPending, skill, taken);
    this.addToPending(this.statePending, skill, taken);
  }

  applyRoomBoundary(): void {
    this.decayAndFold(this.traitTotals, this.traitPending, TRAIT_GAMMA);
  }

  applyEncounterBoundary(): void {
    this.decayAndFold(this.stateTotals, this.statePending, STATE_GAMMA);
  }

  resetSession(): void {
    this.traitTotals.clear();
    this.stateTotals.clear();
    this.traitPending.clear();
    this.statePending.clear();
  }

  domain(skill: SkillId, clock: Clock): number {
    const c = this.totalsFor(clock).get(skill) ?? emptyCounts();
    return (c.aproveitadas + BETA_ALPHA) / (c.oportunidades + BETA_ALPHA + BETA_BETA);
  }

  confidence(skill: SkillId, clock: Clock): number {
    const c = this.totalsFor(clock).get(skill) ?? emptyCounts();
    return c.oportunidades / (c.oportunidades + CONFIDENCE_KAPPA);
  }

  deficit(skill: SkillId, clock: Clock): number {
    return 1 - this.domain(skill, clock);
  }

  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload {
    const counts: Record<SkillId, [number, number]> = {};
    const domain: Record<SkillId, number> = {};
    const confidence: Record<SkillId, number> = {};
    for (const [skill, c] of this.traitTotals) {
      counts[skill] = [c.aproveitadas, c.oportunidades];
      domain[skill] = this.domain(skill, 'trait');
      confidence[skill] = this.confidence(skill, 'trait');
    }
    return { at, counts, domain, confidence, target: null, lambda: 0 };
  }

  private totalsFor(clock: Clock): Map<SkillId, SkillCounts> {
    return clock === 'trait' ? this.traitTotals : this.stateTotals;
  }

  private addToPending(pending: Map<SkillId, SkillCounts>, skill: SkillId, taken: boolean): void {
    const c = pending.get(skill) ?? emptyCounts();
    c.oportunidades += 1;
    if (taken) c.aproveitadas += 1;
    pending.set(skill, c);
  }

  private decayAndFold(
    totals: Map<SkillId, SkillCounts>,
    pending: Map<SkillId, SkillCounts>,
    gamma: number,
  ): void {
    const skills = new Set([...totals.keys(), ...pending.keys()]);
    for (const skill of skills) {
      const total = totals.get(skill) ?? emptyCounts();
      const p = pending.get(skill) ?? emptyCounts();
      totals.set(skill, {
        aproveitadas: gamma * total.aproveitadas + p.aproveitadas,
        oportunidades: gamma * total.oportunidades + p.oportunidades,
      });
    }
    pending.clear();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npm run test && npm run typecheck && npm run build`
Expected: all three succeed. No existing file was modified, so this is purely additive — no regression possible in the inherited suite.

- [ ] **Step 7: Commit**

```bash
git add src/profile/types.ts src/profile/profileAccumulator.ts src/profile/profileAccumulator.test.ts
git commit -m "feat: add ProfileAccumulator — decayed trait/state clocks and profile.snapshot shape"
```

---

## Self-Review Notes

- **Spec coverage:** two independent decayed clocks (§4, tested by the trait/state independence test), Family A domain/confidence/deficit formulas (§3.1/§5, tested at zero-count and post-record states), `resetSession()` as the sole reset point (§6 D4, tested structurally), `profile.snapshot` shape reading only the trait clock with `target`/`lambda` placeholders (§7) — all covered by this single task's tests.
- **Not covered by design, correctly deferred:** any real game-event wiring, Family A's real dimension-specific numerators/denominators, Family B entropy, déficit-alvo selection, `GameEvents`/`EventBus` integration — all explicitly out of scope per the spec's §1 and §8.
- **Type consistency:** `SkillId`, `Clock`, `ProfileSnapshotPayload` defined once in `types.ts` and used verbatim in `profileAccumulator.ts` and the test file. No other file in the codebase imports from `src/profile/` yet (first-ever consumer will be a future sub-project), so there is no cross-task interface to keep consistent this round.
