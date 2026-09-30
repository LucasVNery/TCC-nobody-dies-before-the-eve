# Telemetria persistente e ciclo de runs (5a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the game real runs (HP, enemy death ends an encounter, 3 encounters end a room, player death ends a run) and a persistent, replayable two-layer event log from which the player profile is rebuilt on every load — the data foundation for the predictor (5b) and the intelligent boss (6).

**Architecture:** `ProfileAccumulator` stays pure; a new `ProfileSink` interface lets `RecordingProfile` sit in front of it and log every profile write as an `obs.*` event. A pure `RunDirector` owns the encounter→room→run lifecycle over the single existing `Encounter` and calls the profile boundaries. A `TelemetryRecorder` subscribes to the event bus, stamps each event with an envelope + combat context, and buffers it; `ArenaScene` drains the buffer into an `EventStore` (IndexedDB, with in-memory fallback). On load, `rebuildProfile()` replays the `obs.*` events after the last `obs.reset`.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2 (`environment: 'node'`), Phaser 3.90 (scene only), IndexedDB (native API), `fake-indexeddb` (new devDependency, tests only).

**Spec:** `docs/superpowers/specs/2026-09-30-telemetria-runs-5a-design.md`

## Global Constraints

- Work directly on `master` (repo convention for sub-projects; no worktree).
- Run `npm test` and `npm run typecheck` before every commit; both must be clean.
- Commit messages: English conventional-commit style, exactly as written in each task. **No `Co-Authored-By` trailer, no Claude/Anthropic mention** (project rule).
- No `Math.random()`, `Date`, `crypto` or DOM access in `src/combat/`, `src/profile/`, `src/game/`, `src/telemetry/` — randomness and ids are injected (`nextSeed`, `newId`). Only `src/scenes/ArenaScene.ts` touches the browser.
- Balance constants (spec §3.1), verbatim: `PLAYER_MAX_HP = 100`, `ASSALTANTE_MAX_HP = 60`, `ASSALTANTE_HIT_DAMAGE = 20`, player damage `light 10 · heavy 20 · charged 30 · throw 10 · utility 0`, `ROOM_ENCOUNTER_COUNT = 3`, `MIN_SPAWN_DISTANCE = 300`.
- Telemetry timing (spec §4): `obs.record` aggregation flush = **250 ms** of simulation time; `pos.sample` = **250 ms** (4 Hz); store flush = **2 s** real time + on `run.end` + on tab hide/`pagehide`.
- Envelope (spec §4.1), verbatim: `{ v: 2, seq, t_ms, player_id, session_id, run_idx, room_idx, enc_idx, type, ...payload }`; `(session_id, seq)` is the unique key.
- Dev keys: **F2** reset profile, **F8** export, **F9** import. F7 must not be used (opens caret-browsing dialog).
- Controllers do **not** gate behavior on death (`isDead` is read-only info); `RunDirector` resolves deaths within the same tick.
- Existing tests must keep passing untouched, except where a task explicitly edits them.

## Review Focus

1. **Tab closed mid-run** — the ≤250 ms of aggregated `record()` evidence not yet flushed must be flushed to the log *and* forwarded to the live profile together (`flushPending()`), so a reload rebuilds exactly what the player last saw. Test: Task 5 (`flushPending` logs and forwards the pending sum) + Task 6 (`drain` after `flushPending` contains it).
2. **IndexedDB unavailable or throwing** (private window, quota) — the game must start and play with an in-memory profile, never crash. Test: Task 10 (`loadProfileState` with a store whose reads reject).
3. **Reload after F2 reset** — rebuilt profile starts after the last `obs.reset`, history stays in the store, run numbering keeps counting up. Test: Task 7 (reset-then-play equivalence) + Task 10 (`firstRunIdx` continues after a reset).
4. **Importing the same file twice / a file from another machine** — no duplicate events, `player_id` adopted from the file. Test: Task 9.
5. **Run resets while the charged attack is held (Q down across death)** — releasing Q later must not emit a phantom `player.action`. Test: Task 2 (`reset()` mid-charge, then `releaseAction()` emits nothing).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/profile/profileSink.ts` | create | `ProfileSink` — the 7 profile write methods |
| `src/profile/profileAccumulator.ts` | modify | `implements ProfileSink` (no behavior change) |
| `src/combat/movementDefs.ts` | modify | HP/damage/room/spawn constants |
| `src/core/events.ts` | modify | new combat + lifecycle bus events |
| `src/combat/playerController.ts` | modify | `hp`, `takeDamage`, `isDead`, `currentActionDef`, `reset(pos)` |
| `src/combat/assaltanteController.ts` | modify | `hp`, `takeDamage`, `isDead`, `respawn(pos, reason)`, emits `enemy.attack_start` |
| `src/combat/encounter.ts` | modify | injected `ProfileSink`, damage once per action, `player.defense`/`player.hurt`/`enemy.hurt` events, `respawnEnemy`, `resetPlayer` |
| `src/game/runDirector.ts` | create | encounter→room→run lifecycle, profile boundaries, spawn selection |
| `src/telemetry/schema.ts` | create | envelope, `LoggedEvent`, `Ctx`, `LogFn`, `SCHEMA_VERSION`, `GAME_VERSION` |
| `src/telemetry/recordingProfile.ts` | create | `RecordingProfile implements ProfileSink` — logs `obs.*`, aggregates `record()` |
| `src/telemetry/context.ts` | create | `buildCtx()` — combat context snapshot |
| `src/telemetry/telemetryRecorder.ts` | create | bus → envelope + ctx → buffer; 4 Hz position samples |
| `src/telemetry/stack.ts` | create | `createTelemetryStack()` — wires recorder + recording profile + encounter + director |
| `src/telemetry/replay.ts` | create | `orderEvents`, `rebuildProfile`, `nextRunIdx` |
| `src/telemetry/eventStore.ts` | create | `EventStore`, `MemoryEventStore`, `IndexedDbEventStore` |
| `src/telemetry/ndjson.ts` | create | `toNdjson`, `parseNdjson`, `importInto` |
| `src/telemetry/bootstrap.ts` | create | `loadProfileState()` — store → profile + ids, degrades safely |
| `src/scenes/ArenaScene.ts` | modify | async boot, persistence schedule, HUD lines, F2/F8/F9 |
| `Contexto_pesquisa/instrumento-perfil-adaptativo.md` | modify | mark 5a implemented |

---

### Task 1: `ProfileSink` interface and profile injection into `Encounter`

**Files:**
- Create: `src/profile/profileSink.ts`
- Modify: `src/profile/profileAccumulator.ts:32` (class declaration)
- Modify: `src/combat/encounter.ts:14-30` (class header, `profile` field, constructor)
- Test: `src/combat/encounter.test.ts` (append one test)

**Interfaces:**
- Produces: `interface ProfileSink { record(skill, numerator, denominator); recordOutcome(skill, outcome); recordAction(actionType, weaponId?); recordDefense(label); applyEncounterBoundary(); applyRoomBoundary(); resetSession(); }` (all `void`); `class Encounter<P extends ProfileSink = ProfileAccumulator>` with `readonly profile: P` and `constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB, profile?: P)`.

- [ ] **Step 1: Write the failing test** — append inside the top-level `describe('Encounter', ...)` in `src/combat/encounter.test.ts`, and add the import at the top of the file:

```ts
import type { ProfileSink } from '../profile/profileSink';
```

```ts
  it('forwards profile writes to an injected ProfileSink instead of creating its own', () => {
    const calls: string[] = [];
    const sink: ProfileSink = {
      record: (skill) => calls.push(`record:${skill}`),
      recordOutcome: (skill, outcome) => calls.push(`outcome:${skill}:${outcome}`),
      recordAction: (actionType) => calls.push(`action:${actionType}`),
      recordDefense: (label) => calls.push(`defense:${label}`),
      applyEncounterBoundary: () => calls.push('boundary:encounter'),
      applyRoomBoundary: () => calls.push('boundary:room'),
      resetSession: () => calls.push('reset'),
    };
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 500, y: 500, width: 20, height: 20 },
      sink,
    );
    expect(encounter.profile).toBe(sink);

    encounter.player.tryAction('sword_shield.light');
    encounter.step(STEP_MS);

    expect(calls).toContain('action:light');
    expect(calls).toContain('record:patience');
    expect(calls).toContain('record:distance');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — typecheck/import error `Cannot find module '../profile/profileSink'` (or `Expected 2 arguments, but got 3`).

- [ ] **Step 3: Create `src/profile/profileSink.ts`**

```ts
// src/profile/profileSink.ts
import type { ActionType } from '../combat/actionRegistry';
import type { DefensiveLabel } from './profileAccumulator';
import type { SkillId, ProfileOutcome } from './types';

/**
 * The profile's write side. `ProfileAccumulator` implements it directly;
 * `RecordingProfile` (src/telemetry/) implements it by logging each call as an
 * `obs.*` event before forwarding. Code that only *feeds* the profile
 * (`Encounter`, `RunDirector`) depends on this interface, never on the
 * accumulator's read side.
 */
export interface ProfileSink {
  record(skill: SkillId, numerator: number, denominator: number): void;
  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void;
  recordAction(actionType: ActionType, weaponId?: string): void;
  recordDefense(label: DefensiveLabel): void;
  applyEncounterBoundary(): void;
  applyRoomBoundary(): void;
  resetSession(): void;
}
```

- [ ] **Step 4: Make `ProfileAccumulator` implement it** — in `src/profile/profileAccumulator.ts` add the import and change the class line:

```ts
import type { ProfileSink } from './profileSink';
```

```ts
export class ProfileAccumulator implements ProfileSink {
```

- [ ] **Step 5: Make `Encounter` accept an injected sink** — in `src/combat/encounter.ts` add the import, then replace the class header, the `profile` field and the constructor line that creates the accumulator:

```ts
import type { ProfileSink } from '../profile/profileSink';
```

```ts
export class Encounter<P extends ProfileSink = ProfileAccumulator> {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  /**
   * Write side of the profile. Defaults to a fresh `ProfileAccumulator` so
   * existing call sites (and tests that read `encounter.profile.domain(...)`)
   * keep working; `RunDirector`/telemetry inject a `RecordingProfile` so the
   * profile outlives encounters and runs.
   */
  readonly profile: P;
```

```ts
  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB, profile?: P) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = profile ?? (new ProfileAccumulator() as unknown as P);
```

(Remove the old `this.profile = new ProfileAccumulator();` line. The rest of the constructor is unchanged.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (259 existing + 1 new), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/profile/profileSink.ts src/profile/profileAccumulator.ts src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "refactor: extract ProfileSink and inject the profile into Encounter"
```

---

### Task 2: HP, damage and reset/respawn in the controllers

**Files:**
- Modify: `src/combat/movementDefs.ts` (append constants)
- Modify: `src/core/events.ts` (combat events)
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/assaltanteController.ts`
- Test: `src/combat/playerController.test.ts`, `src/combat/assaltanteController.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `movementDefs`: `PLAYER_MAX_HP`, `ASSALTANTE_MAX_HP`, `ASSALTANTE_HIT_DAMAGE`, `PLAYER_DAMAGE_BY_ACTION_TYPE: Record<ActionType, number>`, `ROOM_ENCOUNTER_COUNT`, `MIN_SPAWN_DISTANCE`.
  - `GameEvents` keys: `'player.defense': { label: DefensiveLabel }`, `'player.hurt': { dmg: number; hp_after: number }`, `'enemy.attack_start': {}`, `'enemy.hurt': { dmg: number; hp_after: number; actionId: string }`.
  - `PlayerController`: `hp: number`, `get isDead(): boolean`, `get currentActionDef(): ActionDef | null`, `takeDamage(amount: number): void`, `reset(position: Vec2): void`.
  - `AssaltanteController`: `hp: number`, `get isDead(): boolean`, `takeDamage(amount: number): void`, `respawn(position: Vec2, reason: InvalidReason): void`; emits `'enemy.attack_start'` when it enters `attacking`.

- [ ] **Step 1: Write the failing tests** — append to `src/combat/playerController.test.ts` inside `describe('PlayerController', ...)`; add `PLAYER_MAX_HP` to the existing `./movementDefs` import:

```ts
  it('takeDamage lowers hp, clamps at 0 and flips isDead', () => {
    const { player } = makePlayer();
    expect(player.hp).toBe(PLAYER_MAX_HP);
    player.takeDamage(30);
    expect(player.hp).toBe(PLAYER_MAX_HP - 30);
    expect(player.isDead).toBe(false);
    player.takeDamage(999);
    expect(player.hp).toBe(0);
    expect(player.isDead).toBe(true);
  });

  it('reset() restores hp/poise/state/weapon and moves the player', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.takeDamage(50);
    player.startBlock();
    player.absorbBlockHit();
    player.reset({ x: 300, y: 200 });
    expect(player.hp).toBe(PLAYER_MAX_HP);
    expect(player.poise).toBe(POISE_MAX);
    expect(player.state).toBe('idle');
    expect(player.equippedWeaponId).toBe('sword_shield');
    expect(player.position).toEqual({ x: 300, y: 200 });
    expect(player.isInvulnerable).toBe(false);
  });

  it('reset() mid-charge discards the charge: releasing afterwards emits no player.action', () => {
    const { bus, player } = makePlayer();
    const actions = vi.fn();
    bus.on('player.action', actions);
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs + 50);
    player.reset({ x: 0, y: 0 });
    player.releaseAction();
    player.step(16);
    expect(actions).not.toHaveBeenCalled();
    expect(player.currentActionDef).toBeNull();
  });

  it('currentActionDef exposes the action being performed', () => {
    const { player } = makePlayer();
    expect(player.currentActionDef).toBeNull();
    player.tryAction(LIGHT.id);
    expect(player.currentActionDef?.id).toBe(LIGHT.id);
  });
