# Combate fluido e responsivo (sub-projeto B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o movimento e o combate do jogador fluidos (recuperação cancelável, dash a partir de mais estados, buffer de input, bloqueio com movimento) e redefinir a janela da dim 6 para a parte não cancelável da ação.

**Architecture:** Estende o `PlayerController` existente com fases explícitas do ataque (carregando / preso / recuperação), um `InputBuffer` puro em arquivo próprio e o evento `player.cancel`. `lockedMs()` em `actionRegistry.ts` alimenta o hook da dim 6 no `Encounter`. Constantes de balanceamento ficam centralizadas em `actionDefs.ts` / `movementDefs.ts`.

**Tech Stack:** TypeScript, Vitest, Vite, Phaser (cena apenas lê o resultado; sem mudança no mapeamento de teclas).

**Spec:** `docs/superpowers/specs/2026-09-30-combate-fluido-b-design.md`

## Global Constraints

- `PLAYER_MOVE_SPEED` 160 → 220; `BLOCK_MOVE_SPEED_FACTOR` = 0.5; `DASH_DISTANCE` 80 → 120; `DODGE` = `{ durationMs: 180, iframesMs: 150, cooldownMs: 200 }`; `STAGGER_MS` 350 → 250; `SWITCH_RECOVERY_MS` 250 → 150; `INPUT_BUFFER_MS` = 120; `ASSALTANTE_CHASE_SPEED` 90 → 125.
- Sem lunge, sem inércia, sem cargas de dash; stagger continua travando tudo.
- Tempos de ação por arma (`actionRegistry`) NÃO mudam.
- `GAME_VERSION` = `'0.0.2+combatB'`.
- Evento novo: `player.cancel { by: 'move' | 'dash' | 'attack', actionId: string }`, logado com `ctx`, sempre emitido ANTES do evento da ação que ele causa (`player.dodge` / `player.action`).
- Tempo do buffer é tempo de simulação (soma dos `stepMs`), determinístico.
- A equivalência log → perfil do 5a (`replay.test.ts`) deve continuar passando sem afrouxar; nenhuma mudança em `obs.*`.
- Commits: sem co-autoria do Claude; o autor aprova a mensagem antes de cada commit.
- Suíte de base: 338 testes passando (`npx vitest run`), `npm run typecheck` e `npm run build` limpos.

## Review Focus

- Dash pressionado durante preso, depois de o jogador já ter soltado a tecla: deve sair no início da recuperação só se ≤ 120 ms; passado disso é descartado (Task 3).
- Movimento já mantido apertado ao iniciar um ataque: a recuperação deve ser cancelada no primeiro tick dela, nunca durante preso (Task 3).
- `reset()` no meio de recuperação/buffer pendente (morte do jogador): nenhum input antigo pode disparar na run seguinte (Task 3).
- Ataque bufferizado de uma arma e troca de arma antes de executar: não pode executar a ação da arma antiga (Task 3).
- Carregado: dash durante o carregamento não emite `player.action`, e soltar Q depois não faz nada (Task 3).

---

### Task 1: Constantes, `lockedMs` e dim 6

**Files:**
- Modify: `src/combat/actionDefs.ts`
- Modify: `src/combat/movementDefs.ts`
- Modify: `src/combat/actionRegistry.ts` (após `totalCommitmentMs`, linha ~126)
- Modify: `src/combat/encounter.ts:13,53-54`
- Test: `src/combat/actionRegistry.test.ts`, `src/combat/encounter.test.ts`

**Interfaces:**
- Produces: `lockedMs(action: ActionDef): number`; constantes `BLOCK_MOVE_SPEED_FACTOR`, `INPUT_BUFFER_MS` (esta em `actionDefs.ts`).

- [ ] **Step 1: Write the failing tests**

Em `src/combat/actionRegistry.test.ts`, importar `lockedMs` junto de `totalCommitmentMs` e adicionar:

```ts
  it('lockedMs is startup+active for a non-charged action', () => {
    const light = resolveAction('sword_shield.light');
    expect(lockedMs(light)).toBe(200);
  });

  it('lockedMs is active only for a charged action (charging itself is dash-cancelable)', () => {
    const charged = resolveAction('sword_shield.charged');
    expect(lockedMs(charged)).toBe(140);
  });
```

