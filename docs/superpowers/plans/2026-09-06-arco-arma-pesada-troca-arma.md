# Mira por Mouse + Arco/Arma Pesada + Troca de Arma (dim 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mouse-driven aim (separate from WASD movement), two new weapons (bow, heavy weapon), weapon switching with a dodge-cancelable recovery, and wire the resulting per-weapon attack stream into a new `weapon_repertoire` entropy dimension (dim 1) on the player profile.

**Architecture:** `visual/isometricProjection.ts` gains `fromScreen`, the exact linear inverse of the existing `toScreen`. `PlayerController` splits its single movement-derived direction into `lastMoveDirection` (WASD, dash only) and `aimDirection` (mouse, attack hitbox + visual `facing`), and gains an `equippedWeaponId` + a parallel `attackLockedMs` timer for weapon switching (orthogonal to the existing `idle`/`acting`/`dodging` state machine — switching never blocks movement). `combat/actionRegistry.ts` gains two new weapons' `ActionDef`s and a `findWeaponAction` lookup that lets `ArenaScene` resolve "what does the left/right mouse button or Q do right now" purely from data, with no per-weapon branching. `ProfileAccumulator` gets a second `EntropyAccumulator` instance (`weapon_repertoire`) — no new class, since it was built generic-over-labels in the prior sub-project specifically so this would be free.

**Tech Stack:** TypeScript, Vitest (TDD), Phaser 3 pointer input (`pointerdown`, `pointer.leftButtonDown()`/`rightButtonDown()`), no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-arco-arma-pesada-troca-arma-design.md`

## Global Constraints

- No new npm dependencies.
- `WEAPON_IDS` has exactly 3 members (`sword_shield`, `bow`, `heavy_weapon`) — n=3 fixed for dim 1, no weapon-unlock mechanic in this sub-project.
- The bow is a single-action weapon (`bow.shot`, `actionType: 'throw'`) — instant-hit, long reach, no traveling projectile.
- Weapon switching never blocks movement — only `tryAction()` is blocked during the `SWITCH_RECOVERY_MS` (250ms) window, and a dodge clears that block immediately.
- Determinism: no real time or `Math.random` in any new/changed unit — `PlayerController` stays driven by explicit `stepMs`/`setAimDirection` calls; `fromScreen` is a pure function of its input.
- `facing`'s contract changes deliberately in this plan: it now reflects `aimDirection` (mouse), not the last WASD movement direction. The existing test describing the old contract is rewritten, not silently dropped.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/visual/isometricProjection.ts` (edit) | Adds `fromScreen(delta, config)` — exact linear inverse of `toScreen`. |
| `src/combat/playerController.ts` (edit) | Splits `lastDirection` into `lastMoveDirection`/`aimDirection`; adds `setAimDirection()`; adds `equippedWeaponId`/`switchWeapon()`/`attackLockedMs` and the two new `tryAction()` guards. |
| `src/combat/actionRegistry.ts` (edit) | Adds `WEAPON_IDS`, `HEAVY_WEAPON_ACTIONS`, `BOW_ACTIONS`, `findWeaponAction()`. |
| `src/combat/actionDefs.ts` (edit) | Adds `SWITCH_RECOVERY_MS = 250`. |
| `src/profile/profileAccumulator.ts` (edit) | Adds the `weapon_repertoire` entropy dim; `recordAction()` gains an optional `weaponId` parameter. |
| `src/combat/encounter.ts` (edit) | `player.action` handler passes `e.weaponId` through to `profile.recordAction()`. |
| `src/scenes/ArenaScene.ts` (edit) | Mouse-driven aim each frame; weapon-select keys (1/2/3); left/right click + Q resolved dynamically per equipped weapon via `findWeaponAction`. |

Corresponding test files: `isometricProjection.test.ts`, `playerController.test.ts`, `actionRegistry.test.ts`, `profileAccumulator.test.ts`, `encounter.test.ts` (all edited, appended to — no test file is fully replaced in this plan).

---

### Task 1: `isometricProjection.fromScreen` — inverse of the iso projection