```

Append to `src/combat/assaltanteController.test.ts` inside `describe('AssaltanteController', ...)`; add imports:

```ts
import { ASSALTANTE_MAX_HP } from './movementDefs';
```

```ts
  it('emits enemy.attack_start when it starts an attack', () => {
    const { bus, enemy } = makeAssaltante();
    const started = vi.fn();
    bus.on('enemy.attack_start', started);
    enemy.step(16, { x: 110, y: 0 }); // in range -> attacks
    expect(enemy.state).toBe('attacking');
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('takeDamage lowers hp, clamps at 0 and flips isDead', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP);
    enemy.takeDamage(20);
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP - 20);
    enemy.takeDamage(999);
    expect(enemy.hp).toBe(0);
    expect(enemy.isDead).toBe(true);
  });

  it('respawn() closes its open opportunity as invalid with the given reason and resets hp/state/position', () => {
    const { bus, enemy } = makeAssaltante();
    const closes: Array<{ type: string; outcome: string; reason?: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    enemy.step(16, { x: 110, y: 0 }); // opens a 'dodge' window
    enemy.takeDamage(999);

    enemy.respawn({ x: 800, y: 600 }, 'source_interrupted');

    expect(closes).toEqual([{ opp_id: expect.any(String), type: 'dodge', outcome: 'invalid', reason: 'source_interrupted' }]);
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP);
    expect(enemy.state).toBe('idle');
    expect(enemy.position).toEqual({ x: 800, y: 600 });
  });

  it('respawn() with no open opportunity closes nothing', () => {
    const { bus, enemy } = makeAssaltante();
    const closes = vi.fn();
    bus.on('opp.close', closes);
    enemy.respawn({ x: 0, y: 0 }, 'player_dead');
    expect(closes).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/combat/playerController.test.ts src/combat/assaltanteController.test.ts`
Expected: FAIL — `PLAYER_MAX_HP`/`ASSALTANTE_MAX_HP` not exported, `hp`/`takeDamage`/`reset`/`respawn` undefined.

- [ ] **Step 3: Append constants to `src/combat/movementDefs.ts`**

```ts
import type { ActionType } from './actionRegistry';

// Sub-project 5a (spec 2026-09-30 §3.1) — initial balance values, tune in playtest.
export const PLAYER_MAX_HP = 100;
export const ASSALTANTE_MAX_HP = 60;
/** Damage of an unmitigated Assaltante hit. Block and parry deal no HP damage (block already drains poise). */
export const ASSALTANTE_HIT_DAMAGE = 20;
/** Damage dealt by one connecting player action, applied at most once per action. */
export const PLAYER_DAMAGE_BY_ACTION_TYPE: Record<ActionType, number> = {
  light: 10,
  heavy: 20,
  charged: 30,
  throw: 10,
  utility: 0,
};
/** Encounters (Assaltante kills) per room. */
export const ROOM_ENCOUNTER_COUNT = 3;
/** Minimum distance between the player and a freshly spawned Assaltante, in px. */
export const MIN_SPAWN_DISTANCE = 300;
```

(Put the `import type` line at the top of the file with the existing `AABB` import.)

- [ ] **Step 4: Add the combat events to `src/core/events.ts`**

```ts
import type { DefensiveLabel } from '../profile/profileAccumulator';
```

```ts
export type EmptyPayload = Record<string, never>;

export interface PlayerDefensePayload {
  label: DefensiveLabel;
}

export interface PlayerHurtPayload {
  dmg: number;
  hp_after: number;
}

export interface EnemyHurtPayload {
  dmg: number;
  hp_after: number;
  actionId: string;
}
```

and extend `GameEvents`:

```ts
export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
  'player.hit_unmitigated': PlayerHitUnmitigatedPayload;
  'player.defense': PlayerDefensePayload;
  'player.hurt': PlayerHurtPayload;
  'enemy.attack_start': EmptyPayload;
  'enemy.hurt': EnemyHurtPayload;
};
```

- [ ] **Step 5: `PlayerController`** — add `PLAYER_MAX_HP` to the `./movementDefs` import, then add the field next to `poise`, and the members below `isParryTiming`:

```ts
  hp = PLAYER_MAX_HP;
```

```ts
  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** The action currently being performed (null when not acting). Read-only view for Encounter's damage step. */
  get currentActionDef(): ActionDef | null {
    return this.currentAction;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * Start-of-run state: full hp and poise, idle, default weapon, no cooldowns,
   * any in-progress (including charging) action discarded. Death itself does
   * not gate behavior — RunDirector calls this in the same tick the player dies.
   */
  reset(position: Vec2): void {
    this._position = { x: position.x, y: position.y };
    this.hp = PLAYER_MAX_HP;
    this.poise = POISE_MAX;
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this.currentAction = null;
    this.chargeHeldMs = 0;
    this.chargeTriggered = false;
    this.equippedWeaponId = 'sword_shield';
    this.attackLockedMs = 0;
    this.dodgeCooldownRemainingMs = 0;
    this.invulnerable = false;
    this.blockHeldMs = 0;
    this.staggerRemainingMs = 0;
    this.poiseRegenDelayRemainingMs = 0;
    this.moveInput = { x: 0, y: 0 };
  }
```

- [ ] **Step 6: `AssaltanteController`** — imports:

```ts
import type { ActionId, InvalidReason } from '../opportunity/types';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH, ATTACK_HALF_ANGLE_RAD, ASSALTANTE_MAX_HP } from './movementDefs';
```

(replace the two existing import lines for `ActionId` and `movementDefs`). Add the field after `state`:

```ts
  hp = ASSALTANTE_MAX_HP;
```

Add below `attackDirection`:

```ts
  get isDead(): boolean {
    return this.hp <= 0;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * Fresh Assaltante at `position`. Any window it still has open is closed as
   * `invalid` with `reason` so the opportunity denominator never leaks
   * (conservation law, doc §2.4): 'source_interrupted' when it died,
   * 'player_dead' when the run ended.
   */
  respawn(position: Vec2, reason: InvalidReason): void {
    if (this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'invalid', { reason });
      this.activeOppId = null;
    }
    this._position = { x: position.x, y: position.y };
    this.hp = ASSALTANTE_MAX_HP;
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this._activeRuleId = null;
    this.playerWasInRangeDuringPunish = false;
  }
```

In `step()`, inside the `if (rule?.id === 'assaltante.attack')` branch, add the emit as the last line of the branch (after `this.activeOppId = this.opp.open(...)`):

```ts
        this.bus.emit('enemy.attack_start', {});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/combat/movementDefs.ts src/core/events.ts src/combat/playerController.ts src/combat/assaltanteController.ts src/combat/playerController.test.ts src/combat/assaltanteController.test.ts
git commit -m "feat: add hp, damage and reset/respawn to player and Assaltante"
```

---

### Task 3: Damage, defense/hurt events, respawn and reset in `Encounter`

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts` (append)

**Interfaces:**
- Consumes (Task 2): `PlayerController.takeDamage/hp/currentActionDef/reset`, `AssaltanteController.takeDamage/hp/respawn`, `ASSALTANTE_HIT_DAMAGE`, `PLAYER_DAMAGE_BY_ACTION_TYPE`, events `player.defense`, `player.hurt`, `enemy.hurt`.
- Produces: `Encounter.respawnEnemy(position: Vec2, reason: InvalidReason): void`, `Encounter.resetPlayer(position: Vec2): void`; emits `player.defense` wherever a defense label is recorded, `player.hurt` on an unmitigated hit, `enemy.hurt` once per connecting player action.

- [ ] **Step 1: Write the failing tests** — append inside `describe('Encounter', ...)`; add `import { ASSALTANTE_MAX_HP, PLAYER_MAX_HP } from './movementDefs';` at the top:

```ts
  it('a connecting player action damages the Assaltante exactly once, even across several active frames', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const hurts: Array<{ dmg: number; hp_after: number; actionId: string }> = [];
    encounter.bus.on('enemy.hurt', (e) => hurts.push(e));

    encounter.player.tryAction('sword_shield.light'); // active 100..200ms, well before the 400ms telegraph ends
    runFor(encounter, 350);

    expect(hurts).toEqual([{ dmg: 10, hp_after: ASSALTANTE_MAX_HP - 10, actionId: 'sword_shield.light' }]);
    expect(encounter.assaltante.hp).toBe(ASSALTANTE_MAX_HP - 10);
  });

  it('an unmitigated Assaltante hit costs the player hp and emits player.hurt once', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const hurts = vi.fn();
    encounter.bus.on('player.hurt', hurts);
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.player.hp).toBe(PLAYER_MAX_HP - 20);
    expect(hurts).toHaveBeenCalledTimes(1);
    expect(hurts).toHaveBeenCalledWith({ dmg: 20, hp_after: PLAYER_MAX_HP - 20 });
  });

  it('a blocked hit costs no hp and emits player.defense {label: block}', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );
    const defenses: Array<{ label: string }> = [];
    encounter.bus.on('player.defense', (e) => defenses.push(e));
    encounter.player.startBlock();
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.player.hp).toBe(PLAYER_MAX_HP);
    expect(defenses).toEqual([{ label: 'block' }]);
  });

  it('respawnEnemy closes the open dodge window as invalid with the given reason', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const closes: Array<{ type: string; outcome: string; reason?: string }> = [];
    encounter.bus.on('opp.close', (e) => closes.push(e));
    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    encounter.respawnEnemy({ x: 800, y: 600 }, 'source_interrupted');

    expect(closes.map((c) => [c.type, c.outcome, c.reason])).toEqual([['dodge', 'invalid', 'source_interrupted']]);
    expect(encounter.assaltante.state).toBe('idle');
    expect(encounter.assaltante.position).toEqual({ x: 800, y: 600 });
  });

  it('resetPlayer restores the player and a new action can damage again', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.player.takeDamage(90);
    encounter.resetPlayer({ x: 0, y: 0 });
    expect(encounter.player.hp).toBe(PLAYER_MAX_HP);
    expect(encounter.player.state).toBe('idle');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — no `enemy.hurt`/`player.hurt`/`player.defense` emitted; `respawnEnemy`/`resetPlayer` not functions.

- [ ] **Step 3: Implement in `src/combat/encounter.ts`** — imports:

```ts
import { ATTACK_REACH, ASSALTANTE_HIT_DAMAGE, PLAYER_DAMAGE_BY_ACTION_TYPE } from './movementDefs';
import type { AABB, Vec2 } from './types';
import type { InvalidReason } from '../opportunity/types';
```

(replace the existing `ATTACK_REACH` and `AABB` import lines). Add a field after `defenseRecordedThisAttack`:

```ts
  // At most one damage application per player action: the attack sector
  // overlaps the hurtbox on every tick of the active phase, so without this
  // one light attack would deal its damage ~6 times. Reset on every
  // player.action (for charged actions that event fires on release, before
  // the active phase starts).
  private hitAppliedThisAction = false;
```

In the constructor's `player.action` handler, make this the first line:

```ts
      this.hitAppliedThisAction = false;
```

In the `player.dodge` handler, after `this.profile.recordDefense('dodge');` add:

```ts
        this.bus.emit('player.defense', { label: 'dodge' });
```

In the `opp.close` handler, after `this.profile.recordDefense('retreat');` add:

```ts
        this.bus.emit('player.defense', { label: 'retreat' });
```

In `step()`, replace the unmitigated `else` branch with:

```ts
      } else if (!this.defenseRecordedThisAttack) {
        this.player.enterStagger();
        this.bus.emit('player.hit_unmitigated', {});
        this.player.takeDamage(ASSALTANTE_HIT_DAMAGE);
        this.bus.emit('player.hurt', { dmg: ASSALTANTE_HIT_DAMAGE, hp_after: this.player.hp });
        this.defenseRecordedThisAttack = true; // no dim-4 label, but the window is "resolved"
      }