(Se `resolveAction` ainda não for importado no arquivo, importe de `./actionRegistry`.)

Em `src/combat/encounter.test.ts`, logo após o teste "mid-telegraph ... not patient" (linha ~523), adicionar:

```ts
  it('dim 6 uses the non-cancelable window: a threat that lands only in the cancelable recovery still counts as patient', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );

    encounter.step(STEP_MS); // Assaltante enters 'attacking'; its swing activates ~TELEGRAPH_MS - STEP_MS from now
    expect(encounter.assaltante.state).toBe('attacking');

    // sword_shield.light: lockedMs = 200, totalCommitmentMs = 350. The threat lands at ~384ms,
    // after both windows -> patient either way; so advance until the threat falls between them.
    runFor(encounter, 150); // threat now lands ~234ms ahead: after lockedMs (200) but before totalCommitmentMs (350)
    encounter.player.tryAction('sword_shield.light');

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.patience).toEqual([1, 1]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/combat/actionRegistry.test.ts src/combat/encounter.test.ts`
Expected: FAIL — `lockedMs` is not exported; the encounter test records `[0, 1]`.

- [ ] **Step 3: Implement**

`src/combat/actionDefs.ts` — replace the DODGE block and `SWITCH_RECOVERY_MS`, `STAGGER_MS`; add `INPUT_BUFFER_MS`:

```ts
export const DODGE: DodgeTiming = {
  durationMs: 180,
  iframesMs: 150,
  cooldownMs: 200,
};

export const SWITCH_RECOVERY_MS = 150;
/** How long a pressed-but-not-yet-executable attack/dash waits for the player to become able to act. */
export const INPUT_BUFFER_MS = 120;
```

and `export const STAGGER_MS = 250;`

`src/combat/movementDefs.ts`:

```ts
export const PLAYER_MOVE_SPEED = 220; // px/s
export const BLOCK_MOVE_SPEED_FACTOR = 0.5; // fraction of PLAYER_MOVE_SPEED while blocking
export const ASSALTANTE_CHASE_SPEED = 125; // px/s, slower than the player
export const DASH_DISTANCE = 120; // px, total displacement over DODGE.durationMs
```

`src/combat/actionRegistry.ts` — append:

```ts
/** Non-cancelable part of an action: the player cannot move, dash or act. */
export function lockedMs(action: ActionDef): number {
  return action.actionType === 'charged'
    ? action.timing.activeMs // after release; charging itself is dash-cancelable
    : action.timing.startupMs + action.timing.activeMs;
}
```

`src/combat/encounter.ts` — change the import (`resolveAction, lockedMs`; drop `totalCommitmentMs` if no longer used there) and the hook:

```ts
      const exposureMs = lockedMs(resolveAction(e.actionId));
      const isPatient = isPatientAttack(exposureMs, [this.assaltante], this.player.hurtbox());
```

- [ ] **Step 4: Run the whole suite and fix constant-dependent tests**

Run: `npx vitest run`
Expected: the new tests PASS. Other tests that hard-code old numbers fail (typically in `playerController.test.ts` — stagger/dash/move tests that use literals — and the `predictThreatMs vs. the real loop` block of `encounter.test.ts`, whose comments assume chase speed 90, `closeMs = 1000`). For each failure: if the test imports the constant, it needs no change; if it hard-codes a time, update the number and its comment to the new constant (chase 125 → `closeMs = (150-60)/125*1000 = 720`, threat at ~1120 ms; keep `horizonMs` comfortably above it — 1500 still works; re-derive the "8ms discretization bias" comment from the observed value instead of guessing). Do not weaken any assertion. Re-run until green.

- [ ] **Step 5: Commit (author approves the message first)**

```bash
git add src/combat/actionDefs.ts src/combat/movementDefs.ts src/combat/actionRegistry.ts src/combat/encounter.ts src/combat/*.test.ts
git commit -m "feat: add combat B parameters, lockedMs and the dim 6 locked window"
```

---

### Task 2: `InputBuffer`

**Files:**
- Create: `src/combat/inputBuffer.ts`
- Test: `src/combat/inputBuffer.test.ts`