**Files:**
- Modify: `src/visual/isometricProjection.ts`
- Modify: `src/visual/isometricProjection.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `IsoConfig` (already exist in this file).
- Produces: `fromScreen(delta: Vec2, config: IsoConfig): Vec2` — consumed by Task 7 (`ArenaScene`).

- [ ] **Step 1: Write the failing tests** — append to `src/visual/isometricProjection.test.ts`, after the existing `import` line add `fromScreen` to the import, then add a new `describe` block before the file's end:

```ts
import { toScreen, screenDepth, fromScreen, type IsoConfig } from './isometricProjection';
```

```ts
describe('fromScreen', () => {
  it('is the inverse of toScreen for a point along world +x', () => {
    const worldPoint = { x: 64, y: 0 };
    expect(fromScreen(toScreen(worldPoint, config), config)).toEqual(worldPoint);
  });

  it('is the inverse of toScreen for a point along world +y', () => {
    const worldPoint = { x: 0, y: 64 };
    expect(fromScreen(toScreen(worldPoint, config), config)).toEqual(worldPoint);
  });

  it('is the inverse of toScreen for an arbitrary point', () => {
    const worldPoint = { x: 96, y: -32 };
    const recovered = fromScreen(toScreen(worldPoint, config), config);
    expect(recovered.x).toBeCloseTo(worldPoint.x);
    expect(recovered.y).toBeCloseTo(worldPoint.y);
  });

  it('maps the screen origin to the world origin', () => {
    expect(fromScreen({ x: 0, y: 0 }, config)).toEqual({ x: 0, y: 0 });
  });

  it('is linear: fromScreen(a) + fromScreen(b) == fromScreen(a + b)', () => {
    const a = { x: 40, y: 24 };
    const b = { x: -16, y: 8 };
    const sum = { x: a.x + b.x, y: a.y + b.y };
    const fa = fromScreen(a, config);
    const fb = fromScreen(b, config);
    const fSum = fromScreen(sum, config);
    expect(fSum.x).toBeCloseTo(fa.x + fb.x);
    expect(fSum.y).toBeCloseTo(fa.y + fb.y);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/visual/isometricProjection.test.ts`
Expected: FAIL — `fromScreen` is not exported.

- [ ] **Step 3: Implement `fromScreen` in `src/visual/isometricProjection.ts`**

Add after `toScreen`:

```ts
export function fromScreen(delta: Vec2, config: IsoConfig): Vec2 {
  const col = (delta.x / config.halfWidth + delta.y / config.halfHeight) / 2;
  const row = (delta.y / config.halfHeight - delta.x / config.halfWidth) / 2;
  return {
    x: col * config.tileWorldSize,
    y: row * config.tileWorldSize,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/visual/isometricProjection.test.ts`
Expected: PASS (14 tests: 9 pre-existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/visual/isometricProjection.ts src/visual/isometricProjection.test.ts
git commit -m "feat: add fromScreen, the linear inverse of the isometric toScreen projection"
```

---

### Task 2: `PlayerController` — split aim direction from movement direction

**Files:**
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: `normalizeVelocity` (already imported from `./movement`).
- Produces: `PlayerController.setAimDirection(direction: Vec2): void`; `facing` now returns the aim direction — consumed by Task 7 (`ArenaScene`) and by Task 4's own `attackHitbox()` reach/direction logic (unchanged mechanism, new source field).

- [ ] **Step 1: Write the failing tests** — in `src/combat/playerController.test.ts`, replace the existing test `'exposes the last movement direction via facing, for visual/HUD purposes'` (the whole `it(...)` block) with:

```ts
  it('facing defaults to aiming right before any setAimDirection call', () => {
    const { player } = makePlayer();
    expect(player.facing).toEqual({ x: 1, y: 0 });
  });

  it('setAimDirection normalizes the vector and updates facing', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 5 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('setAimDirection with a zero vector leaves the previous aim unchanged', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 1 });
    player.setAimDirection({ x: 0, y: 0 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('attackHitbox() follows aimDirection, independent of the last movement direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16); // moving right
    player.setAimDirection({ x: 0, y: -1 }); // aiming up
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.y).toBeLessThan(player.hurtbox().y); // reach strip is above the hurtbox, matching the aim
  });

  it('dash still uses the last movement direction, not the aim direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16);
    player.setMoveInput(0, 0);
    player.setAimDirection({ x: -1, y: 0 }); // aiming the opposite way from the dash
    const beforeX = player.position.x;
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(beforeX); // still dashes right (movement dir), not left (aim dir)
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `setAimDirection` is not a function; the old facing test is gone so no failure from it.

- [ ] **Step 3: Update `src/combat/playerController.ts`**

Rename the field and add the new one — replace:

```ts
  private lastDirection: Vec2 = { x: 1, y: 0 };
  private dashDirection: Vec2 = { x: 1, y: 0 };
```

with:

```ts
  private lastMoveDirection: Vec2 = { x: 1, y: 0 };
  private aimDirection: Vec2 = { x: 1, y: 0 };
  private dashDirection: Vec2 = { x: 1, y: 0 };
```

Replace the `facing` getter:

```ts
  get facing(): Vec2 {
    return { x: this.aimDirection.x, y: this.aimDirection.y };
  }
```

Add a new public method, near `setMoveInput`:

```ts
  setAimDirection(direction: Vec2): void {
    const normalized = normalizeVelocity(direction.x, direction.y);
    if (normalized.x === 0 && normalized.y === 0) return; // mouse exactly over the player — keep the previous aim
    this.aimDirection = normalized;
  }
```

In `attackHitbox()`, replace both occurrences of `this.lastDirection` with `this.aimDirection`:

```ts
  attackHitbox(): AABB | null {
    if (this.state !== 'acting' || !this.currentAction) return null;

    if (this.currentAction.actionType === 'charged') {
      if (!this.chargeTriggered) return null;
      if (this.phaseElapsedMs >= this.currentAction.timing.activeMs) return null;
      return directionalHitbox(this._position, this.width, this.height, this.aimDirection, this.chargedReach());
    }

    const { startupMs, activeMs } = this.currentAction.timing;
    const inActive = this.phaseElapsedMs >= startupMs && this.phaseElapsedMs < startupMs + activeMs;
    if (!inActive) return null;
    return directionalHitbox(this._position, this.width, this.height, this.aimDirection, this.currentAction.reach);
  }
```

In `tryDodge()`, replace `this.dashDirection = this.lastDirection;` with:

```ts
    this.dashDirection = this.lastMoveDirection;
```

In `step()`'s `idle` branch, replace `this.lastDirection = direction;` with:

```ts
        this.lastMoveDirection = direction;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (23 tests: 19 pre-existing minus the 1 rewritten, plus the 5 new = 23).

- [ ] **Step 5: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "refactor: split PlayerController's aim direction (mouse) from movement direction (WASD)"
```

---

### Task 3: `combat/actionRegistry.ts` — bow and heavy weapon data

**Files:**
- Modify: `src/combat/actionRegistry.ts`
- Modify: `src/combat/actionRegistry.test.ts`

**Interfaces:**
- Consumes: `ActionDef`, `ActionType`, `ChargeSpec`, `ActionPhaseTiming` (already exist in this file).
- Produces: `WEAPON_IDS: readonly string[]`, `HEAVY_WEAPON_ACTIONS: ActionDef[]`, `BOW_ACTIONS: ActionDef[]`, `findWeaponAction(weaponId: string, actionType: ActionType): ActionDef | undefined` — consumed by Task 4 (`PlayerController`), Task 5 (`ProfileAccumulator`), Task 7 (`ArenaScene`).

- [ ] **Step 1: Write the failing tests** — append to `src/combat/actionRegistry.test.ts` (add `WEAPON_IDS`, `HEAVY_WEAPON_ACTIONS`, `BOW_ACTIONS`, `findWeaponAction` to the existing import line, then add a new `describe` block):

```ts
import {
  ACTION_REGISTRY,
  ACTION_TYPES,
  resolveAction,
  SWORD_SHIELD_ACTIONS,
  WEAPON_IDS,
  HEAVY_WEAPON_ACTIONS,
  BOW_ACTIONS,
  findWeaponAction,
} from './actionRegistry';
```

```ts
describe('bow and heavy_weapon data', () => {
  it('WEAPON_IDS has exactly 3 members', () => {
    expect(WEAPON_IDS).toEqual(['sword_shield', 'bow', 'heavy_weapon']);
  });

  it('ACTION_REGISTRY contains all three weapons worth of actions', () => {
    expect(ACTION_REGISTRY.size).toBe(
      SWORD_SHIELD_ACTIONS.length + HEAVY_WEAPON_ACTIONS.length + BOW_ACTIONS.length,
    );
  });

  it('the bow has exactly one action, of type throw', () => {
    expect(BOW_ACTIONS).toHaveLength(1);
    expect(BOW_ACTIONS[0].actionType).toBe('throw');
    expect(BOW_ACTIONS[0].charge).toBeUndefined();
  });

  it('heavy_weapon mirrors sword_shield\'s three action types', () => {
    const types = HEAVY_WEAPON_ACTIONS.map((a) => a.actionType).sort();
    expect(types).toEqual(['charged', 'heavy', 'light']);
  });

  it('heavy_weapon.charged has consistent hold bounds and a higher reach ceiling than sword_shield.charged', () => {
    const heavyCharged = resolveAction('heavy_weapon.charged');
    const swordCharged = resolveAction('sword_shield.charged');
    expect(heavyCharged.charge!.minHoldMs).toBeLessThan(heavyCharged.charge!.maxHoldMs);
    expect(heavyCharged.charge!.reachMax).toBeGreaterThan(swordCharged.charge!.reachMax);
  });
});

describe('findWeaponAction', () => {
  it('returns the matching ActionDef when it exists', () => {
    const action = findWeaponAction('bow', 'throw');
    expect(action?.id).toBe('bow.shot');
  });

  it('returns undefined for a weapon/actionType combination that does not exist', () => {
    expect(findWeaponAction('bow', 'heavy')).toBeUndefined();
    expect(findWeaponAction('bow', 'charged')).toBeUndefined();
  });

  it('returns undefined for an unknown weaponId', () => {
    expect(findWeaponAction('unknown_weapon', 'light')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: FAIL — `WEAPON_IDS`/`HEAVY_WEAPON_ACTIONS`/`BOW_ACTIONS`/`findWeaponAction` are not exported.

- [ ] **Step 3: Update `src/combat/actionRegistry.ts`**

Add after `SWORD_SHIELD_ACTIONS`:

```ts
export const WEAPON_IDS: readonly string[] = ['sword_shield', 'bow', 'heavy_weapon'];

export const HEAVY_WEAPON_ACTIONS: ActionDef[] = [
  {
    id: 'heavy_weapon.light',
    weaponId: 'heavy_weapon',
    actionType: 'light',
    timing: { startupMs: 160, activeMs: 120, recoveryMs: 220 },
    reach: 55,
  },
  {
    id: 'heavy_weapon.heavy',
    weaponId: 'heavy_weapon',
    actionType: 'heavy',
    timing: { startupMs: 320, activeMs: 150, recoveryMs: 420 },
    reach: 70,
  },
  {
    id: 'heavy_weapon.charged',
    weaponId: 'heavy_weapon',
    actionType: 'charged',
    timing: { startupMs: 200, activeMs: 180, recoveryMs: 500 },
    reach: 65,
    charge: { minHoldMs: 200, maxHoldMs: 1100, reachMax: 90 },
  },
];

export const BOW_ACTIONS: ActionDef[] = [
  {
    id: 'bow.shot',
    weaponId: 'bow',
    actionType: 'throw',
    timing: { startupMs: 80, activeMs: 60, recoveryMs: 200 },
    reach: 220,
  },
];
```

Replace the `ACTION_REGISTRY` construction:

```ts
export const ACTION_REGISTRY: ReadonlyMap<string, ActionDef> = buildRegistry([
  SWORD_SHIELD_ACTIONS,
  HEAVY_WEAPON_ACTIONS,
  BOW_ACTIONS,
]);
```

Add after `resolveAction`:

```ts
export function findWeaponAction(weaponId: string, actionType: ActionType): ActionDef | undefined {
  for (const action of ACTION_REGISTRY.values()) {
    if (action.weaponId === weaponId && action.actionType === actionType) return action;
  }
  return undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: PASS (15 tests: 6 pre-existing + 9 new).

- [ ] **Step 5: Commit**

```bash
git add src/combat/actionRegistry.ts src/combat/actionRegistry.test.ts
git commit -m "feat: add bow and heavy_weapon action data, plus findWeaponAction lookup"
```

---

### Task 4: `PlayerController` — weapon switching

**Files:**
- Modify: `src/combat/actionDefs.ts`
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: `SWITCH_RECOVERY_MS` (new, this task); `resolveAction`, `WEAPON_IDS` semantics from Task 3 (uses `'bow'`/`'heavy_weapon'`/`'sword_shield'` action ids directly in tests, not the constant itself).
- Produces: `PlayerController.equippedWeaponId: string`, `PlayerController.switchWeapon(weaponId: string): void` — consumed by Task 6 (`Encounter` tests) and Task 7 (`ArenaScene`).

- [ ] **Step 1: Add `SWITCH_RECOVERY_MS` to `src/combat/actionDefs.ts`**

Add after the `DODGE` constant:

```ts
export const SWITCH_RECOVERY_MS = 250;
```

- [ ] **Step 2: Write the failing tests** — add `SWITCH_RECOVERY_MS` to the existing `actionDefs` import line in `src/combat/playerController.test.ts`:

```ts
import { DODGE, SWITCH_RECOVERY_MS } from './actionDefs';
```

Append a new `describe` block at the end of the file, before the final closing `});`:

```ts
describe('PlayerController — weapon switching', () => {
  it('defaults to sword_shield equipped', () => {
    const { player } = makePlayer();
    expect(player.equippedWeaponId).toBe('sword_shield');
  });

  it('switchWeapon changes the equipped weapon and locks attacks for SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    expect(player.equippedWeaponId).toBe('bow');
    expect(() => player.tryAction('bow.shot')).not.toThrow();
    expect(player.state).toBe('idle'); // rejected: still locked
  });

  it('the attack lock clears on its own after SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS);
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching to the already-equipped weapon is a no-op and does not lock attacks', () => {
    const { player } = makePlayer();
    player.switchWeapon('sword_shield'); // already equipped
    player.tryAction('sword_shield.light');
    expect(player.state).toBe('acting');
  });

  it('tryDodge cancels the switch lock immediately', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.tryDodge();
    player.step(DODGE.durationMs); // return to idle
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching again before the previous lock elapses resets the lock to a full SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS - 20); // 20ms left on the first lock
    player.switchWeapon('heavy_weapon'); // resets to a fresh SWITCH_RECOVERY_MS
    player.step(30); // would have cleared the *first* lock, not a fresh one
    expect(() => player.tryAction('heavy_weapon.light')).not.toThrow();
    expect(player.state).toBe('idle'); // still locked
  });

  it('tryAction rejects an action belonging to a non-equipped weapon, without throwing or changing state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('bow.shot')).not.toThrow(); // sword_shield still equipped by default
    expect(player.state).toBe('idle');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `switchWeapon`/`equippedWeaponId` do not exist.

- [ ] **Step 4: Update `src/combat/playerController.ts`**

Update the import from `./actionDefs`:

```ts
import { DODGE, SWITCH_RECOVERY_MS } from './actionDefs';
```

Add two fields, near the top of the class body (alongside `chargeHeldMs`/`chargeTriggered`):

```ts
  equippedWeaponId: string = 'sword_shield';
  private attackLockedMs = 0;
```

Add a new public method, near `tryDodge`:

```ts
  switchWeapon(weaponId: string): void {
    if (this.state !== 'idle' || weaponId === this.equippedWeaponId) return;
    this.equippedWeaponId = weaponId;
    this.attackLockedMs = SWITCH_RECOVERY_MS;
  }
```

Update `tryAction`'s guard clause and add the weapon check right after resolving the action:

```ts
  tryAction(actionId: string): void {
    if (this.state !== 'idle' || this.attackLockedMs > 0) return;
    const action = resolveAction(actionId); // throws for unknown ids, before any state mutation
    if (action.weaponId !== this.equippedWeaponId) return;

    this.state = 'acting';
    this.phaseElapsedMs = 0;
    this.currentAction = action;
    this.chargeHeldMs = 0;
    this.chargeTriggered = action.actionType !== 'charged';
    if (action.actionType !== 'charged') {
      this.emitActionEvent(action);
    }
  }
```

Add one line to `tryDodge` (right after `this.dashDirection = this.lastMoveDirection;`):

```ts
    this.attackLockedMs = 0;
```

Update `step()`'s top (alongside the existing `dodgeCooldownRemainingMs` decrement):

```ts
  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }
    if (this.attackLockedMs > 0) {
      this.attackLockedMs = Math.max(0, this.attackLockedMs - stepMs);
    }
```

(the rest of `step()` is unchanged — this is two new lines right after the existing `dodgeCooldownRemainingMs` block)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (30 tests: 23 from Task 2 + 7 new).

- [ ] **Step 6: Commit**

```bash
git add src/combat/actionDefs.ts src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: add weapon switching with a dodge-cancelable recovery lock"
```

---

### Task 5: `ProfileAccumulator` — dim 1 (`weapon_repertoire`)

**Files:**
- Modify: `src/profile/profileAccumulator.ts`
- Modify: `src/profile/profileAccumulator.test.ts`

**Interfaces:**
- Consumes: `WEAPON_IDS` from Task 3.
- Produces: `ProfileAccumulator.recordAction(actionType: ActionType, weaponId?: string): void` (signature widened — `weaponId` is optional, see note below) — consumed by Task 6 (`Encounter`).

Note on the optional `weaponId`: the spec's §5 snippet shows `recordAction(actionType, weaponId)` with both required. Making `weaponId` optional avoids forcing every pre-existing call in `profileAccumulator.test.ts` (`acc.recordAction('light')`, from the prior sub-project) to pass a throwaway weapon id just to keep compiling — those tests are about `action_repertoire` in isolation and don't care about weapons. `Encounter` (Task 6) always has both fields available from `PlayerActionPayload` and always passes both.

- [ ] **Step 1: Write the failing tests** — append to `src/profile/profileAccumulator.test.ts`, in a new `describe` block before the file's closing `});`:

```ts
describe('ProfileAccumulator — weapon repertoire (Família B, dim 1)', () => {
  it('a skill with no attacks recorded has a null domain and deficit', () => {
    const acc = new ProfileAccumulator();
    acc.applyRoomBoundary();
    expect(acc.domain('weapon_repertoire', 'trait')).toBeNull();
    expect(acc.deficit('weapon_repertoire', 'trait')).toBeNull();
  });

  it('recordAction() feeds the weapon_repertoire entropy dimension when a weaponId is given', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 4; i++) acc.recordAction('light', 'sword_shield');
    for (let i = 0; i < 3; i++) acc.recordAction('throw', 'bow');
    acc.recordAction('light', 'heavy_weapon');
    acc.applyRoomBoundary();

    const domain = acc.domain('weapon_repertoire', 'trait');
    expect(domain).not.toBeNull();
    expect(domain!).toBeGreaterThan(0);
    expect(domain!).toBeLessThan(1);
  });

  it('recordAction() without a weaponId still feeds action_repertoire and leaves weapon_repertoire untouched', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('light'); // pre-existing call shape from the prior sub-project, no weaponId
    acc.applyRoomBoundary();
    expect(acc.domain('action_repertoire', 'trait')).toBeNull(); // only 1 label used -> still null
    expect(acc.domain('weapon_repertoire', 'trait')).toBeNull(); // never recorded at all
  });

  it('only one weapon ever used keeps the domain null (n effective < 2)', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordAction('light', 'sword_shield');
    acc.applyRoomBoundary();
    expect(acc.domain('weapon_repertoire', 'trait')).toBeNull();
  });

  it('snapshot includes weapon_repertoire once folded, independently of action_repertoire', () => {
    const acc = new ProfileAccumulator();
    acc.recordAction('throw', 'bow');
    acc.applyRoomBoundary();
    const snap = acc.snapshot('room.exit');
    expect('weapon_repertoire' in snap.domain).toBe(true);
    expect(snap.counts.weapon_repertoire).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: FAIL — `acc.domain('weapon_repertoire', ...)` behaves like an unknown Family A skill (no entropy dim registered for it yet), not like a Family B dim.

- [ ] **Step 3: Update `src/profile/profileAccumulator.ts`**

Update the import line:

```ts
import { ACTION_TYPES, WEAPON_IDS, type ActionType } from '../combat/actionRegistry';
```

Update the constructor to register the second entropy dim:

```ts
  constructor(private confidenceKappa: number = DEFAULT_CONFIDENCE_KAPPA) {
    this.entropyDims.set('action_repertoire', {
      acc: new EntropyAccumulator(ACTION_TYPES),
      folded: false,
      everRecorded: false,
    });
    this.entropyDims.set('weapon_repertoire', {
      acc: new EntropyAccumulator(WEAPON_IDS),
      folded: false,
      everRecorded: false,
    });
  }
```

Replace `recordAction`:

```ts
  recordAction(actionType: ActionType, weaponId?: string): void {
    const actionDim = this.entropyDims.get('action_repertoire')!;
    actionDim.acc.record(actionType);
    actionDim.everRecorded = true;

    if (weaponId !== undefined) {
      const weaponDim = this.entropyDims.get('weapon_repertoire')!;
      weaponDim.acc.record(weaponId);
      weaponDim.everRecorded = true;
    }
  }
```

`applyRoomBoundary`/`applyEncounterBoundary`/`resetSession`/`snapshot`/`domain`/`confidence`/`deficit` already iterate `entropyDims` generically — no change needed in any of them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: PASS (27 tests: 22 pre-existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/profile/profileAccumulator.ts src/profile/profileAccumulator.test.ts
git commit -m "feat: add weapon_repertoire entropy dimension (dim 1), reusing EntropyAccumulator"
```

---

### Task 6: `Encounter` integration + critério de pronto for dim 1

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `PlayerController.switchWeapon`/`equippedWeaponId` (Task 4), `ProfileAccumulator.recordAction(actionType, weaponId)` (Task 5).
- Produces: nothing new downstream — final integration point for this sub-project's dim-1 work.

- [ ] **Step 1: Update `src/combat/encounter.ts`**

Replace the `player.action` handler's first line:

```ts
    this.bus.on('player.action', (e) => {
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }
    });
```

- [ ] **Step 2: Write the failing tests** — append to `src/combat/encounter.test.ts`, inside the `describe('Encounter', ...)` block, before its closing `});`. First add two helper functions near the existing `runFor` helper:

```ts
function useWeapon(encounter: Encounter, weaponId: string) {
  encounter.player.switchWeapon(weaponId);
  runFor(encounter, 260); // > SWITCH_RECOVERY_MS (250ms) — clears the attack lock
}

function attackWith(encounter: Encounter, actionId: string, totalMs: number) {
  encounter.player.tryAction(actionId);
  runFor(encounter, totalMs);
}
```

Then the two critério-de-pronto tests:

```ts
it('the weapon-repertoire dimension end to end: switching weapons between attacks yields the hand-computed entropy at room.exit', () => {
  const encounter = new Encounter(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 1000, y: 0, width: 20, height: 20 }, // far enough away to stay out of the way
  );

  useWeapon(encounter, 'bow');
  for (let i = 0; i < 3; i++) attackWith(encounter, 'bow.shot', 340); // 80+60+200

  useWeapon(encounter, 'heavy_weapon');
  for (let i = 0; i < 2; i++) attackWith(encounter, 'heavy_weapon.light', 500); // 160+120+220

  useWeapon(encounter, 'sword_shield');
  for (let i = 0; i < 4; i++) attackWith(encounter, 'sword_shield.light', 400); // > 350

  encounter.profile.applyRoomBoundary();
  const snap = encounter.profile.snapshot('room.exit');

  const counts = { bow: 3, heavy_weapon: 2, sword_shield: 4 };
  const total = 9;
  const H =
    -Object.values(counts).reduce((acc, c) => {
      const p = c / total;
      return acc + p * Math.log(p);
    }, 0) / Math.log(3);

  expect(snap.domain.weapon_repertoire).toBeCloseTo(H, 6);
  expect(snap.counts.weapon_repertoire).toEqual([3, 9]);
});

it('using only one weapon keeps the weapon-repertoire domain null', () => {
  const encounter = new Encounter(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 1000, y: 0, width: 20, height: 20 },
  );

  for (let i = 0; i < 5; i++) attackWith(encounter, 'sword_shield.light', 400);

  encounter.profile.applyRoomBoundary();
  const snap = encounter.profile.snapshot('room.exit');
  expect(snap.domain.weapon_repertoire).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (all pre-existing tests plus the 2 new critério-de-pronto tests).

- [ ] **Step 4: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire weapon_repertoire (dim 1) end to end through Encounter"
```

---

### Task 7: `ArenaScene` — mouse aim, weapon-select keys, click/Q bindings

**Files:**
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `fromScreen` (Task 1), `PlayerController.setAimDirection`/`switchWeapon`/`equippedWeaponId` (Tasks 2, 4), `findWeaponAction` (Task 3).
- Produces: nothing new downstream — this is the input-wiring task, no automated test (matches how the prior sub-project's equivalent `ArenaScene` task had no dedicated test file — verified by typecheck and, optionally, manual play).

- [ ] **Step 1: Update imports**

Add `fromScreen` to the existing `isometricProjection` import:

```ts
import { toScreen, fromScreen } from '../visual/isometricProjection';
```

Add an import for `findWeaponAction` and the `ActionType` type:

```ts
import { findWeaponAction, type ActionType } from '../combat/actionRegistry';
```

- [ ] **Step 2: Replace the `keys` field declaration**

```ts
  private keys!: {
    weapon1: Phaser.Input.Keyboard.Key;
    weapon2: Phaser.Input.Keyboard.Key;
    weapon3: Phaser.Input.Keyboard.Key;
    charged: Phaser.Input.Keyboard.Key;
    dodge: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
```

- [ ] **Step 3: Replace the keyboard setup and controls text in `create()`**

Replace the whole block from `this.keys = {` through the four `this.keys.*.on(...)` lines with:

```ts
    this.keys = {
      weapon1: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      weapon2: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      weapon3: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      charged: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keys.weapon1.on('down', () => this.encounter.player.switchWeapon('sword_shield'));
    this.keys.weapon2.on('down', () => this.encounter.player.switchWeapon('bow'));
    this.keys.weapon3.on('down', () => this.encounter.player.switchWeapon('heavy_weapon'));
    this.keys.charged.on('down', () => this.tryEquippedAction('charged'));
    this.keys.charged.on('up', () => this.encounter.player.releaseAction());
    this.keys.dodge.on('down', () => this.encounter.player.tryDodge());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        if (!this.tryEquippedAction('light')) this.tryEquippedAction('throw');
      } else if (pointer.rightButtonDown()) {
        this.tryEquippedAction('heavy');
      }
    });
```

Replace the `controlsText` array (the `[...]` list passed to `this.add.text`):

```ts
      [
        'Controls:',
        '  WASD        - move',
        '  Mouse       - mira',
        '  Clique esq  - ataque primario da arma equipada',
        '  Clique dir  - ataque secundario (sem efeito no arco)',
        '  Q (segurar) - carregado (sem efeito no arco)',
        '  1 / 2 / 3   - espada+escudo / arco / arma pesada',
        '  K           - esquiva',
        '          (use durante o telegraph do boss pra i-frames)',
      ],
```

- [ ] **Step 4: Add the `tryEquippedAction` helper method**

Add as a new private method (e.g. right after `setPlayerMoveInput`-adjacent methods, or near the bottom private helpers):

```ts
  private tryEquippedAction(actionType: ActionType): boolean {
    const action = findWeaponAction(this.encounter.player.equippedWeaponId, actionType);
    if (!action) return false;
    this.encounter.player.tryAction(action.id);
    return true;
  }
```

- [ ] **Step 5: Update `update()` to drive aim from the mouse**

Add this near the top of `update()`, before `this.loop.advance(delta)`:

```ts
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const playerScreen = toScreen(this.encounter.player.position, ISO_CONFIG);
    const aimDelta = { x: worldPoint.x - playerScreen.x, y: worldPoint.y - playerScreen.y };
    this.encounter.player.setAimDirection(fromScreen(aimDelta, ISO_CONFIG));
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: clean, 0 errors.

Run: `npm test`
Expected: PASS, same total as after Task 6 (this task adds no new automated tests — `ArenaScene` has none in this codebase, matching the prior sub-project's equivalent task).

- [ ] **Step 7: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: wire mouse aim, weapon-select keys, and per-weapon click/Q bindings in ArenaScene"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — every test file in `src/`, including files untouched by this plan (`assaltanteController.test.ts`, `opportunitySystem.test.ts`, `hudState.test.ts`, `decayedCount.test.ts`, `entropyAccumulator.test.ts`, `collision.test.ts`, etc.).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: If anything fails**

Re-open the specific task above whose file caused the failure, fix it there, then re-run Steps 1-2.

- [ ] **Step 4: Final commit** (only if Steps 1-3 required changes; otherwise this task produces no diff)

---

## Self-Review Notes

**Spec coverage:**
- §3.1 `fromScreen` → Task 1. §3.2 aim/movement split, `facing` contract change → Task 2. §3.3 `ArenaScene` per-frame aim calc → Task 7.
- §4.1 registry additions (`WEAPON_IDS`, `HEAVY_WEAPON_ACTIONS`, `BOW_ACTIONS`, `findWeaponAction`) → Task 3. §4.2 `equippedWeaponId`/`switchWeapon`/`tryAction` guards/`tryDodge` cancel → Task 4. §4.3 `SWITCH_RECOVERY_MS` → Task 4, Step 1.
- §5 dim 1 in `ProfileAccumulator` → Task 5. `Encounter` wiring → Task 6.
- §2.3 critério de pronto: item 1 (mira) → Task 2's `attackHitbox()`-follows-aim test; items 2-3 (dim 1 sequence, null case) → Task 6; items 4-5 (weapon validation, switch/dodge-cancel/no-op) → Task 4.
- §6 test table → every row maps to a task's test file as listed above.
- §7 risks → addressed structurally: the old `facing` test is rewritten (Task 2), not deleted; `attackLockedMs`/`dodgeCooldownRemainingMs` decrement side by side in the same `step()` block (Task 4); `findWeaponAction`'s O(n) scan is accepted as-is per the spec's own risk table (no task needed).
- §8 trilha → contextual only, no task required.

**Placeholder scan:** no TBD/TODO, no "add error handling" hand-waves, no "similar to Task N" — every step ships literal code or a literal test.

**Type consistency:** `WEAPON_IDS`/`HEAVY_WEAPON_ACTIONS`/`BOW_ACTIONS`/`findWeaponAction` (Task 3) are used with identical names in Tasks 4, 5, 7. `setAimDirection`/`aimDirection`/`lastMoveDirection` (Task 2) match every later reference in Tasks 4 and 7. `equippedWeaponId`/`switchWeapon`/`SWITCH_RECOVERY_MS` (Task 4) match Task 6's test helpers and Task 7's key bindings exactly. `recordAction(actionType, weaponId?)`'s widened signature (Task 5) matches Task 6's call site (`e.actionType, e.weaponId` — both always present at that call site, satisfying the optional parameter).

---

Plan complete and saved to `docs/superpowers/plans/2026-09-06-arco-arma-pesada-troca-arma.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