```

Replace the player-attack block with:

```ts
    const playerAttack = this.player.attackHitbox();
    if (playerAttack && sectorOverlapsBox(playerAttack, this.assaltante.hurtbox())) {
      this.assaltante.onPlayerHitLanded();
      const action = this.player.currentActionDef;
      if (action && !this.hitAppliedThisAction) {
        this.hitAppliedThisAction = true;
        const dmg = PLAYER_DAMAGE_BY_ACTION_TYPE[action.actionType];
        this.assaltante.takeDamage(dmg);
        this.bus.emit('enemy.hurt', { dmg, hp_after: this.assaltante.hp, actionId: action.id });
      }
    }
```

Add public methods after `setPlayerMoveInput`:

```ts
  /** Fresh Assaltante at `position`; see AssaltanteController.respawn for `reason`. */
  respawnEnemy(position: Vec2, reason: InvalidReason): void {
    this.assaltante.respawn(position, reason);
    this.defenseRecordedThisAttack = false;
  }

  /** Start-of-run player. */
  resetPlayer(position: Vec2): void {
    this.player.reset(position);
    this.hitAppliedThisAction = false;
  }
```

Replace `recordDefenseOnce` with:

```ts
  private recordDefenseOnce(label: 'block' | 'parry'): void {
    if (this.defenseRecordedThisAttack) return;
    this.defenseRecordedThisAttack = true;
    this.profile.recordDefense(label);
    this.bus.emit('player.defense', { label });
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (existing encounter tests unchanged — controllers don't gate on death), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: apply combat damage in Encounter and emit defense/hurt events"
```

---

### Task 4: `RunDirector` — encounter, room and run lifecycle

**Files:**
- Modify: `src/core/events.ts` (lifecycle events)
- Create: `src/game/runDirector.ts`
- Test: `src/game/runDirector.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `Encounter<ProfileSink>` with `step`, `respawnEnemy(pos, reason)`, `resetPlayer(pos)`, `player.isDead`, `assaltante.isDead`, `bus`, `profile`; `ROOM_ENCOUNTER_COUNT`, `MIN_SPAWN_DISTANCE`, `ARENA_BOUNDS`; `createPrng`.
- Produces:
  - `GameEvents` keys: `'run.start': { run_idx: number; seed: number }`, `'run.end': { run_idx: number; cause: 'death'; duration_ms: number; rooms_cleared: number; encounters_cleared: number }`, `'room.enter': { room_idx: number }`, `'encounter.start': { enc_idx: number }`, `'encounter.end': { enc_idx: number }`, `'profile.snapshot': { partial: boolean; snapshot: ProfileSnapshotPayload }`, `'player.death': {}`, `'enemy.death': {}`.
  - `PLAYER_START: Vec2`, `spawnCandidates(): Vec2[]`, `pickSpawn(prng: Prng, player: Vec2): Vec2`, `interface SnapshotSource { snapshot(at): ProfileSnapshotPayload }`, `class RunDirector` with `constructor(opts: { encounter: Encounter<ProfileSink>; snapshots: SnapshotSource; nextSeed: () => number; firstRunIdx?: number })`, `start(): void`, `step(stepMs: number): void`, getters `runIdx`, `roomIdx`, `encIdx`.

- [ ] **Step 1: Add the lifecycle events to `src/core/events.ts`**

```ts
import type { ProfileSnapshotPayload } from '../profile/types';
```

```ts
export interface RunStartPayload {
  run_idx: number;
  seed: number;
}

export interface RunEndPayload {
  run_idx: number;
  cause: 'death';
  duration_ms: number;
  rooms_cleared: number;
  encounters_cleared: number;
}

export interface RoomEnterPayload {
  room_idx: number;
}

export interface EncounterBoundaryPayload {
  enc_idx: number;
}

export interface ProfileSnapshotEventPayload {
  /** true when the room was cut short by the player's death. */
  partial: boolean;
  snapshot: ProfileSnapshotPayload;
}
```

Add to `GameEvents`:

```ts
  'run.start': RunStartPayload;
  'run.end': RunEndPayload;
  'room.enter': RoomEnterPayload;
  'encounter.start': EncounterBoundaryPayload;
  'encounter.end': EncounterBoundaryPayload;
  'profile.snapshot': ProfileSnapshotEventPayload;
  'player.death': EmptyPayload;
  'enemy.death': EmptyPayload;
```

- [ ] **Step 2: Write the failing tests** — create `src/game/runDirector.test.ts`:

```ts
// src/game/runDirector.test.ts
import { describe, it, expect } from 'vitest';
import { Encounter } from '../combat/encounter';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import { PLAYER_MAX_HP, ASSALTANTE_MAX_HP, MIN_SPAWN_DISTANCE } from '../combat/movementDefs';
import { RunDirector, PLAYER_START, pickSpawn } from './runDirector';
import { createPrng } from '../core/prng';
import type { GameEvents } from '../core/events';

const STEP = 16;
const LIFECYCLE = [
  'run.start', 'run.end', 'room.enter', 'encounter.start', 'encounter.end',
  'profile.snapshot', 'player.death', 'enemy.death',
] as const;

function makeDirector(firstSeed = 1, firstRunIdx?: number) {
  const acc = new ProfileAccumulator();
  const calls: string[] = [];
  const sink: ProfileSink = {
    record: (s, n, d) => acc.record(s, n, d),
    recordOutcome: (s, o) => acc.recordOutcome(s, o),
    recordAction: (t, w) => acc.recordAction(t, w),
    recordDefense: (l) => acc.recordDefense(l),
    applyEncounterBoundary: () => { calls.push('enc'); acc.applyEncounterBoundary(); },
    applyRoomBoundary: () => { calls.push('room'); acc.applyRoomBoundary(); },
    resetSession: () => { calls.push('reset'); acc.resetSession(); },
  };
  const encounter = new Encounter(
    { x: PLAYER_START.x, y: PLAYER_START.y, width: 20, height: 20 },
    { x: 0, y: 0, width: 20, height: 20 },
    sink,
  );
  let seed = firstSeed;
  const director = new RunDirector({ encounter, snapshots: acc, nextSeed: () => seed++, firstRunIdx });
  const events: Array<[string, unknown]> = [];
  for (const type of LIFECYCLE) {
    encounter.bus.on(type, (e: GameEvents[typeof type]) => events.push([type, e]));
  }
  return { director, encounter, acc, calls, events };
}

function killEnemy(d: ReturnType<typeof makeDirector>) {
  d.encounter.assaltante.takeDamage(999);
  d.director.step(STEP);
}

function types(events: Array<[string, unknown]>) {
  return events.map(([t]) => t);
}

describe('RunDirector', () => {
  it('start() opens run 0, room 0, encounter 0 with the first seed', () => {
    const d = makeDirector(42);
    d.director.start();
    expect(d.events).toEqual([
      ['run.start', { run_idx: 0, seed: 42 }],
      ['room.enter', { room_idx: 0 }],
      ['encounter.start', { enc_idx: 0 }],
    ]);
    expect(d.encounter.player.position).toEqual(PLAYER_START);
  });

  it('firstRunIdx continues numbering from a previous session', () => {
    const d = makeDirector(1, 5);
    d.director.start();
    expect(d.events[0]).toEqual(['run.start', { run_idx: 5, seed: 1 }]);
    expect(d.director.runIdx).toBe(5);
  });

  it('killing the Assaltante ends the encounter: one encounter boundary, fresh enemy far from the player', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    killEnemy(d);
    expect(types(d.events)).toEqual(['enemy.death', 'encounter.end', 'encounter.start']);
    expect(d.events[2]).toEqual(['encounter.start', { enc_idx: 1 }]);
    expect(d.calls).toEqual(['enc']);
    expect(d.encounter.assaltante.hp).toBe(ASSALTANTE_MAX_HP);
    const p = d.encounter.player.position;
    const e = d.encounter.assaltante.position;
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
  });

  it('three kills end the room: room boundary after the third encounter boundary, one non-partial snapshot', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    killEnemy(d);
    killEnemy(d);
    killEnemy(d);
    expect(d.calls).toEqual(['enc', 'enc', 'enc', 'room']);
    const snaps = d.events.filter(([t]) => t === 'profile.snapshot');
    expect(snaps).toHaveLength(1);
    expect((snaps[0][1] as { partial: boolean }).partial).toBe(false);
    expect((snaps[0][1] as { snapshot: { at: string } }).snapshot.at).toBe('room.exit');
    expect(d.events).toContainEqual(['room.enter', { room_idx: 1 }]);
    expect(d.director.roomIdx).toBe(1);
    expect(d.director.encIdx).toBe(0);
  });

  it('player death ends the run: partial room counts, run.end reports totals, next run starts without resetting the profile', () => {
    const d = makeDirector(1);
    d.director.start();
    killEnemy(d); // 1 encounter cleared, 16ms elapsed
    d.acc.recordAction('light', 'sword_shield');
    d.events.length = 0;
    d.calls.length = 0;

    d.encounter.player.takeDamage(999);
    d.director.step(STEP);

    expect(d.calls).toEqual(['enc', 'room']);
    expect(types(d.events)).toEqual([
      'player.death', 'encounter.end', 'profile.snapshot', 'run.end',
      'run.start', 'room.enter', 'encounter.start',
    ]);
    expect((d.events[2][1] as { partial: boolean }).partial).toBe(true);
    expect(d.events[3]).toEqual(['run.end', {
      run_idx: 0, cause: 'death', duration_ms: 2 * STEP, rooms_cleared: 0, encounters_cleared: 1,
    }]);
    expect(d.events[4]).toEqual(['run.start', { run_idx: 1, seed: 2 }]);
    expect(d.encounter.player.hp).toBe(PLAYER_MAX_HP);
    expect(d.encounter.player.position).toEqual(PLAYER_START);
    expect(d.calls).not.toContain('reset');
    expect(d.acc.snapshot('room.exit').counts.action_repertoire).toEqual([1, 1]);
  });

  it('player death closes the enemy window as invalid/player_dead inside the ending run', () => {
    const d = makeDirector();
    d.director.start();
    const closes: Array<{ outcome: string; reason?: string }> = [];
    d.encounter.bus.on('opp.close', (e) => closes.push(e));
    // put the Assaltante next to the player so it attacks and opens a dodge window
    d.encounter.respawnEnemy({ x: PLAYER_START.x + 30, y: PLAYER_START.y }, 'source_interrupted');
    d.director.step(STEP);
    expect(d.encounter.assaltante.state).toBe('attacking');

    d.encounter.player.takeDamage(999);
    d.director.step(STEP);

    expect(closes.map((c) => [c.outcome, c.reason])).toContainEqual(['invalid', 'player_dead']);
  });

  it('simultaneous deaths resolve as a single run end (player death wins)', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    d.encounter.player.takeDamage(999);
    d.encounter.assaltante.takeDamage(999);
    d.director.step(STEP);
    expect(types(d.events).filter((t) => t === 'run.end')).toHaveLength(1);
    expect(types(d.events)).not.toContain('enemy.death');
    expect(d.calls).toEqual(['enc', 'room']);
  });

  it('spawn selection is deterministic for a given seed and respects the minimum distance', () => {
    const a = pickSpawn(createPrng(9), PLAYER_START);
    const b = pickSpawn(createPrng(9), PLAYER_START);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x - PLAYER_START.x, a.y - PLAYER_START.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
  });

  it('step() before start() throws', () => {
    const d = makeDirector();
    expect(() => d.director.step(STEP)).toThrow('RunDirector not started');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/game/runDirector.test.ts`
Expected: FAIL — `Cannot find module './runDirector'`.

- [ ] **Step 4: Implement `src/game/runDirector.ts`**

```ts
// src/game/runDirector.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import type { ProfileSnapshotPayload } from '../profile/types';
import type { Vec2 } from '../combat/types';
import { createPrng, type Prng } from '../core/prng';
import { ARENA_BOUNDS, ROOM_ENCOUNTER_COUNT, MIN_SPAWN_DISTANCE } from '../combat/movementDefs';

/** Player start position of every run (center of the arena). */
export const PLAYER_START: Vec2 = {
  x: ARENA_BOUNDS.x + ARENA_BOUNDS.width / 2 - 10,
  y: ARENA_BOUNDS.y + ARENA_BOUNDS.height / 2 - 10,
};

const SPAWN_INSET = 100;

/** 8 candidate spawn points: corners and edge midpoints, inset from the arena border. */
export function spawnCandidates(): Vec2[] {
  const { x, y, width, height } = ARENA_BOUNDS;
  const left = x + SPAWN_INSET;
  const right = x + width - SPAWN_INSET;
  const top = y + SPAWN_INSET;
  const bottom = y + height - SPAWN_INSET;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return [
    { x: left, y: top }, { x: cx, y: top }, { x: right, y: top }, { x: right, y: cy },
    { x: right, y: bottom }, { x: cx, y: bottom }, { x: left, y: bottom }, { x: left, y: cy },
  ];
}

/**
 * Seeded choice among the candidates at least MIN_SPAWN_DISTANCE from the
 * player. In a 1600×1200 arena at least one inset corner is always ≥ 600 px
 * away from any player position, so the filtered list is never empty.
 */
export function pickSpawn(prng: Prng, player: Vec2): Vec2 {
  const far = spawnCandidates().filter(
    (c) => Math.hypot(c.x - player.x, c.y - player.y) >= MIN_SPAWN_DISTANCE,
  );
  return far[prng.nextInt(far.length)];
}

export interface SnapshotSource {
  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload;
}

export interface RunDirectorOptions {
  encounter: Encounter<ProfileSink>;
  /** Read side of the same profile the encounter writes to. */
  snapshots: SnapshotSource;
  /** Injected so logic stays free of Math.random; one call per run. */
  nextSeed: () => number;
  /** Continues run numbering across sessions (read from the stored log). */
  firstRunIdx?: number;
}

/**
 * Owns the encounter → room → run lifecycle over a single Encounter (spec
 * 2026-09-30 §3.2): Assaltante death ends an encounter, ROOM_ENCOUNTER_COUNT
 * encounters end a room, player death ends the run (the interrupted room
 * still counts, flagged partial). The profile is never reset here — it is the
 * player's, not the run's (D4).
 */
export class RunDirector {
  private _runIdx: number;
  private _roomIdx = 0;
  private _encIdx = 0;
  private runElapsedMs = 0;
  private roomsCleared = 0;
  private encountersCleared = 0;
  private prng: Prng = createPrng(0);
  private started = false;

  constructor(private readonly opts: RunDirectorOptions) {
    this._runIdx = opts.firstRunIdx ?? 0;
  }

  get runIdx(): number {
    return this._runIdx;
  }

  get roomIdx(): number {
    return this._roomIdx;
  }

  get encIdx(): number {
    return this._encIdx;
  }

  start(): void {
    if (this.started) throw new Error('RunDirector already started');
    this.started = true;
    this.beginRun();
  }

  step(stepMs: number): void {
    if (!this.started) throw new Error('RunDirector not started');
    const { encounter } = this.opts;
    encounter.step(stepMs);
    this.runElapsedMs += stepMs;
    if (encounter.player.isDead) {
      this.endRun(); // player death wins a same-tick double KO
      return;
    }
    if (encounter.assaltante.isDead) this.endEncounter();
  }

  private get bus() {
    return this.opts.encounter.bus;
  }

  private get profile(): ProfileSink {
    return this.opts.encounter.profile;
  }

  private beginRun(): void {
    const { encounter } = this.opts;
    const seed = this.opts.nextSeed() >>> 0;
    this.prng = createPrng(seed);
    this._roomIdx = 0;
    this._encIdx = 0;
    this.runElapsedMs = 0;
    this.roomsCleared = 0;
    this.encountersCleared = 0;
    encounter.resetPlayer(PLAYER_START);
    encounter.respawnEnemy(pickSpawn(this.prng, PLAYER_START), 'source_interrupted');
    this.bus.emit('run.start', { run_idx: this._runIdx, seed });
    this.bus.emit('room.enter', { room_idx: 0 });
    this.bus.emit('encounter.start', { enc_idx: 0 });
  }

  private endEncounter(): void {
    const { encounter } = this.opts;
    this.bus.emit('enemy.death', {});
    encounter.respawnEnemy(pickSpawn(this.prng, encounter.player.position), 'source_interrupted');
    this.bus.emit('encounter.end', { enc_idx: this._encIdx });
    this.profile.applyEncounterBoundary();
    this.encountersCleared += 1;
    this._encIdx += 1;
    if (this._encIdx >= ROOM_ENCOUNTER_COUNT) {
      this.profile.applyRoomBoundary();
      this.emitSnapshot(false);
      this.roomsCleared += 1;
      this._roomIdx += 1;
      this._encIdx = 0;
      this.bus.emit('room.enter', { room_idx: this._roomIdx });
    }
    this.bus.emit('encounter.start', { enc_idx: this._encIdx });
  }

  private endRun(): void {
    const { encounter } = this.opts;
    this.bus.emit('player.death', {});
    // Close the enemy's open windows inside the run that is ending.
    encounter.respawnEnemy(encounter.assaltante.position, 'player_dead');
    this.bus.emit('encounter.end', { enc_idx: this._encIdx });
    this.profile.applyEncounterBoundary();
    this.profile.applyRoomBoundary(); // the interrupted room counts, flagged partial
    this.emitSnapshot(true);
    this.bus.emit('run.end', {
      run_idx: this._runIdx,
      cause: 'death',
      duration_ms: this.runElapsedMs,
      rooms_cleared: this.roomsCleared,
      encounters_cleared: this.encountersCleared,
    });
    this._runIdx += 1;
    this.beginRun();
  }

  private emitSnapshot(partial: boolean): void {
    this.bus.emit('profile.snapshot', { partial, snapshot: this.opts.snapshots.snapshot('room.exit') });
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/events.ts src/game/runDirector.ts src/game/runDirector.test.ts
git commit -m "feat: add RunDirector with encounter/room/run lifecycle and profile boundaries"
```

---

### Task 5: Telemetry schema and `RecordingProfile`

**Files:**
- Create: `src/telemetry/schema.ts`
- Create: `src/telemetry/recordingProfile.ts`
- Test: `src/telemetry/recordingProfile.test.ts`

**Interfaces:**
- Consumes (Task 1): `ProfileSink`.
- Produces:
  - `schema.ts`: `SCHEMA_VERSION = 2`, `GAME_VERSION: string`, `interface Envelope`, `type LoggedEvent = Envelope & Record<string, unknown>`, `type LogFn = (type: string, payload: Record<string, unknown>) => void`, `interface Ctx`.
  - `RECORD_FLUSH_INTERVAL_MS = 250`, `class RecordingProfile implements ProfileSink` with `constructor(inner: ProfileSink, log: LogFn, now: () => number)` and `flushPending(): void`.

- [ ] **Step 1: Create `src/telemetry/schema.ts`**

```ts
// src/telemetry/schema.ts
// Event-log schema v2 (spec 2026-09-30 §4). One LoggedEvent per NDJSON line.

export const SCHEMA_VERSION = 2 as const;

/**
 * Bump whenever gameplay/balance changes make older logs non-comparable
 * (hp, damage, timings, hitbox geometry). Written into every session.start.
 */
export const GAME_VERSION = '0.0.1+5a';

export interface Envelope {
  v: typeof SCHEMA_VERSION;
  /** Monotonic per session, from 0. (session_id, seq) is the unique key. */
  seq: number;
  /** Simulation time in ms (sum of fixed steps), rounded to 0.1. */
  t_ms: number;
  player_id: string;
  session_id: string;
  run_idx: number;
  room_idx: number;
  enc_idx: number;
  type: string;
}

export type LoggedEvent = Envelope & Record<string, unknown>;

export type LogFn = (type: string, payload: Record<string, unknown>) => void;

/** Combat context attached to every combat event (spec §4.3). */
export interface Ctx {
  dist: number;
  p_pos: [number, number];
  e_pos: [number, number];
  aim: [number, number];
  p_state: string;
  e_state: string;
  p_hp: number;
  e_hp: number;
  p_poise: number;
  weapon: string;
  ms_since_last_action: number | null;
}
```

- [ ] **Step 2: Write the failing tests** — create `src/telemetry/recordingProfile.test.ts`:

```ts
// src/telemetry/recordingProfile.test.ts
import { describe, it, expect } from 'vitest';
import type { ProfileSink } from '../profile/profileSink';
import { RecordingProfile, RECORD_FLUSH_INTERVAL_MS } from './recordingProfile';

function make() {
  const forwarded: string[] = [];
  const inner: ProfileSink = {
    record: (s, n, d) => forwarded.push(`record:${s}:${n}:${d}`),
    recordOutcome: (s, o) => forwarded.push(`outcome:${s}:${o}`),
    recordAction: (t, w) => forwarded.push(`action:${t}:${w}`),
    recordDefense: (l) => forwarded.push(`defense:${l}`),
    applyEncounterBoundary: () => forwarded.push('boundary:encounter'),
    applyRoomBoundary: () => forwarded.push('boundary:room'),
    resetSession: () => forwarded.push('reset'),
  };
  const logged: Array<[string, Record<string, unknown>]> = [];
  let now = 0;
  const rec = new RecordingProfile(inner, (t, p) => logged.push([t, p]), () => now);
  return { rec, forwarded, logged, setNow: (t: number) => { now = t; } };
}

describe('RecordingProfile', () => {
  it('logs and forwards non-aggregated writes immediately', () => {
    const { rec, forwarded, logged } = make();
    rec.recordAction('light', 'sword_shield');
    rec.recordAction('throw');
    rec.recordDefense('parry');
    rec.recordOutcome('punish', 'taken');
    expect(logged).toEqual([
      ['obs.action', { actionType: 'light', weaponId: 'sword_shield' }],
      ['obs.action', { actionType: 'throw' }],
      ['obs.defense', { label: 'parry' }],
      ['obs.outcome', { skill: 'punish', outcome: 'taken' }],
    ]);
    expect(forwarded).toEqual([
      'action:light:sword_shield', 'action:throw:undefined', 'defense:parry', 'outcome:punish:taken',
    ]);
  });

  it('aggregates record() per skill and flushes the sum once 250ms of sim time have passed', () => {
    const { rec, forwarded, logged, setNow } = make();
    rec.record('distance', 0.5, 1);
    setNow(100);
    rec.record('distance', 0.25, 1);
    expect(logged).toEqual([]);
    expect(forwarded).toEqual([]);

    setNow(RECORD_FLUSH_INTERVAL_MS);
    rec.record('distance', 0, 1);

    expect(logged).toEqual([['obs.record', { skill: 'distance', num: 0.75, den: 3 }]]);
    expect(forwarded).toEqual(['record:distance:0.75:3']);
  });

  it('flushes every pending skill before a boundary, and before logging the boundary', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 1, 1);
    rec.record('patience', 0, 1);
    rec.applyEncounterBoundary();
    rec.applyRoomBoundary();
    expect(logged.map(([t, p]) => (t === 'obs.record' ? `${t}:${p.skill}` : `${t}:${String(p.kind ?? '')}`))).toEqual([
      'obs.record:distance', 'obs.record:patience', 'obs.boundary:encounter', 'obs.boundary:room',
    ]);
    expect(forwarded).toEqual([
      'record:distance:1:1', 'record:patience:0:1', 'boundary:encounter', 'boundary:room',
    ]);
  });

  it('resetSession flushes pending evidence, then logs obs.reset and forwards', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 1, 1);
    rec.resetSession();
    expect(logged.map(([t]) => t)).toEqual(['obs.record', 'obs.reset']);
    expect(forwarded).toEqual(['record:distance:1:1', 'reset']);
  });

  it('flushPending() (tab hide) logs and forwards the pending sum together', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 0.1, 0.2);
    rec.flushPending();
    expect(logged).toEqual([['obs.record', { skill: 'distance', num: 0.1, den: 0.2 }]]);
    expect(forwarded).toEqual(['record:distance:0.1:0.2']);
    rec.flushPending(); // nothing pending -> no-op
    expect(logged).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/recordingProfile.test.ts`
Expected: FAIL — `Cannot find module './recordingProfile'`.

- [ ] **Step 4: Implement `src/telemetry/recordingProfile.ts`**

```ts
// src/telemetry/recordingProfile.ts
import type { ProfileSink } from '../profile/profileSink';
import type { DefensiveLabel } from '../profile/profileAccumulator';
import type { SkillId, ProfileOutcome } from '../profile/types';
import type { ActionType } from '../combat/actionRegistry';
import type { LogFn } from './schema';

export const RECORD_FLUSH_INTERVAL_MS = 250;

interface Pending {
  num: number;
  den: number;
  sinceMs: number;
}

/**
 * Logs every profile write as an `obs.*` event (layer A of the log, the source
 * of truth for rebuilding the profile — spec §4.2) and forwards it to `inner`.
 *
 * `record()` is aggregated per skill (dim 5 calls it every tick): the sum is
 * logged AND forwarded together, when RECORD_FLUSH_INTERVAL_MS of sim time
 * have passed or before any boundary/reset. Pending evidence is unobservable
 * (DecayedRatio only exposes folded counts), so deferring the forward changes
 * no read — and it makes the live accumulator and a replay perform exactly the
 * same floating-point additions, so the rebuilt profile is bit-identical.
 * Constraint: a skill fed by record() must not also be fed by recordOutcome().
 */
export class RecordingProfile implements ProfileSink {
  private pending = new Map<SkillId, Pending>();

  constructor(
    private readonly inner: ProfileSink,
    private readonly log: LogFn,
    private readonly now: () => number,
  ) {}

  record(skill: SkillId, numerator: number, denominator: number): void {
    let p = this.pending.get(skill);
    if (!p) {
      p = { num: 0, den: 0, sinceMs: this.now() };
      this.pending.set(skill, p);
    }
    p.num += numerator;
    p.den += denominator;
    if (this.now() - p.sinceMs >= RECORD_FLUSH_INTERVAL_MS) this.flushSkill(skill);
  }

  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void {
    this.log('obs.outcome', { skill, outcome });
    this.inner.recordOutcome(skill, outcome);
  }

  recordAction(actionType: ActionType, weaponId?: string): void {
    this.log('obs.action', weaponId === undefined ? { actionType } : { actionType, weaponId });
    this.inner.recordAction(actionType, weaponId);
  }

  recordDefense(label: DefensiveLabel): void {
    this.log('obs.defense', { label });
    this.inner.recordDefense(label);
  }

  applyEncounterBoundary(): void {
    this.flushPending();
    this.log('obs.boundary', { kind: 'encounter' });
    this.inner.applyEncounterBoundary();
  }

  applyRoomBoundary(): void {
    this.flushPending();
    this.log('obs.boundary', { kind: 'room' });
    this.inner.applyRoomBoundary();
  }

  resetSession(): void {
    this.flushPending();
    this.log('obs.reset', {});
    this.inner.resetSession();
  }

  /** Flush every aggregated record() now (boundaries, reset, tab hide). */
  flushPending(): void {
    for (const skill of [...this.pending.keys()]) this.flushSkill(skill);
  }

  private flushSkill(skill: SkillId): void {
    const p = this.pending.get(skill);
    if (!p) return;
    this.pending.delete(skill);
    this.log('obs.record', { skill, num: p.num, den: p.den });
    this.inner.record(skill, p.num, p.den);
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/schema.ts src/telemetry/recordingProfile.ts src/telemetry/recordingProfile.test.ts
git commit -m "feat: add event-log schema and RecordingProfile (obs.* layer)"
```

---

### Task 6: `TelemetryRecorder`, combat context and the telemetry stack

**Files:**
- Create: `src/telemetry/context.ts`
- Create: `src/telemetry/telemetryRecorder.ts`
- Create: `src/telemetry/stack.ts`
- Test: `src/telemetry/telemetryRecorder.test.ts`

**Interfaces:**
- Consumes: `Encounter<ProfileSink>` (Tasks 1–3), `RunDirector`, `PLAYER_START` (Task 4), `RecordingProfile`, `SCHEMA_VERSION`, `LoggedEvent`, `Ctx` (Task 5).
- Produces:
  - `buildCtx(encounter: Encounter<ProfileSink>, msSinceLastAction: number | null): Ctx`, `r1(n)`, `r3(n)`.
  - `POS_SAMPLE_INTERVAL_MS = 250`; `class TelemetryRecorder` with `constructor(opts: { playerId: string; sessionId: string; onRunEnd?: () => void })`, `attach(encounter: Encounter<ProfileSink>): void`, `get nowMs(): number`, `beginTick(stepMs: number): void`, `log(type: string, payload: Record<string, unknown>): void`, `drain(): LoggedEvent[]`.
  - `createTelemetryStack(opts: { accumulator: ProfileAccumulator; playerId: string; sessionId: string; firstRunIdx: number; nextSeed: () => number; entitySize: number; onRunEnd?: () => void }): TelemetryStack` where `TelemetryStack = { accumulator; recorder: TelemetryRecorder; recording: RecordingProfile; encounter: Encounter<RecordingProfile>; director: RunDirector; step(stepMs: number): void }`.

- [ ] **Step 1: Write the failing tests** — create `src/telemetry/telemetryRecorder.test.ts`:

```ts
// src/telemetry/telemetryRecorder.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { createTelemetryStack } from './stack';
import type { LoggedEvent } from './schema';
import { PLAYER_START } from '../game/runDirector';

function makeStack(onRunEnd?: () => void) {
  let seed = 1;
  return createTelemetryStack({
    accumulator: new ProfileAccumulator(),
    playerId: 'player-1',
    sessionId: 'session-1',
    firstRunIdx: 0,
    nextSeed: () => seed++,
    entitySize: 20,
    onRunEnd,
  });
}

function ofType(events: LoggedEvent[], type: string) {
  return events.filter((e) => e.type === type);
}

describe('TelemetryRecorder', () => {
  it('stamps every event with the full envelope and a monotonic seq', () => {
    const stack = makeStack();
    stack.director.start();
    for (let i = 0; i < 120; i++) stack.step(1000 / 60);
    const events = stack.recorder.drain();

    expect(events.slice(0, 3).map((e) => e.type)).toEqual(['run.start', 'room.enter', 'encounter.start']);
    events.forEach((e, i) => {
      expect(e.v).toBe(2);
      expect(e.seq).toBe(i);
      expect(e.player_id).toBe('player-1');
      expect(e.session_id).toBe('session-1');
      expect(e.run_idx).toBe(0);
      expect(typeof e.t_ms).toBe('number');
    });
    for (let i = 1; i < events.length; i++) expect(events[i].t_ms).toBeGreaterThanOrEqual(events[i - 1].t_ms);
    expect(stack.recorder.drain()).toEqual([]);
  });

  it('samples positions every 250ms of simulation time', () => {
    const stack = makeStack();
    stack.director.start();
    stack.recorder.drain();
    for (let i = 0; i < 100; i++) stack.step(10); // 1000ms
    const samples = ofType(stack.recorder.drain(), 'pos.sample');
    expect(samples.map((s) => s.t_ms)).toEqual([250, 500, 750, 1000]);
    expect(samples[0]).toMatchObject({ p: [expect.any(Number), expect.any(Number)], p_state: expect.any(String) });
  });

  it('attaches ctx to combat events, with time since the previous action', () => {
    const stack = makeStack();
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    for (let i = 0; i < 40; i++) stack.step(10); // 400ms, light attack long finished
    stack.encounter.player.tryAction('sword_shield.light');
    const actions = ofType(stack.recorder.drain(), 'player.action');

    expect(actions).toHaveLength(2);
    const first = actions[0].ctx as Record<string, unknown>;
    const second = actions[1].ctx as Record<string, unknown>;
    expect(first.ms_since_last_action).toBeNull();
    expect(second.ms_since_last_action).toBe(400);
    expect(first).toMatchObject({
      p_pos: [PLAYER_START.x, PLAYER_START.y],
      p_hp: 100,
      e_hp: 60,
      weapon: 'sword_shield',
      p_state: 'acting',
    });
    expect(actions[0]).toMatchObject({ actionId: 'sword_shield.light', actionType: 'light', weaponId: 'sword_shield' });
  });

  it('keeps the envelope type and renames an opportunity payload type to opp_type', () => {
    const stack = makeStack();
    stack.director.start();
    stack.encounter.respawnEnemy({ x: PLAYER_START.x + 30, y: PLAYER_START.y }, 'source_interrupted');
    stack.step(16); // Assaltante attacks -> opp.open
    const opens = ofType(stack.recorder.drain(), 'opp.open');
    expect(opens).toHaveLength(1);
    expect(opens[0].opp_type).toBe('dodge');
    expect(opens[0].type).toBe('opp.open');
  });

  it('logs obs.* from the recording profile and calls onRunEnd after run.end', () => {
    let runEnds = 0;
    const stack = makeStack(() => { runEnds += 1; });
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16);
    const events = stack.recorder.drain();
    expect(ofType(events, 'obs.action')).toHaveLength(1);
    expect(ofType(events, 'obs.boundary').map((e) => e.kind)).toEqual(['encounter', 'room']);
    expect(ofType(events, 'run.end')).toHaveLength(1);
    expect(runEnds).toBe(1);
    const runStarts = ofType(events, 'run.start');
    expect(runStarts[runStarts.length - 1].run_idx).toBe(1);
  });

  it('flushPending before drain puts the pending aggregated record in the buffer', () => {
    const stack = makeStack();
    stack.director.start();
    stack.step(16); // one distance record, not yet flushed (< 250ms)
    stack.recorder.drain();
    stack.recording.flushPending();
    const records = ofType(stack.recorder.drain(), 'obs.record');
    expect(records.map((r) => r.skill)).toContain('distance');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/telemetryRecorder.test.ts`
Expected: FAIL — `Cannot find module './stack'`.

- [ ] **Step 3: Implement `src/telemetry/context.ts`**

```ts
// src/telemetry/context.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import type { Ctx } from './schema';

export const r1 = (n: number): number => Math.round(n * 10) / 10;
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Snapshot of the combat situation at the moment of an event — what a
 * sequential predictor (sub-project 5b) needs to condition "what does the
 * player do next" on. `dist` uses the same top-left positions as dim 5.
 */
export function buildCtx(encounter: Encounter<ProfileSink>, msSinceLastAction: number | null): Ctx {
  const p = encounter.player;
  const e = encounter.assaltante;
  const pp = p.position;
  const ep = e.position;
  const aim = p.facing;
  return {
    dist: r1(Math.hypot(ep.x - pp.x, ep.y - pp.y)),
    p_pos: [r1(pp.x), r1(pp.y)],
    e_pos: [r1(ep.x), r1(ep.y)],
    aim: [r3(aim.x), r3(aim.y)],
    p_state: p.state,
    e_state: e.state,
    p_hp: p.hp,
    e_hp: e.hp,
    p_poise: r1(p.poise),
    weapon: p.equippedWeaponId,
    ms_since_last_action: msSinceLastAction === null ? null : r1(msSinceLastAction),
  };
}
```

- [ ] **Step 4: Implement `src/telemetry/telemetryRecorder.ts`**

```ts
// src/telemetry/telemetryRecorder.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import { SCHEMA_VERSION, type LoggedEvent } from './schema';
import { buildCtx, r1 } from './context';

export const POS_SAMPLE_INTERVAL_MS = 250;

/** Bus events logged with a combat `ctx` (spec §4.3). */
const CONTEXT_EVENTS = [
  'player.action', 'player.dodge', 'player.defense', 'player.hit_unmitigated', 'player.hurt',
  'player.death', 'enemy.attack_start', 'enemy.hurt', 'enemy.death', 'opp.open', 'opp.close',
] as const;

export interface TelemetryRecorderOptions {
  playerId: string;
  sessionId: string;
  /** Called right after run.end is logged — the scene persists the buffer then. */
  onRunEnd?: () => void;
}

/**
 * Turns bus events into enveloped LoggedEvents in an in-memory buffer (layer B
 * of the log), and exposes `log()` for the obs.* layer and session.start.
 * Knows nothing about storage: the scene drains the buffer into an EventStore.
 */
export class TelemetryRecorder {
  private buffer: LoggedEvent[] = [];
  private seq = 0;
  private tMs = 0;
  private sinceSampleMs = 0;
  private runIdx = 0;
  private roomIdx = 0;
  private encIdx = 0;
  private lastActionT: number | null = null;
  private encounter: Encounter<ProfileSink> | null = null;

  constructor(private readonly opts: TelemetryRecorderOptions) {}

  get nowMs(): number {
    return this.tMs;
  }

  attach(encounter: Encounter<ProfileSink>): void {
    if (this.encounter) throw new Error('TelemetryRecorder already attached');
    this.encounter = encounter;
    const bus = encounter.bus;

    for (const type of CONTEXT_EVENTS) {
      bus.on(type, (payload: unknown) => this.logWithCtx(type, payload));
    }
    bus.on('run.start', (e) => {
      this.runIdx = e.run_idx;
      this.roomIdx = 0;
      this.encIdx = 0;
      this.lastActionT = null;
      this.log('run.start', { ...e });
    });
    bus.on('room.enter', (e) => {
      this.roomIdx = e.room_idx;
      this.encIdx = 0;
      this.log('room.enter', { ...e });
    });
    bus.on('encounter.start', (e) => {
      this.encIdx = e.enc_idx;
      this.log('encounter.start', { ...e });
    });
    bus.on('encounter.end', (e) => this.log('encounter.end', { ...e }));
    bus.on('profile.snapshot', (e) => this.log('profile.snapshot', { partial: e.partial, ...e.snapshot }));
    bus.on('run.end', (e) => {
      this.log('run.end', { ...e });
      this.opts.onRunEnd?.();
    });
  }

  /** Call once per fixed step, before the simulation step. */
  beginTick(stepMs: number): void {
    this.tMs += stepMs;
    this.sinceSampleMs += stepMs;
    if (this.sinceSampleMs >= POS_SAMPLE_INTERVAL_MS) {
      this.sinceSampleMs -= POS_SAMPLE_INTERVAL_MS;
      this.samplePositions();
    }
  }

  log(type: string, payload: Record<string, unknown>): void {
    // Envelope last so a payload field can never overwrite it.
    this.buffer.push({
      ...payload,
      v: SCHEMA_VERSION,
      seq: this.seq++,
      t_ms: r1(this.tMs),
      player_id: this.opts.playerId,
      session_id: this.opts.sessionId,
      run_idx: this.runIdx,
      room_idx: this.roomIdx,
      enc_idx: this.encIdx,
      type,
    });
  }

  drain(): LoggedEvent[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  private logWithCtx(type: string, payload: unknown): void {
    const fields: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    // opp.* payloads carry their own `type` ('dodge' | 'punish'); keep it
    // without clobbering the envelope's event type.
    if ('type' in fields) {
      fields.opp_type = fields.type;
      delete fields.type;
    }
    fields.ctx = buildCtx(this.encounter!, this.lastActionT === null ? null : this.tMs - this.lastActionT);
    this.log(type, fields);
    if (type === 'player.action') this.lastActionT = this.tMs;
  }

  private samplePositions(): void {
    if (!this.encounter) return;
    const p = this.encounter.player;
    const e = this.encounter.assaltante;
    this.log('pos.sample', {
      p: [r1(p.position.x), r1(p.position.y)],
      e: [r1(e.position.x), r1(e.position.y)],
      p_state: p.state,
      e_state: e.state,
    });
  }
}
```

- [ ] **Step 5: Implement `src/telemetry/stack.ts`**

```ts
// src/telemetry/stack.ts
import { Encounter } from '../combat/encounter';
import type { ProfileAccumulator } from '../profile/profileAccumulator';
import { RunDirector, PLAYER_START } from '../game/runDirector';
import { RecordingProfile } from './recordingProfile';
import { TelemetryRecorder } from './telemetryRecorder';

export interface TelemetryStackOptions {
  /** The live profile — freshly rebuilt from the stored log on load. */
  accumulator: ProfileAccumulator;
  playerId: string;
  sessionId: string;
  firstRunIdx: number;
  nextSeed: () => number;
  /** Hurtbox size of player and Assaltante (the scene passes ENTITY_SIZE). */
  entitySize: number;
  onRunEnd?: () => void;
}

export interface TelemetryStack {
  accumulator: ProfileAccumulator;
  recorder: TelemetryRecorder;
  recording: RecordingProfile;
  encounter: Encounter<RecordingProfile>;
  director: RunDirector;
  /** One fixed simulation step: advance telemetry time, then the game. */
  step(stepMs: number): void;
}

/** Wires recorder → recording profile → encounter → director (used by the scene and by tests). */
export function createTelemetryStack(opts: TelemetryStackOptions): TelemetryStack {
  const recorder = new TelemetryRecorder({
    playerId: opts.playerId,
    sessionId: opts.sessionId,
    onRunEnd: opts.onRunEnd,
  });
  const recording = new RecordingProfile(opts.accumulator, (t, p) => recorder.log(t, p), () => recorder.nowMs);
  const size = opts.entitySize;
  const encounter = new Encounter(
    { x: PLAYER_START.x, y: PLAYER_START.y, width: size, height: size },
    { x: 0, y: 0, width: size, height: size },
    recording,
  );
  recorder.attach(encounter);
  const director = new RunDirector({
    encounter,
    snapshots: opts.accumulator,
    nextSeed: opts.nextSeed,
    firstRunIdx: opts.firstRunIdx,
  });
  return {
    accumulator: opts.accumulator,
    recorder,
    recording,
    encounter,
    director,
    step(stepMs: number) {
      recorder.beginTick(stepMs);
      director.step(stepMs);
    },
  };
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean. If `second.ms_since_last_action` is `399.9`/`400.1` because of float accumulation, it will still be `400` after `r1` since steps are integer `10` — do not loosen the assertion.

- [ ] **Step 7: Commit**

```bash
git add src/telemetry/context.ts src/telemetry/telemetryRecorder.ts src/telemetry/stack.ts src/telemetry/telemetryRecorder.test.ts
git commit -m "feat: add TelemetryRecorder with combat context and position sampling"
```

---

### Task 7: Replay — rebuild the profile from the log (equivalence invariant)

**Files:**
- Create: `src/telemetry/replay.ts`
- Test: `src/telemetry/replay.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent` (Task 5), `createTelemetryStack` (Task 6), `ProfileAccumulator`, `findWeaponAction`.
- Produces: `orderEvents(events: readonly LoggedEvent[]): LoggedEvent[]`, `rebuildProfile(events: readonly LoggedEvent[]): ProfileAccumulator`, `nextRunIdx(events: readonly LoggedEvent[]): number`.

- [ ] **Step 1: Write the failing tests** — create `src/telemetry/replay.test.ts`:

```ts
// src/telemetry/replay.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { Clock } from '../profile/types';
import { findWeaponAction } from '../combat/actionRegistry';
import { createTelemetryStack, type TelemetryStack } from './stack';
import { orderEvents, rebuildProfile, nextRunIdx } from './replay';
import type { LoggedEvent } from './schema';

const SKILLS = ['punish', 'distance', 'patience', 'weapon_repertoire', 'action_repertoire', 'defensive_repertoire'];
const CLOCKS: Clock[] = ['trait', 'state'];

function makeStack(accumulator = new ProfileAccumulator()) {
  let seed = 7;
  const runEnds = { count: 0 };
  const stack = createTelemetryStack({
    accumulator,
    playerId: 'p',
    sessionId: 's',
    firstRunIdx: 0,
    nextSeed: () => seed++,
    entitySize: 20,
    onRunEnd: () => { runEnds.count += 1; },
  });
  stack.recorder.log('session.start', { wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 });
  stack.director.start();
  return { stack, runEnds };
}

/**
 * Deterministic scripted player: chases the Assaltante, attacks on a cadence,
 * dodges now and then, alternates weapons. Only needs to be good enough to
 * produce kills, deaths, rooms and every profile write type — the coverage
 * assertions in the test guard that. If they fail, tune the cadences here;
 * never delete the assertions.
 */
function runBot(stack: TelemetryStack, ticks: number) {
  const { encounter } = stack;
  for (let i = 0; i < ticks; i++) {
    const p = encounter.player.position;
    const e = encounter.assaltante.position;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    encounter.player.setAimDirection({ x: dx, y: dy });
    const far = Math.hypot(dx, dy) > 40;
    encounter.setPlayerMoveInput(far ? dx : 0, far ? dy : 0);
    if (i % 400 === 0) encounter.player.switchWeapon('sword_shield');
    if (i % 400 === 200) encounter.player.switchWeapon('heavy_weapon');
    if (i % 20 === 0) {
      const light = findWeaponAction(encounter.player.equippedWeaponId, 'light');
      if (light) encounter.player.tryAction(light.id);
    }
    if (i % 150 === 75) encounter.player.tryDodge();
    stack.step(1000 / 60);
  }
}

function expectSameProfile(rebuilt: ProfileAccumulator, live: ProfileAccumulator) {
  expect(rebuilt.snapshot('room.exit')).toEqual(live.snapshot('room.exit'));
  for (const skill of SKILLS) {
    for (const clock of CLOCKS) {
      expect(rebuilt.domain(skill, clock)).toBe(live.domain(skill, clock));
      expect(rebuilt.confidence(skill, clock)).toBe(live.confidence(skill, clock));
      expect(rebuilt.omission(skill, clock)).toBe(live.omission(skill, clock));
    }
  }
}

describe('replay', () => {
  it('rebuilding the profile from the log reproduces the live profile exactly, across several runs', () => {
    const live = new ProfileAccumulator();
    const { stack, runEnds } = makeStack(live);
    runBot(stack, 30000);
    stack.recording.flushPending();
    const log = stack.recorder.drain();

    // coverage guards: the scenario really exercised runs, rooms and every obs type
    expect(runEnds.count).toBeGreaterThanOrEqual(2);
    expect(log.some((e) => e.type === 'profile.snapshot' && e.partial === false)).toBe(true);
    for (const t of ['obs.record', 'obs.outcome', 'obs.action', 'obs.defense', 'obs.boundary']) {
      expect(log.some((e) => e.type === t), t).toBe(true);
    }

    expectSameProfile(rebuildProfile(log), live);
  });

  it('JSON round-trip of the log still rebuilds the identical profile', () => {
    const live = new ProfileAccumulator();
    const { stack } = makeStack(live);
    runBot(stack, 6000);
    stack.recording.flushPending();
    const log = JSON.parse(JSON.stringify(stack.recorder.drain())) as LoggedEvent[];
    expectSameProfile(rebuildProfile(log), live);
  });

  it('rebuild starts after the last obs.reset, while earlier history stays in the log', () => {
    const live = new ProfileAccumulator();
    const { stack } = makeStack(live);
    runBot(stack, 6000);
    stack.recording.resetSession();
    runBot(stack, 6000);
    stack.recording.flushPending();
    const log = stack.recorder.drain();

    expect(log.filter((e) => e.type === 'obs.reset')).toHaveLength(1);
    expect(log.findIndex((e) => e.type === 'obs.action')).toBeLessThan(log.findIndex((e) => e.type === 'obs.reset'));
    expectSameProfile(rebuildProfile(log), live);
  });

  it('orderEvents sorts sessions by their session.start wall clock, then by seq', () => {
    const ev = (session_id: string, seq: number, type = 'x', extra: Record<string, unknown> = {}): LoggedEvent => ({
      v: 2, seq, t_ms: 0, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra,
    });
    const later = ev('zzz', 0, 'session.start', { wall_clock_iso: '2026-09-02T00:00:00.000Z' });
    const earlier = ev('aaa', 0, 'session.start', { wall_clock_iso: '2026-09-01T00:00:00.000Z' });
    const ordered = orderEvents([ev('zzz', 1), later, ev('aaa', 1), earlier]);
    expect(ordered.map((e) => `${e.session_id}#${e.seq}`)).toEqual(['aaa#0', 'aaa#1', 'zzz#0', 'zzz#1']);
  });

  it('nextRunIdx continues after the highest run.start, or 0 for an empty log', () => {
    expect(nextRunIdx([])).toBe(0);
    const log = [
      { v: 2, seq: 0, t_ms: 0, player_id: 'p', session_id: 's', run_idx: 3, room_idx: 0, enc_idx: 0, type: 'run.start' },
      { v: 2, seq: 1, t_ms: 0, player_id: 'p', session_id: 's', run_idx: 4, room_idx: 0, enc_idx: 0, type: 'run.start' },
    ] as LoggedEvent[];
    expect(nextRunIdx(log)).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/replay.test.ts`
Expected: FAIL — `Cannot find module './replay'`.

- [ ] **Step 3: Implement `src/telemetry/replay.ts`**

```ts
// src/telemetry/replay.ts
import { ProfileAccumulator, type DefensiveLabel } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import type { ProfileOutcome } from '../profile/types';
import type { ActionType } from '../combat/actionRegistry';
import type { LoggedEvent } from './schema';

/**
 * Chronological order: sessions by their session.start `wall_clock_iso`
 * (ISO-8601 strings sort chronologically), sessions without one last (by id),
 * then by `seq` inside a session.
 */
export function orderEvents(events: readonly LoggedEvent[]): LoggedEvent[] {
  const sessionStart = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'session.start' && typeof e.wall_clock_iso === 'string') {
      sessionStart.set(e.session_id, e.wall_clock_iso);
    }
  }
  const NO_START = '￿';
  return [...events].sort((a, b) => {
    if (a.session_id !== b.session_id) {
      const sa = sessionStart.get(a.session_id) ?? NO_START;
      const sb = sessionStart.get(b.session_id) ?? NO_START;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.session_id < b.session_id ? -1 : 1;
    }
    return a.seq - b.seq;
  });
}

/**
 * Rebuilds the profile by re-applying the `obs.*` events after the last
 * `obs.reset`, with the parameters currently in the code (γ, κ, …) — which is
 * what makes re-analysis with new parameters possible. Non-obs events are ignored.
 */
export function rebuildProfile(events: readonly LoggedEvent[]): ProfileAccumulator {
  const ordered = orderEvents(events);
  let start = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].type === 'obs.reset') {
      start = i + 1;
      break;
    }
  }
  const acc = new ProfileAccumulator();
  for (let i = start; i < ordered.length; i++) applyObservation(acc, ordered[i]);
  return acc;
}

function applyObservation(sink: ProfileSink, e: LoggedEvent): void {
  switch (e.type) {
    case 'obs.record':
      sink.record(e.skill as string, e.num as number, e.den as number);
      break;
    case 'obs.outcome':
      sink.recordOutcome(e.skill as string, e.outcome as ProfileOutcome);
      break;
    case 'obs.action':
      sink.recordAction(e.actionType as ActionType, e.weaponId as string | undefined);
      break;
    case 'obs.defense':
      sink.recordDefense(e.label as DefensiveLabel);
      break;
    case 'obs.boundary':
      if (e.kind === 'encounter') sink.applyEncounterBoundary();
      else if (e.kind === 'room') sink.applyRoomBoundary();
      break;
    default:
      break;
  }
}

/** Run numbering continues across sessions: highest logged run.start + 1. */
export function nextRunIdx(events: readonly LoggedEvent[]): number {
  let max = -1;
  for (const e of events) {
    if (e.type === 'run.start' && typeof e.run_idx === 'number' && e.run_idx > max) max = e.run_idx;
  }
  return max + 1;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean. If a coverage guard fails (e.g. `runEnds.count` < 2 or no `obs.defense`), adjust the bot cadences in `runBot` (more ticks, different dodge cadence) — do not relax the guards or the exact (`toBe`) comparisons.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/replay.ts src/telemetry/replay.test.ts
git commit -m "feat: rebuild the profile from the event log with exact equivalence"
```

---

### Task 8: `EventStore` — in-memory and IndexedDB

**Files:**
- Modify: `package.json`, `package-lock.json` (devDependency)
- Create: `src/telemetry/eventStore.ts`
- Test: `src/telemetry/eventStore.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent` (Task 5), `orderEvents` (Task 7).
- Produces: `interface EventStore { append(events: readonly LoggedEvent[]): Promise<void>; readAll(): Promise<LoggedEvent[]>; getMeta<T>(key: string): Promise<T | undefined>; setMeta(key: string, value: unknown): Promise<void>; clear(): Promise<void>; close(): void }`, `class MemoryEventStore implements EventStore`, `class IndexedDbEventStore implements EventStore` with `static open(factory?: IDBFactory, name?: string): Promise<IndexedDbEventStore>`.

- [ ] **Step 1: Add the test dependency**

Run: `npm install --save-dev fake-indexeddb@^6`
Expected: `package.json` gains `"fake-indexeddb": "^6.x"` under `devDependencies`.

- [ ] **Step 2: Write the failing tests** — create `src/telemetry/eventStore.test.ts`:

```ts
// src/telemetry/eventStore.test.ts
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryEventStore, IndexedDbEventStore, type EventStore } from './eventStore';
import type { LoggedEvent } from './schema';

function ev(session_id: string, seq: number, type = 'x', extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra };
}