**Interfaces:**
- Produces:
  - `type BufferedInput = { kind: 'attack'; actionId: string } | { kind: 'dash' }`
  - `class InputBuffer { constructor(windowMs: number); push(input: BufferedInput, nowMs: number): void; take(canExecute: (input: BufferedInput) => boolean, nowMs: number): BufferedInput | null; clear(): void }`

- [ ] **Step 1: Write the failing test**

```ts
// src/combat/inputBuffer.test.ts
import { describe, it, expect } from 'vitest';
import { InputBuffer } from './inputBuffer';

const ALWAYS = () => true;
const NEVER = () => false;

describe('InputBuffer', () => {
  it('returns null when empty', () => {
    expect(new InputBuffer(120).take(ALWAYS, 0)).toBeNull();
  });

  it('returns and clears the pending input when it is executable', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    expect(buf.take(ALWAYS, 150)).toEqual({ kind: 'dash' });
    expect(buf.take(ALWAYS, 150)).toBeNull();
  });

  it('keeps the pending input while it is not executable', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    expect(buf.take(NEVER, 150)).toBeNull();
    expect(buf.take(ALWAYS, 200)).toEqual({ kind: 'dash' });
  });

  it('a new input replaces the previous one', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    buf.push({ kind: 'attack', actionId: 'sword_shield.light' }, 110);
    expect(buf.take(ALWAYS, 120)).toEqual({ kind: 'attack', actionId: 'sword_shield.light' });
  });

  it('expires after the window: exactly the window is still valid, one ms more is dropped', () => {
    const a = new InputBuffer(120);
    a.push({ kind: 'dash' }, 100);
    expect(a.take(ALWAYS, 220)).toEqual({ kind: 'dash' });
    const b = new InputBuffer(120);
    b.push({ kind: 'dash' }, 100);
    expect(b.take(ALWAYS, 221)).toBeNull();
    expect(b.take(ALWAYS, 221)).toBeNull(); // dropped, not just skipped
  });

  it('clear() discards the pending input', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 0);
    buf.clear();
    expect(buf.take(ALWAYS, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/combat/inputBuffer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/combat/inputBuffer.ts
export type BufferedInput = { kind: 'attack'; actionId: string } | { kind: 'dash' };

/** Holds at most one pending input for `windowMs` of simulation time. */
export class InputBuffer {
  private pending: { input: BufferedInput; atMs: number } | null = null;

  constructor(private readonly windowMs: number) {}

  push(input: BufferedInput, nowMs: number): void {
    this.pending = { input, atMs: nowMs };
  }

  /** Returns and clears the pending input if it is executable now; drops it if expired. */
  take(canExecute: (input: BufferedInput) => boolean, nowMs: number): BufferedInput | null {
    if (!this.pending) return null;
    if (nowMs - this.pending.atMs > this.windowMs) {
      this.pending = null;
      return null;
    }
    if (!canExecute(this.pending.input)) return null;
    const { input } = this.pending;
    this.pending = null;
    return input;
  }

  clear(): void {
    this.pending = null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/combat/inputBuffer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit (author approves the message first)**

```bash
git add src/combat/inputBuffer.ts src/combat/inputBuffer.test.ts
git commit -m "feat: add a single-slot input buffer for combat inputs"
```

---

### Task 3: `PlayerController` — recuperação cancelável, dash, buffer, bloqueio

**Files:**
- Modify: `src/combat/playerController.ts`
- Modify: `src/core/events.ts` (payload + entry in `GameEvents`)
- Test: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: `lockedMs`, `INPUT_BUFFER_MS`, `BLOCK_MOVE_SPEED_FACTOR`, `InputBuffer`/`BufferedInput` from Tasks 1–2.
- Produces: `PlayerCancelPayload { by: 'move' | 'dash' | 'attack'; actionId: string }`; event `'player.cancel'`; `PlayerController.isInRecovery: boolean` (getter).

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/playerController.test.ts` (imports: `INPUT_BUFFER_MS` from `./actionDefs`, `BLOCK_MOVE_SPEED_FACTOR` from `./movementDefs`, `lockedMs`, `totalCommitmentMs` from `./actionRegistry`). Helper at top of the new block:

```ts
const LIGHT_LOCKED = lockedMs(LIGHT); // 200
const LIGHT_TOTAL = totalCommitmentMs(LIGHT); // 350

function collect(bus: EventBus<GameEvents>) {
  const log: Array<{ type: string; payload: unknown }> = [];
  bus.on('player.cancel', (p) => log.push({ type: 'player.cancel', payload: p }));
  bus.on('player.action', (p) => log.push({ type: 'player.action', payload: p }));
  bus.on('player.dodge', (p) => log.push({ type: 'player.dodge', payload: p }));
  return log;
}
```

Tests (each `it` in a new `describe('combat B: responsive combat', ...)`):

```ts
  it('is locked (no movement, no dash) during startup+active, recovery starts at lockedMs', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.setMoveInput(1, 0);
    player.step(LIGHT_LOCKED - 1);
    expect(player.isInRecovery).toBe(false);
    expect(player.position).toEqual({ x: 0, y: 0 });
    player.tryDodge();
    expect(player.state).toBe('acting');
    player.step(1);
    expect(player.isInRecovery).toBe(true);
  });

  it('without input the recovery ends by itself at totalCommitmentMs with no player.cancel', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_TOTAL);
    expect(player.state).toBe('idle');
    expect(log.filter((e) => e.type === 'player.cancel')).toHaveLength(0);
  });

  it('movement input cancels the recovery and moves in the same tick, emitting player.cancel{move}', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED); // enter recovery
    player.setMoveInput(1, 0);
    player.step(100);
    expect(player.state).toBe('idle');
    expect(player.position.x).toBeCloseTo((PLAYER_MOVE_SPEED * 100) / 1000);
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel']);
    expect(log[1].payload).toEqual({ by: 'move', actionId: LIGHT.id });
  });

  it('holding movement from before the attack does not move during the locked phase, only from recovery on', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    expect(player.position).toEqual({ x: 0, y: 0 });
    player.step(16);
    expect(player.state).toBe('idle');
    expect(player.position.x).toBeGreaterThan(0);
  });

  it('dash cancels the recovery: player.cancel{dash} comes before player.dodge', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    player.tryDodge();
    expect(player.state).toBe('dodging');
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.dodge']);
    expect(log[1].payload).toEqual({ by: 'dash', actionId: LIGHT.id });
  });

  it('a new attack cancels the recovery: player.cancel{attack} (previous action id) comes before the new player.action', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    player.tryAction(HEAVY.id);
    expect(player.currentActionDef?.id).toBe(HEAVY.id);
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.action']);
    expect(log[1].payload).toEqual({ by: 'attack', actionId: LIGHT.id });
    expect((log[2].payload as { actionId: string }).actionId).toBe(HEAVY.id);
  });

  it('a dash pressed during the locked phase is buffered and fires when the recovery starts', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs); // 100ms in, still locked
    player.tryDodge(); // buffered
    expect(player.state).toBe('acting');
    player.step(LIGHT.timing.activeMs); // recovery begins; age = 100ms <= INPUT_BUFFER_MS
    expect(player.state).toBe('dodging');
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.dodge']);
  });

  it('an attack pressed during the locked phase is buffered and fires when the recovery starts', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs);
    player.tryAction(HEAVY.id);
    player.step(LIGHT.timing.activeMs);
    expect(player.currentActionDef?.id).toBe(HEAVY.id);
  });

  it('a buffered input older than INPUT_BUFFER_MS is dropped', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.tryDodge(); // pressed at t=0 of a 200ms lock
    player.step(LIGHT_LOCKED); // age 200 > 120
    expect(player.state).toBe('acting'); // in recovery, dash was dropped
    expect(player.isInRecovery).toBe(true);
  });

  it('dash is buffered during stagger and fires when it ends', () => {
    const { player } = makePlayer();
    player.enterStagger();
    player.step(STAGGER_MS - 50);
    player.tryDodge();
    expect(player.state).toBe('staggered');
    player.step(50);
    expect(player.state).toBe('dodging');
  });

  it('dash direction follows the movement input; with no input it follows the aim', () => {
    const a = makePlayer().player;
    a.setAimDirection({ x: -1, y: 0 });
    a.setMoveInput(0, 1);
    a.tryDodge();
    a.step(DODGE.durationMs);
    expect(a.position.y).toBeGreaterThan(0);
    expect(a.position.x).toBeCloseTo(0);

    const b = makePlayer().player;
    b.setAimDirection({ x: 0, y: -1 });
    b.tryDodge();
    b.step(DODGE.durationMs);
    expect(b.position.y).toBeLessThan(0);
  });

  it('dash cancels a charge in progress without emitting player.action; releasing afterwards does nothing', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(CHARGED.id);
    player.step(400); // still charging
    player.tryDodge();
    expect(player.state).toBe('dodging');
    player.step(DODGE.durationMs);
    player.releaseAction();
    expect(log.map((e) => e.type)).toEqual(['player.dodge']);
  });

  it('dash exits blocking and works during the weapon-switch lock', () => {
    const a = makePlayer().player;
    a.startBlock();
    a.tryDodge();
    expect(a.state).toBe('dodging');

    const b = makePlayer().player;
    b.switchWeapon('bow');
    b.tryDodge();
    expect(b.state).toBe('dodging');
  });

  it('moves at half speed while blocking', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.state).toBe('blocking');
    expect(player.position.x).toBeCloseTo(PLAYER_MOVE_SPEED * BLOCK_MOVE_SPEED_FACTOR);
  });

  it('reset() clears a pending buffered input', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.tryDodge(); // buffered
    player.reset({ x: 0, y: 0 });
    player.step(500);
    expect(player.state).toBe('idle');
  });

  it('a buffered attack of the old weapon does not execute after a weapon switch', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.tryAction(HEAVY.id); // buffered
    player.reset({ x: 0, y: 0 });
    player.switchWeapon('bow');
    player.step(500);
    expect(player.currentActionDef).toBeNull();
  });
```