let dbCounter = 0;
const factories: Array<[string, () => Promise<EventStore>]> = [
  ['MemoryEventStore', async () => new MemoryEventStore()],
  ['IndexedDbEventStore', () => IndexedDbEventStore.open(new IDBFactory() as unknown as IDBFactory, `test-${dbCounter++}`)],
];

describe.each(factories)('%s', (_name, make) => {
  it('reads back appended events in chronological order', async () => {
    const store = await make();
    await store.append([ev('b', 1), ev('b', 0, 'session.start', { wall_clock_iso: '2026-09-02T00:00:00.000Z' })]);
    await store.append([ev('a', 0, 'session.start', { wall_clock_iso: '2026-09-01T00:00:00.000Z' }), ev('a', 1)]);
    const all = await store.readAll();
    expect(all.map((e) => `${e.session_id}#${e.seq}`)).toEqual(['a#0', 'a#1', 'b#0', 'b#1']);
    store.close();
  });

  it('appending the same (session_id, seq) twice keeps one copy', async () => {
    const store = await make();
    await store.append([ev('a', 0), ev('a', 1)]);
    await store.append([ev('a', 1), ev('a', 2)]);
    expect((await store.readAll()).map((e) => e.seq)).toEqual([0, 1, 2]);
    store.close();
  });

  it('stores and reads meta values; missing keys are undefined', async () => {
    const store = await make();
    expect(await store.getMeta<string>('player_id')).toBeUndefined();
    await store.setMeta('player_id', 'abc');
    expect(await store.getMeta<string>('player_id')).toBe('abc');
    store.close();
  });

  it('clear() empties events and meta', async () => {
    const store = await make();
    await store.append([ev('a', 0)]);
    await store.setMeta('player_id', 'abc');
    await store.clear();
    expect(await store.readAll()).toEqual([]);
    expect(await store.getMeta('player_id')).toBeUndefined();
    store.close();
  });

  it('append([]) is a no-op', async () => {
    const store = await make();
    await store.append([]);
    expect(await store.readAll()).toEqual([]);
    store.close();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/eventStore.test.ts`
Expected: FAIL — `Cannot find module './eventStore'`.

- [ ] **Step 4: Implement `src/telemetry/eventStore.ts`**

```ts
// src/telemetry/eventStore.ts
import type { LoggedEvent } from './schema';
import { orderEvents } from './replay';

/**
 * Where the event log lives. The game never depends on a concrete store, so a
 * server-backed implementation can be added later without touching it.
 * Events are keyed by (session_id, seq): re-appending an event overwrites it,
 * which makes imports idempotent.
 */
export interface EventStore {
  append(events: readonly LoggedEvent[]): Promise<void>;
  /** All events, chronologically ordered (see orderEvents). */
  readAll(): Promise<LoggedEvent[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

const keyOf = (e: LoggedEvent): string => `${e.session_id}#${e.seq}`;

/** Fallback when IndexedDB is unavailable (private window), and for tests. */
export class MemoryEventStore implements EventStore {
  private events = new Map<string, LoggedEvent>();
  private meta = new Map<string, unknown>();

  async append(events: readonly LoggedEvent[]): Promise<void> {
    for (const e of events) this.events.set(keyOf(e), e);
  }

  async readAll(): Promise<LoggedEvent[]> {
    return orderEvents([...this.events.values()]);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  async clear(): Promise<void> {
    this.events.clear();
    this.meta.clear();
  }

  close(): void {}
}

const DB_NAME = 'tcc-telemetry';
const DB_VERSION = 1;
const EVENTS = 'events';
const META = 'meta';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbEventStore implements EventStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<IndexedDbEventStore> {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(EVENTS, { keyPath: ['session_id', 'seq'] });
      db.createObjectStore(META);
    };
    return new IndexedDbEventStore(await request(req));
  }

  async append(events: readonly LoggedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const tx = this.db.transaction(EVENTS, 'readwrite');
    const store = tx.objectStore(EVENTS);
    for (const e of events) store.put(e);
    await done(tx);
  }

  async readAll(): Promise<LoggedEvent[]> {
    const tx = this.db.transaction(EVENTS, 'readonly');
    const all = (await request(tx.objectStore(EVENTS).getAll())) as LoggedEvent[];
    return orderEvents(all);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction(META, 'readonly');
    return (await request(tx.objectStore(META).get(key))) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(value, key);
    await done(tx);
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([EVENTS, META], 'readwrite');
    tx.objectStore(EVENTS).clear();
    tx.objectStore(META).clear();
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS for both `describe.each` variants, typecheck clean. (`new IDBFactory() as unknown as IDBFactory` bridges fake-indexeddb's class to the DOM lib type; keep the cast in the test only.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/telemetry/eventStore.ts src/telemetry/eventStore.test.ts
git commit -m "feat: add EventStore with in-memory and IndexedDB implementations"
```

---

### Task 9: NDJSON export and import

**Files:**
- Create: `src/telemetry/ndjson.ts`
- Test: `src/telemetry/ndjson.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent`, `SCHEMA_VERSION` (Task 5), `EventStore`, `MemoryEventStore` (Task 8), `orderEvents` (Task 7).
- Produces: `toNdjson(events: readonly LoggedEvent[]): string`, `isLoggedEvent(x: unknown): x is LoggedEvent`, `parseNdjson(text: string): { events: LoggedEvent[]; invalidLines: number }`, `importInto(store: EventStore, text: string): Promise<{ imported: number; invalidLines: number; playerId: string | undefined }>`.

- [ ] **Step 1: Write the failing tests** — create `src/telemetry/ndjson.test.ts`:

```ts
// src/telemetry/ndjson.test.ts
import { describe, it, expect } from 'vitest';
import { toNdjson, parseNdjson, importInto } from './ndjson';
import { MemoryEventStore } from './eventStore';
import type { LoggedEvent } from './schema';

function ev(session_id: string, seq: number, player_id = 'p', extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id, session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x', ...extra };
}

describe('ndjson', () => {
  it('round-trips events through text without loss', () => {
    const events = [ev('a', 0, 'p', { ctx: { dist: 12.3, aim: [0.707, -0.707] } }), ev('a', 1)];
    const text = toNdjson(events);
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(parseNdjson(text)).toEqual({ events, invalidLines: 0 });
  });

  it('skips and counts invalid lines, ignores blank lines and CRLF', () => {
    const good = JSON.stringify(ev('a', 0));
    const text = [good, '', 'not json', JSON.stringify({ ...ev('a', 1), v: 1 }), JSON.stringify({ type: 'x' }), good].join('\r\n');
    const result = parseNdjson(text);
    expect(result.invalidLines).toBe(3);
    expect(result.events).toHaveLength(2);
  });

  it('importing into a store merges, dedupes by (session_id, seq) and adopts the file player_id', async () => {
    const store = new MemoryEventStore();
    await store.append([ev('local', 0, 'old-id')]);
    await store.setMeta('player_id', 'old-id');
    const text = toNdjson([ev('remote', 0, 'imported-id'), ev('remote', 1, 'imported-id')]);

    const first = await importInto(store, text);
    const second = await importInto(store, text);

    expect(first).toEqual({ imported: 2, invalidLines: 0, playerId: 'imported-id' });
    expect(second.imported).toBe(2);
    expect((await store.readAll()).map((e) => `${e.session_id}#${e.seq}`).sort()).toEqual(['local#0', 'remote#0', 'remote#1']);
    expect(await store.getMeta('player_id')).toBe('imported-id');
  });

  it('importing an empty or all-invalid file changes nothing', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'keep');
    expect(await importInto(store, 'garbage\n')).toEqual({ imported: 0, invalidLines: 1, playerId: undefined });
    expect(await store.getMeta('player_id')).toBe('keep');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/ndjson.test.ts`
Expected: FAIL — `Cannot find module './ndjson'`.

- [ ] **Step 3: Implement `src/telemetry/ndjson.ts`**

```ts
// src/telemetry/ndjson.ts
import { SCHEMA_VERSION, type LoggedEvent } from './schema';
import type { EventStore } from './eventStore';
import { orderEvents } from './replay';

/** One JSON object per line, trailing newline. */
export function toNdjson(events: readonly LoggedEvent[]): string {
  return events.length === 0 ? '' : events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

export function isLoggedEvent(x: unknown): x is LoggedEvent {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e.v === SCHEMA_VERSION &&
    Number.isInteger(e.seq) && (e.seq as number) >= 0 &&
    typeof e.t_ms === 'number' &&
    typeof e.player_id === 'string' &&
    typeof e.session_id === 'string' &&
    typeof e.run_idx === 'number' &&
    typeof e.room_idx === 'number' &&
    typeof e.enc_idx === 'number' &&
    typeof e.type === 'string'
  );
}

export function parseNdjson(text: string): { events: LoggedEvent[]; invalidLines: number } {
  const events: LoggedEvent[] = [];
  let invalidLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isLoggedEvent(parsed)) events.push(parsed);
      else invalidLines += 1;
    } catch {
      invalidLines += 1;
    }
  }
  return { events, invalidLines };
}

/**
 * Merges an exported history into `store` (idempotent: the store keys events
 * by (session_id, seq)) and adopts the player_id of the file's most recent
 * event, so the rebuilt profile is the imported player's.
 */
export async function importInto(
  store: EventStore,
  text: string,
): Promise<{ imported: number; invalidLines: number; playerId: string | undefined }> {
  const { events, invalidLines } = parseNdjson(text);
  if (events.length === 0) return { imported: 0, invalidLines, playerId: undefined };
  await store.append(events);
  const ordered = orderEvents(events);
  const playerId = ordered[ordered.length - 1].player_id;
  await store.setMeta('player_id', playerId);
  return { imported: events.length, invalidLines, playerId };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/ndjson.ts src/telemetry/ndjson.test.ts
git commit -m "feat: add NDJSON export/import of the event history"
```

---

### Task 10: Boot, persistence and dev keys in `ArenaScene`; doc status

**Files:**
- Create: `src/telemetry/bootstrap.ts`
- Test: `src/telemetry/bootstrap.test.ts`
- Modify: `src/scenes/ArenaScene.ts`
- Modify: `Contexto_pesquisa/instrumento-perfil-adaptativo.md`

**Interfaces:**
- Consumes: everything above — `createTelemetryStack`, `TelemetryStack`, `EventStore`, `MemoryEventStore`, `IndexedDbEventStore`, `rebuildProfile`, `nextRunIdx`, `toNdjson`, `importInto`, `SCHEMA_VERSION`, `GAME_VERSION`, `PLAYER_MAX_HP`, `ASSALTANTE_MAX_HP`, `ROOM_ENCOUNTER_COUNT`.
- Produces: `loadProfileState(store: EventStore, newId: () => string): Promise<BootState>` with `BootState = { accumulator: ProfileAccumulator; playerId: string; firstRunIdx: number; restored: boolean }`.

- [ ] **Step 1: Write the failing tests** — create `src/telemetry/bootstrap.test.ts`:

```ts
// src/telemetry/bootstrap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadProfileState } from './bootstrap';
import { MemoryEventStore, type EventStore } from './eventStore';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { createTelemetryStack } from './stack';

describe('loadProfileState', () => {
  it('first launch: creates and saves a player_id, starts at run 0 with an empty profile', async () => {
    const store = new MemoryEventStore();
    const boot = await loadProfileState(store, () => 'new-id');
    expect(boot.playerId).toBe('new-id');
    expect(await store.getMeta('player_id')).toBe('new-id');
    expect(boot.firstRunIdx).toBe(0);
    expect(boot.restored).toBe(true);
    expect(boot.accumulator.snapshot('room.exit').counts).toEqual({});
  });

  it('later launch: keeps the player_id, rebuilds the profile and continues run numbering — also after a reset', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'me');
    let seed = 1;
    const live = new ProfileAccumulator();
    const stack = createTelemetryStack({
      accumulator: live, playerId: 'me', sessionId: 's1', firstRunIdx: 0,
      nextSeed: () => seed++, entitySize: 20,
    });
    stack.recorder.log('session.start', { wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 });
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16); // run 0 ends, run 1 starts
    stack.recording.resetSession();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16); // run 1 ends, run 2 starts
    await store.append(stack.recorder.drain());

    const boot = await loadProfileState(store, () => 'unused');

    expect(boot.playerId).toBe('me');
    expect(boot.firstRunIdx).toBe(3);
    expect(boot.accumulator.snapshot('room.exit')).toEqual(live.snapshot('room.exit'));
    expect(boot.accumulator.snapshot('room.exit').counts.action_repertoire).toEqual([1, 1]); // only the post-reset action
  });

  it('a store that throws degrades to a fresh in-memory profile instead of crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: EventStore = {
      append: async () => { throw new Error('quota'); },
      readAll: async () => { throw new Error('blocked'); },
      getMeta: async () => { throw new Error('blocked'); },
      setMeta: async () => { throw new Error('blocked'); },
      clear: async () => {},
      close: () => {},
    };
    const boot = await loadProfileState(broken, () => 'fallback-id');
    expect(boot).toMatchObject({ playerId: 'fallback-id', firstRunIdx: 0, restored: false });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/telemetry/bootstrap.test.ts`
Expected: FAIL — `Cannot find module './bootstrap'`.

- [ ] **Step 3: Implement `src/telemetry/bootstrap.ts`**

```ts
// src/telemetry/bootstrap.ts
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { EventStore } from './eventStore';
import { rebuildProfile, nextRunIdx } from './replay';

export interface BootState {
  accumulator: ProfileAccumulator;
  playerId: string;
  firstRunIdx: number;
  /** false when the store failed and the game runs on a fresh in-memory profile. */
  restored: boolean;
}

/**
 * Game start (spec §5.3): player_id from the store (or a new one), profile
 * rebuilt from the stored log, run numbering continued. Any store failure
 * degrades to a fresh profile — the game must never fail to start because of
 * telemetry.
 */
export async function loadProfileState(store: EventStore, newId: () => string): Promise<BootState> {
  try {
    let playerId = await store.getMeta<string>('player_id');
    if (!playerId) {
      playerId = newId();
      await store.setMeta('player_id', playerId);
    }
    const events = await store.readAll();
    return { accumulator: rebuildProfile(events), playerId, firstRunIdx: nextRunIdx(events), restored: true };
  } catch (err) {
    console.warn('[telemetry] could not load history, starting with a fresh in-memory profile', err);
    return { accumulator: new ProfileAccumulator(), playerId: newId(), firstRunIdx: 0, restored: false };
  }
}
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/telemetry/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the scene** — edit `src/scenes/ArenaScene.ts`.

Imports — remove `import { Encounter } from '../combat/encounter';` and add:

```ts
import { ARENA_BOUNDS, PLAYER_MAX_HP, ASSALTANTE_MAX_HP, ROOM_ENCOUNTER_COUNT } from '../combat/movementDefs';
import { createTelemetryStack, type TelemetryStack } from '../telemetry/stack';
import { IndexedDbEventStore, MemoryEventStore, type EventStore } from '../telemetry/eventStore';
import { loadProfileState, type BootState } from '../telemetry/bootstrap';
import { toNdjson, importInto } from '../telemetry/ndjson';
import { SCHEMA_VERSION, GAME_VERSION } from '../telemetry/schema';
```

(replace the existing `import { ARENA_BOUNDS } from '../combat/movementDefs';`). Add module-level constant and helper next to the other constants:

```ts
const PERSIST_INTERVAL_MS = 2000;

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Fields — replace `private encounter!: Encounter;` with:

```ts
  private stack!: TelemetryStack;
  private store: EventStore = new MemoryEventStore();
  private ready = false;
  private persistWarned = false;
  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') this.flushAndPersist();
  };
  private readonly onPageHide = (): void => this.flushAndPersist();

  private get encounter() {
    return this.stack.encounter;
  }
```

In `create()`:
1. Make the first line `this.ready = false;` (the scene instance is reused by `scene.restart()`).
2. Delete the `this.encounter = new Encounter(...)` statement.
3. Move the `new OpportunityOverlay(...)` and `new HudState(...)` statements and the `this.loop = createFixedTimestepLoop(...)` statement out of `create()` into `startGame()` below (keep `this.overlayText`/`this.hudText` creation in `create()`).
4. Add to the controls text array, as the last line: `'  F2 / F8 / F9 - resetar perfil / exportar / importar historico',`
5. After the existing key bindings, add:

```ts
    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.F2,
      Phaser.Input.Keyboard.KeyCodes.F8,
      Phaser.Input.Keyboard.KeyCodes.F9,
    ]);
    keyboard.on('keydown-F2', () => {
      if (this.ready) this.stack.recording.resetSession();
    });
    keyboard.on('keydown-F8', () => void this.exportHistory());
    keyboard.on('keydown-F9', () => this.importHistory());
```

6. As the last statement of `create()`:

```ts
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onHide);
      window.removeEventListener('pagehide', this.onPageHide);
      this.store.close();
    });
    void this.boot();