Also update existing tests that now contradict the new rules:
- `ignores moveInput while acting` → keep, but step only `lockedMs - 1` (500 ms now reaches the recovery, where input cancels); rename to `ignores moveInput during the locked phase`.
- `dash displaces the player in the last movement direction` / `dash still uses the last movement direction, not the aim direction` → replace by the direction test above (input now, not "last"); delete the "last movement" ones.
- `dash defaults to facing right ...` stays (aim defaults to +x).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `isInRecovery` and the cancel behavior do not exist.

- [ ] **Step 3: Implement**

`src/core/events.ts` — add:

```ts
export interface PlayerCancelPayload {
  /** What ended the recovery early. */
  by: 'move' | 'dash' | 'attack';
  /** The action whose recovery was cancelled. */
  actionId: string;
}
```

and in `GameEvents`: `'player.cancel': PlayerCancelPayload;` (after `'player.dodge'`).

`src/combat/playerController.ts`:

1. Imports: add `INPUT_BUFFER_MS` to the `./actionDefs` import, `lockedMs` to the `./actionRegistry` import, `BLOCK_MOVE_SPEED_FACTOR` to the `./movementDefs` import, and `import { InputBuffer, type BufferedInput } from './inputBuffer';`.
2. Fields: remove `lastMoveDirection`; add

```ts
  private clockMs = 0;
  private readonly inputBuffer = new InputBuffer(INPUT_BUFFER_MS);
```

3. `reset()`: add `this.clockMs = 0; this.inputBuffer.clear();`.
4. Getters:

```ts
  /** Past the non-cancelable part of an action: any input ends it. */
  get isInRecovery(): boolean {
    return (
      this.state === 'acting' &&
      this.currentAction !== null &&
      this.chargeTriggered &&
      this.phaseElapsedMs >= lockedMs(this.currentAction)
    );
  }

  private get isCharging(): boolean {
    return this.state === 'acting' && this.currentAction?.actionType === 'charged' && !this.chargeTriggered;
  }
```

5. Replace `tryAction` / `tryDodge`:

```ts
  tryAction(actionId: string): void {
    const action = resolveAction(actionId); // throws for unknown ids, before any state mutation
    if (action.weaponId !== this.equippedWeaponId) return;
    if (this.canStartAttack()) {
      this.startAction(action);
    } else if (this.isBufferable()) {
      this.inputBuffer.push({ kind: 'attack', actionId }, this.clockMs);
    }
  }

  tryDodge(): void {
    if (this.canDash()) {
      this.startDash();
    } else if (this.isBufferable()) {
      this.inputBuffer.push({ kind: 'dash' }, this.clockMs);
    }
  }

  private canStartAttack(): boolean {
    return this.isInRecovery || (this.state === 'idle' && this.attackLockedMs <= 0);
  }

  private canDash(): boolean {
    if (this.isCharging || this.isInRecovery || this.state === 'blocking') return true;
    return this.state === 'idle' && this.dodgeCooldownRemainingMs <= 0;
  }

  /** Inputs that cannot run now but will become runnable on their own (locked, stagger, dash, cooldowns). */
  private isBufferable(): boolean {
    return this.state !== 'blocking' && !this.isCharging;
  }

  private startAction(action: ActionDef): void {
    if (this.isInRecovery) {
      this.bus.emit('player.cancel', { by: 'attack', actionId: this.currentAction!.id });
    }
    this.state = 'acting';
    this.phaseElapsedMs = 0;
    this.currentAction = action;
    this.committedDirection = { x: this.aimDirection.x, y: this.aimDirection.y };
    this.chargeHeldMs = 0;
    this.chargeTriggered = action.actionType !== 'charged';
    if (action.actionType !== 'charged') {
      this.emitActionEvent(action);
    }
  }

  private startDash(): void {
    if (this.isInRecovery) {
      this.bus.emit('player.cancel', { by: 'dash', actionId: this.currentAction!.id });
    }
    if (this.state === 'acting') this.cancelAction(); // recovery, or a charge in progress (silent)
    this.blockHeldMs = 0;
    const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
    this.dashDirection = direction.x !== 0 || direction.y !== 0 ? direction : this.aimDirection;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.attackLockedMs = 0;
    this.bus.emit('player.dodge', {});
  }
```

   Edge: `startDash` while `state === 'blocking'` falls through to the shared tail (blockHeldMs reset, state set to dodging).
   Note `isInRecovery` must be evaluated BEFORE `cancelAction()` clears `currentAction` — the code above does.

6. `step()` — at the very top add the clock and recovery-by-move cancel; at the end of the function (every return path must reach it) run the buffer. Restructure by renaming the existing body to `private advance(stepMs)` and:

```ts
  step(stepMs: number): void {
    this.clockMs += stepMs;
    if (this.isInRecovery && (this.moveInput.x !== 0 || this.moveInput.y !== 0)) {
      this.bus.emit('player.cancel', { by: 'move', actionId: this.currentAction!.id });
      this.cancelAction();
    }
    this.advance(stepMs);
    const input = this.inputBuffer.take((i) => this.canExecute(i), this.clockMs);
    if (input?.kind === 'attack') this.startAction(resolveAction(input.actionId));
    else if (input?.kind === 'dash') this.startDash();
  }

  private canExecute(input: BufferedInput): boolean {
    if (input.kind === 'dash') return this.canDash();
    return resolveAction(input.actionId).weaponId === this.equippedWeaponId && this.canStartAttack();
  }
```

   In `advance` (old `step` body): in the `idle` branch remove `this.lastMoveDirection = direction;`; in the `blocking` branch apply movement before `blockHeldMs += stepMs`:

```ts
    if (this.state === 'blocking') {
      this.blockHeldMs += stepMs;
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        this._position = clampToArena(
          applyMovement(this._position, direction, PLAYER_MOVE_SPEED * BLOCK_MOVE_SPEED_FACTOR, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
      return;
    }
```

   `stepActing` stays as is (the `totalCommitmentMs` end-of-recovery path is unchanged).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS. If a test about `reset()` + `switchWeapon('bow')` fails because `tryAction(HEAVY.id)` for a different weapon is dropped upfront, that is correct behavior — adjust the test to buffer a same-weapon attack, switch weapon only after the buffer is consumed; the invariant under test is "the buffer never runs an action of a non-equipped weapon" (covered by `canExecute`).

- [ ] **Step 5: Full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green (fix other suites only where they assumed locks during recovery/old timings, never loosening assertions).

- [ ] **Step 6: Commit (author approves the message first)**