```

Add these methods to the class:

```ts
  private async boot(): Promise<void> {
    try {
      this.store = await IndexedDbEventStore.open();
    } catch (err) {
      console.warn('[telemetry] IndexedDB unavailable, history will not survive a reload', err);
      this.store = new MemoryEventStore();
    }
    const boot = await loadProfileState(this.store, () => crypto.randomUUID());
    this.startGame(boot);
  }

  private startGame(boot: BootState): void {
    this.stack = createTelemetryStack({
      accumulator: boot.accumulator,
      playerId: boot.playerId,
      sessionId: crypto.randomUUID(),
      firstRunIdx: boot.firstRunIdx,
      nextSeed: () => Math.floor(Math.random() * 0x100000000),
      entitySize: ENTITY_SIZE,
      onRunEnd: () => void this.persist(),
    });

    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });
    new HudState(this.encounter.bus, (counters) => {
      this.hudCounters = counters;
    });
    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.stack.step(stepMs));

    this.stack.recorder.log('session.start', {
      wall_clock_iso: new Date().toISOString(),
      game_version: GAME_VERSION,
      schema_v: SCHEMA_VERSION,
      persistent: this.store instanceof IndexedDbEventStore && boot.restored,
    });
    this.stack.director.start();

    this.time.addEvent({ delay: PERSIST_INTERVAL_MS, loop: true, callback: () => void this.persist() });
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
    this.ready = true;
  }

  private async persist(): Promise<void> {
    if (!this.stack) return;
    const batch = this.stack.recorder.drain();
    if (batch.length === 0) return;
    try {
      await this.store.append(batch);
    } catch (err) {
      if (!this.persistWarned) {
        console.warn('[telemetry] failed to persist events; continuing in memory', err);
        this.persistWarned = true;
      }
    }
  }

  private flushAndPersist(): void {
    if (!this.ready) return;
    this.stack.recording.flushPending();
    void this.persist();
  }

  private async exportHistory(): Promise<void> {
    if (!this.ready) return;
    this.stack.recording.flushPending();
    await this.persist();
    const events = await this.store.readAll();
    const playerId = String(events[events.length - 1]?.player_id ?? 'sem-id').slice(0, 8);
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`tcc-historico-${playerId}-${date}.ndjson`, toNdjson(events));
  }

  private importHistory(): void {
    if (!this.ready) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ndjson,.jsonl,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.stack.recording.flushPending();
      await this.persist();
      const result = await importInto(this.store, await file.text());
      if (result.invalidLines > 0) {
        console.warn(`[telemetry] import skipped ${result.invalidLines} invalid line(s)`);
      }
      this.scene.restart(); // new session: profile rebuilt from the merged history
    };
    input.click();
  }