```bash
git add src/combat/playerController.ts src/core/events.ts src/combat/playerController.test.ts
git commit -m "feat: cancelable recovery, buffered inputs, responsive dash and moving while blocking"
```

---

### Task 4: Telemetria e versão do jogo

**Files:**
- Modify: `src/telemetry/telemetryRecorder.ts:10-13` (`CONTEXT_EVENTS`)
- Modify: `src/telemetry/schema.ts:10` (`GAME_VERSION`)
- Test: `src/telemetry/telemetryRecorder.test.ts`

**Interfaces:**
- Consumes: `'player.cancel'` from Task 3.

- [ ] **Step 1: Write the failing test**

In the `log order is causal order` describe of `telemetryRecorder.test.ts`:

```ts
    it('player.cancel is logged with ctx and precedes the player.dodge it causes', () => {
      const stack = makeStack();
      stack.director.start();
      const player = stack.encounter.player;
      player.tryAction('sword_shield.light');
      stack.step(16 * 13); // past lockedMs (200ms) and into the recovery
      expect(player.isInRecovery).toBe(true);
      player.tryDodge();
      const events = stack.recorder.drain();
      const cancel = idx(events, (e) => e.type === 'player.cancel');
      const dodge = idx(events, (e) => e.type === 'player.dodge');
      expect(cancel).toBeGreaterThanOrEqual(0);
      expect(dodge).toBeGreaterThan(cancel);
      expect(events[cancel].by).toBe('dash');
      expect(events[cancel].actionId).toBe('sword_shield.light');
      expect(events[cancel].ctx).toBeDefined();
    });
```

And a version check (same file or `schema` test if one exists):

```ts
  it('declares the combat B game version', () => {
    expect(GAME_VERSION).toBe('0.0.2+combatB');
  });
```

(import `GAME_VERSION` from `./schema`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/telemetry/telemetryRecorder.test.ts`
Expected: FAIL — no `player.cancel` event logged; version is `0.0.1+5a`.

- [ ] **Step 3: Implement**

`telemetryRecorder.ts` — add `'player.cancel'` to `CONTEXT_EVENTS` right after `'player.dodge'`:

```ts
  'player.action', 'player.dodge', 'player.cancel', 'player.defense', 'player.hit_unmitigated', 'player.hurt',
```

`schema.ts`: `export const GAME_VERSION = '0.0.2+combatB';`

- [ ] **Step 4: Run to verify it passes; then the full gate**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all green, including `replay.test.ts`. If a replay coverage guard fails (bot no longer covers runs/rooms with the new combat), adjust the bot cadence per the 5a spec — never loosen the equivalence assertion.

- [ ] **Step 5: Commit (author approves the message first)**

```bash
git add src/telemetry/telemetryRecorder.ts src/telemetry/schema.ts src/telemetry/telemetryRecorder.test.ts
git commit -m "feat: log player.cancel and bump the game version to 0.0.2+combatB"
```

---

### Task 5: Documento consolidado e verificação manual

**Files:**
- Modify: the consolidated reference doc referenced by memory (`reference_tcc_consolidated_doc.md` points to its path) — dim 6 definition, §13 parameters, data comparability note.

- [ ] **Step 1: Update the doc**

Register: (a) dim 6 old definition (total commitment, 12/09) → new (non-cancelable part, 30/09) and why; (b) the §13 parameter table from the spec §3; (c) note that logs with `game_version` before `0.0.2+combatB` are not comparable for dims 4–6 (same treatment as the 07/09 attack-fan change).

- [ ] **Step 2: Manual playtest in the browser**

Run `npm run dev`; check the done-criteria 1–7 of the spec §2.3 by feel: walk (220), block-walk (half), attack then move/dash/attack out of recovery, press dash during a swing and see it fire right after, dash with Q held. Report anything that feels off — constants are tuned in `actionDefs.ts` / `movementDefs.ts` without architecture changes.

- [ ] **Step 3: Update memory**

Mark sub-project B shipped in `project_combat_revision.md` and note the next step (C animations).

- [ ] **Step 4: Commit the doc (author approves the message first)**

```bash
git add docs/
git commit -m "docs: record the combat B parameters, dim 6 window change and data comparability"
```