```

In `update()`, make the first line:

```ts
    if (!this.ready) return;
```

and add two lines at the top of the `this.hudText.setText([...])` array:

```ts
      `HP: ${this.encounter.player.hp}/${PLAYER_MAX_HP} · inimigo: ${this.encounter.assaltante.hp}/${ASSALTANTE_MAX_HP}`,
      `run ${this.stack.director.runIdx} · sala ${this.stack.director.roomIdx + 1} · encontro ${this.stack.director.encIdx + 1}/${ROOM_ENCOUNTER_COUNT}`,
```

(`drawDebugHitboxes`, `tryEquippedAction` and the key/pointer handlers keep using `this.encounter`, now the getter. Pointer/key handlers can fire before boot finishes: guard `tryEquippedAction` and the arrow handlers that call `this.encounter...` by early-returning when `!this.ready` — add `if (!this.ready) return false;` as the first line of `tryEquippedAction`, and wrap the other bindings as `() => this.ready && this.encounter.player.switchWeapon('sword_shield')` etc.)

- [ ] **Step 6: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests PASS, Vite build succeeds.

- [ ] **Step 7: Manual verification in the browser** (`npm run dev`, open `http://localhost:5173`)

Check, in order:
1. HUD shows `HP: 100/100 · inimigo: 60/60` and `run N · sala 1 · encontro 1/3`.
2. Kill the Assaltante 3 times → `sala 2 · encontro 1/3`; each new Assaltante spawns away from you.
3. Let the Assaltante kill you → HP back to 100, run number +1, you are back at the arena center.
4. Reload the page → run number continues (does not restart at 0).
5. F8 → a `tcc-historico-*.ndjson` downloads; open it: one JSON per line, contains `session.start`, `run.start`, `obs.*`, `pos.sample`, `player.action` with `ctx`.
6. F2, then F8 again → the new file contains an `obs.reset` line and still contains the earlier history.
7. F9 → pick the exported file → the scene restarts, run numbering continues, no console errors.
8. Private/incognito window → game starts and plays (console shows the IndexedDB warning at most).

- [ ] **Step 8: Update the consolidated doc** — in `Contexto_pesquisa/instrumento-perfil-adaptativo.md`:

Replace

```
| 3 | Acumuladores decaídos + `profile.snapshot` | ✅ Feito (como API) | o formato existe e é testado, mas **nenhum código de jogo chama** `applyRoomBoundary()`, `applyEncounterBoundary()`, `snapshot()` ou `resetSession()`, porque ainda não existem salas nem sessões |
```

with

```
| 3 | Acumuladores decaídos + `profile.snapshot` | ✅ Feito | desde o 5a, o `RunDirector` chama `applyEncounterBoundary()`/`applyRoomBoundary()`/`snapshot('room.exit')` no fim de cada encontro/sala/run; `resetSession()` só pelo F2 (marcador `obs.reset`) |
```

Replace

```
| telemetria/persistência | exportação de eventos e snapshots | ❌ Não existe |
```

with

```
| `game/` + `telemetry/` | `RunDirector` (encontro → sala → run); log em duas camadas (`obs.*` + contexto) em IndexedDB; reconstrução exata do perfil ao abrir; export/import `.ndjson` (F8/F9) | ✅ Completo (5a) |
```

In the §5.2 table, in the `5a` row, replace `| Spec escrita |` with `| ✅ Implementado |`.

- [ ] **Step 9: Commit**

```bash
git add src/telemetry/bootstrap.ts src/telemetry/bootstrap.test.ts src/scenes/ArenaScene.ts Contexto_pesquisa/instrumento-perfil-adaptativo.md
git commit -m "feat: persist the event log, rebuild the profile on load and add export/import keys"
```
