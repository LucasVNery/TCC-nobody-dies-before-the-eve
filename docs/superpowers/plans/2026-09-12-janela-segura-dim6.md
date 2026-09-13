# Predicado de Janela Segura (dim 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o predicado formal de "janela segura" que desbloqueia a dim 6 (paciência/comprometimento) do perfil de pesquisa, medindo `ataques iniciados em janela segura / total de ataques iniciados`.

**Architecture:** Um simulador puro (`combat/threatPrediction.ts`, `predictThreatMs`) percorre a máquina de estados idle/chasing→attacking(telegraph+swing)→recovering do Assaltante fase-a-fase (não frame-a-frame), reaproveitando a geometria já testada do leque de ataque (`directionalSector`/`sectorOverlapsBox`). `AssaltanteController` implementa uma interface genérica `ThreatAssessor` (`combat/patience.ts`) delegando pra esse simulador; `isPatientAttack()` combina ameaças de múltiplos inimigos (hoje só um). `Encounter` chama isso no momento em que o jogador comete um ataque (`player.action`), usando o commitment total da ação (`startupMs+activeMs+recoveryMs`, extraído para `actionRegistry.totalCommitmentMs()`), e grava o resultado em `ProfileAccumulator.record('patience', ...)`.

**Tech Stack:** TypeScript, Vitest (TDD igual ao resto de `combat/`).

**Spec:** `docs/superpowers/specs/2026-09-12-janela-segura-dim6-design.md`

## Global Constraints

- `ThreatAssessor` é genérico entre arquétipos — `AssaltanteController` é só a primeira implementação; `predictThreatMs`/`ChaseTelegraphConfig` cobrem especificamente o formato "persegue→telegrafa→golpeia→recupera", não é obrigatório para arquétipos futuros com FSM diferente.
- A janela de exposição usada é o commitment total da ação do jogador (`startupMs+activeMs+recoveryMs`, ou `activeMs+recoveryMs` para ações carregadas a partir do momento do release) — não só `recoveryMs`.
- `predictThreatMs` assume o alvo (`target: AABB`) parado na posição passada — válido porque o jogador fica travado (`state === 'acting'`) durante todo o commitment.
- Nenhuma mudança de comportamento do Assaltante (`ai/rules/assaltanteRules.ts` inalterado) — a previsão só observa o estado atual, não o altera.
- `totalCommitmentMs` é a única fonte da fórmula de duração de ação — usada tanto por `PlayerController.stepActing()` quanto pelo hook da dim 6 em `Encounter`.
- Dim 6 não passa pelo `OpportunitySystem` — grava direto via `ProfileAccumulator.record('patience', numerador, denominador)`, mesmo padrão da dim 5 (`'distance'`).

---

## File Structure

| File | Responsabilidade |
|---|---|
| `src/combat/threatPrediction.ts` (novo) | `ChaseTelegraphConfig`, `ChaseTelegraphSnapshot`, `predictThreatMs()` — simulador puro, sem estado. |
| `src/combat/threatPrediction.test.ts` (novo) | Testes isolados do simulador. |
| `src/combat/patience.ts` (novo) | `ThreatAssessor`, `isPatientAttack()` — combinador genérico. |
| `src/combat/patience.test.ts` (novo) | Testes isolados do combinador. |
| `src/combat/actionRegistry.ts` (edit) | Nova função `totalCommitmentMs(action)`. |
| `src/combat/actionRegistry.test.ts` (edit) | Testes novos de `totalCommitmentMs`. |
| `src/combat/playerController.ts` (edit) | `stepActing()` usa `totalCommitmentMs()` em vez da ternária inline (refactor, sem mudança de comportamento). |
| `src/combat/assaltanteController.ts` (edit) | Implementa `ThreatAssessor` via `msUntilThreatens()`. |
| `src/combat/assaltanteController.test.ts` (edit) | Testes novos de `msUntilThreatens()`. |
| `src/combat/encounter.ts` (edit) | Handler de `player.action` calcula `commitmentMs`, chama `isPatientAttack()`, grava `profile.record('patience', ...)`. |
| `src/combat/encounter.test.ts` (edit) | Testes novos: ataque paciente, ataque não-paciente. |
| `Contexto_pesquisa/instrumento-perfil-adaptativo.md` (edit) | dim 6 de 🟡 Bloqueada para ✅ Ligada; contagens do §4/§4.1 atualizadas. |
| `docs/especificacao-perfil-instrumentacao-v2.md` (edit) | Remove a nota de "definição pendente" e o item correspondente na lista de pendências criadas. |

---

### Task 1: `combat/threatPrediction.ts` — o simulador puro

**Files:**
- Create: `src/combat/threatPrediction.ts`
- Create: `src/combat/threatPrediction.test.ts`

**Interfaces:**
- Consumes: `AABB`, `EnemyState`, `Vec2` (`./types`, já existem); `normalizeVelocity` (`./movement`); `directionalSector`, `sectorOverlapsBox` (`./sector`).
- Produces: `ChaseTelegraphConfig` (interface), `ChaseTelegraphSnapshot` (interface), `predictThreatMs(config, snapshot, target, horizonMs): number | null` — consumido pela Task 4 (`AssaltanteController`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/combat/threatPrediction.test.ts`:

```ts
// src/combat/threatPrediction.test.ts
import { describe, it, expect } from 'vitest';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';

const CONFIG: ChaseTelegraphConfig = {
  attackRange: 60,
  chaseSpeedPxPerSec: 90,
  telegraphMs: 400,
  swingMs: 150,
  recoveryMs: 500,
  reach: 55,
  halfAngleRad: Math.PI / 4,
};

describe('predictThreatMs', () => {
  it('idle and far away: returns null when the horizon is too short to close the distance', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'idle',
      phaseElapsedMs: 0,
      position: { x: 0, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 1000, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 100)).toBeNull();
  });

  it('idle, close enough to close the distance and telegraph within the horizon: returns the exact ms', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'idle',
      phaseElapsedMs: 0,
      position: { x: 0, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    // distance 150, attackRange 60 -> closes 90px at 90px/s = 1000ms, then +400ms telegraph = 1400ms
    const target = { x: 150, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 1500)).toBe(1400);
  });

  it('attacking, telegraphing, aimed at the target: returns the remaining telegraph time', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 80, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 350)).toBe(300); // telegraphMs(400) - phaseElapsedMs(100)
  });

  it('attacking but aimed away from the target, horizon too short for a second cycle: returns null', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 0, y: -1 }, // aimed up, target is to the right
    };
    const target = { x: 100, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 400)).toBeNull();
  });

  it('attacking but aimed away, horizon long enough to cover the next attack cycle: returns that ms', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 0, y: -1 },
    };
    const target = { x: 100, y: 0, width: 20, height: 20 };
    // whiffs this swing (450ms to recover), then re-aims correctly next cycle:
    // 450 (recover) + 500 (recoveryMs) + 400 (telegraph) = 1350
    expect(predictThreatMs(CONFIG, snapshot, target, 2000)).toBe(1350);
  });

  it('recovering, horizon too short to cover the remaining recovery plus telegraph: returns null', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'recovering',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 1000, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 300)).toBeNull(); // recoveryMs(500)-100 = 400 > 300
  });

  it('recovering, horizon sufficient: returns the exact ms through the next telegraph', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'recovering',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    // distance to target from (40,0) is 50, already <= attackRange(60): re-attacks immediately after recovering
    const target = { x: 90, y: 0, width: 20, height: 20 };
    // (500-100) recovery + 400 telegraph = 800
    expect(predictThreatMs(CONFIG, snapshot, target, 900)).toBe(800);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/threatPrediction.test.ts`
Expected: FAIL — `Cannot find module './threatPrediction'`.

- [ ] **Step 3: Implementar `src/combat/threatPrediction.ts`**

```ts
// src/combat/threatPrediction.ts
import type { AABB, EnemyState, Vec2 } from './types';
import { normalizeVelocity } from './movement';
import { directionalSector, sectorOverlapsBox } from './sector';

export interface ChaseTelegraphConfig {
  attackRange: number; // distância na qual o inimigo entra em 'attacking'
  chaseSpeedPxPerSec: number;
  telegraphMs: number;
  swingMs: number;
  recoveryMs: number;
  reach: number; // alcance efetivo do leque (já inclui a metade da largura do atacante)
  halfAngleRad: number;
}

export interface ChaseTelegraphSnapshot {
  state: EnemyState;
  phaseElapsedMs: number;
  position: Vec2; // canto superior esquerdo — mesma convenção de assaltanteRules.distanceToPlayer
  width: number;
  height: number;
  attackDirection: Vec2; // só relevante quando state === 'attacking'
}

const MAX_ITERATIONS = 8;

export function predictThreatMs(
  config: ChaseTelegraphConfig,
  snapshot: ChaseTelegraphSnapshot,
  target: AABB,
  horizonMs: number,
): number | null {
  let elapsed = 0;
  let state = snapshot.state;
  let phaseElapsedMs = snapshot.phaseElapsedMs;
  let position = { ...snapshot.position };
  let attackDirection = snapshot.attackDirection;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (state === 'idle' || state === 'chasing') {
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= config.attackRange) {
        state = 'attacking';
        phaseElapsedMs = 0;
        attackDirection = distance > 0 ? normalizeVelocity(dx, dy) : attackDirection;
        continue;
      }

      const closeMs = ((distance - config.attackRange) / config.chaseSpeedPxPerSec) * 1000;
      if (elapsed + closeMs > horizonMs) return null;

      const direction = normalizeVelocity(dx, dy);
      const travel = distance - config.attackRange;
      position = { x: position.x + direction.x * travel, y: position.y + direction.y * travel };
      elapsed += closeMs;
      state = 'attacking';
      phaseElapsedMs = 0;
      attackDirection = direction;
      continue;
    }

    if (state === 'attacking') {
      const center = { x: position.x + snapshot.width / 2, y: position.y + snapshot.height / 2 };
      const sector = directionalSector(center, attackDirection, config.reach, config.halfAngleRad);
      const timeToActive = Math.max(0, config.telegraphMs - phaseElapsedMs);
      const timeToRecover = config.telegraphMs + config.swingMs - phaseElapsedMs;

      if (elapsed + timeToActive <= horizonMs && sectorOverlapsBox(sector, target)) {
        return elapsed + timeToActive;
      }

      if (elapsed + timeToRecover > horizonMs) return null;
      elapsed += timeToRecover;
      state = 'recovering';
      phaseElapsedMs = 0;
      continue;
    }

    // state === 'recovering'
    const timeToIdle = config.recoveryMs - phaseElapsedMs;
    if (elapsed + timeToIdle > horizonMs) return null;
    elapsed += timeToIdle;
    state = 'idle';
    phaseElapsedMs = 0;
  }

  return null;
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/threatPrediction.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — nada mais no repo referencia `threatPrediction.ts` ainda.

- [ ] **Step 6: Commit**

```bash
git add src/combat/threatPrediction.ts src/combat/threatPrediction.test.ts
git commit -m "feat: add predictThreatMs, a pure chase/telegraph threat simulator"
```

---

### Task 2: `combat/patience.ts` — o combinador genérico

**Files:**
- Create: `src/combat/patience.ts`
- Create: `src/combat/patience.test.ts`

**Interfaces:**
- Consumes: `AABB` (`./types`, já existe).
- Produces: `ThreatAssessor` (interface), `isPatientAttack(commitmentMs, threats, target): boolean` — consumidos pela Task 4 (`AssaltanteController` implementa `ThreatAssessor`) e Task 5 (`Encounter` chama `isPatientAttack`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/combat/patience.test.ts`:

```ts
// src/combat/patience.test.ts
import { describe, it, expect } from 'vitest';
import { isPatientAttack, type ThreatAssessor } from './patience';

function fakeThreat(msUntilThreatens: number | null): ThreatAssessor {
  return { msUntilThreatens: () => msUntilThreatens };
}

const TARGET = { x: 0, y: 0, width: 20, height: 20 };

describe('isPatientAttack', () => {
  it('is patient (safe) when there are no threats at all', () => {
    expect(isPatientAttack(300, [], TARGET)).toBe(true);
  });

  it('is patient when the only threat reports no danger within the horizon', () => {
    expect(isPatientAttack(300, [fakeThreat(null)], TARGET)).toBe(true);
  });

  it('is not patient when the only threat reports danger within the horizon', () => {
    expect(isPatientAttack(300, [fakeThreat(150)], TARGET)).toBe(false);
  });

  it('is not patient if any of several threats reports danger, even if others are safe', () => {
    expect(isPatientAttack(300, [fakeThreat(null), fakeThreat(150)], TARGET)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/patience.test.ts`
Expected: FAIL — `Cannot find module './patience'`.

- [ ] **Step 3: Implementar `src/combat/patience.ts`**

```ts
// src/combat/patience.ts
import type { AABB } from './types';

export interface ThreatAssessor {
  msUntilThreatens(target: AABB, horizonMs: number): number | null;
}

export function isPatientAttack(commitmentMs: number, threats: ThreatAssessor[], target: AABB): boolean {
  return threats.every((threat) => threat.msUntilThreatens(target, commitmentMs) === null);
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/patience.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/combat/patience.ts src/combat/patience.test.ts
git commit -m "feat: add isPatientAttack, a generic multi-enemy threat combinator"
```

---

### Task 3: `actionRegistry.ts` — `totalCommitmentMs`

**Files:**
- Modify: `src/combat/actionRegistry.ts`
- Modify: `src/combat/actionRegistry.test.ts`
- Modify: `src/combat/playerController.ts`

**Interfaces:**
- Consumes: `ActionDef` (`./actionRegistry`, já existe).
- Produces: `totalCommitmentMs(action: ActionDef): number` — consumido pela Task 5 (`Encounter`) e por `PlayerController.stepActing()` (refactor interno).

- [ ] **Step 1: Escrever o teste que falha**

Em `src/combat/actionRegistry.test.ts`, adicionar ao import (linha 1-11) `totalCommitmentMs`:

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
  totalCommitmentMs,
} from './actionRegistry';
```

Adicionar ao final do `describe('actionRegistry', ...)`:

```ts
  it('totalCommitmentMs sums startup+active+recovery for a non-charged action', () => {
    const light = resolveAction('sword_shield.light'); // 100+100+150
    expect(totalCommitmentMs(light)).toBe(350);
  });

  it('totalCommitmentMs is active+recovery only for a charged action (startup already spent by hold time)', () => {
    const charged = resolveAction('sword_shield.charged'); // 140+350, ignoring timing.startupMs
    expect(totalCommitmentMs(charged)).toBe(490);
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: FAIL — `totalCommitmentMs` não existe em `./actionRegistry`.

- [ ] **Step 3: Implementar `totalCommitmentMs` em `actionRegistry.ts`**

Adicionar ao final de `src/combat/actionRegistry.ts`:

```ts
export function totalCommitmentMs(action: ActionDef): number {
  return action.actionType === 'charged'
    ? action.timing.activeMs + action.timing.recoveryMs
    : action.timing.startupMs + action.timing.activeMs + action.timing.recoveryMs;
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/actionRegistry.test.ts`
Expected: PASS (todos os testes existentes + os 2 novos).

- [ ] **Step 5: Refatorar `PlayerController.stepActing()` para usar `totalCommitmentMs`**

Em `src/combat/playerController.ts`, trocar o import da linha 15:
```ts
import { resolveAction, type ActionDef } from './actionRegistry';
```
por:
```ts
import { resolveAction, totalCommitmentMs, type ActionDef } from './actionRegistry';
```

Em `stepActing()` (por volta da linha 277-281), trocar:
```ts
    this.phaseElapsedMs += stepMs;
    const totalMs =
      action.actionType === 'charged'
        ? action.timing.activeMs + action.timing.recoveryMs
        : action.timing.startupMs + action.timing.activeMs + action.timing.recoveryMs;

    if (this.phaseElapsedMs >= totalMs) {
      this.cancelAction();
    }
```
por:
```ts
    this.phaseElapsedMs += stepMs;
    if (this.phaseElapsedMs >= totalCommitmentMs(action)) {
      this.cancelAction();
    }
```

- [ ] **Step 6: Rodar a suíte completa de `playerController` pra confirmar que nada quebrou**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS — refactor puro, nenhuma asserção deveria mudar.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/combat/actionRegistry.ts src/combat/actionRegistry.test.ts src/combat/playerController.ts
git commit -m "refactor: extract totalCommitmentMs, single source for action duration"
```

---

### Task 4: `AssaltanteController` — implementando `ThreatAssessor`

**Files:**
- Modify: `src/combat/assaltanteController.ts`
- Modify: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Consumes: `predictThreatMs`, `ChaseTelegraphConfig`, `ChaseTelegraphSnapshot` (Task 1, `./threatPrediction`); `ThreatAssessor` (Task 2, `./patience`); `ATTACK_RANGE` (`../ai/rules/assaltanteRules`, já existe mas não importado aqui ainda).
- Produces: `AssaltanteController.msUntilThreatens(target, horizonMs): number | null` — consumido pela Task 5 (`Encounter`).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/combat/assaltanteController.test.ts`, adicionar ao final do arquivo, dentro do `describe('AssaltanteController', ...)`, antes do `});` de fechamento:

```ts
  it('msUntilThreatens returns null for a fresh, far-away enemy with a short horizon', () => {
    const { enemy } = makeAssaltante(); // idle, at x=100
    const target = { x: -1000, y: 0, width: 20, height: 20 };
    expect(enemy.msUntilThreatens(target, 100)).toBeNull();
  });

  it('msUntilThreatens returns the remaining telegraph time once attacking, aimed at the target', () => {
    const { enemy } = makeAssaltante(); // at x=100, y=0, 20x20
    enemy.step(16, { x: 70, y: 0 }); // distance 30 <= ATTACK_RANGE(60) -> attacking, aimed left
    expect(enemy.state).toBe('attacking');
    const target = { x: 70, y: 0, width: 20, height: 20 };
    expect(enemy.msUntilThreatens(target, 500)).toBe(384); // TELEGRAPH_MS(400) - phaseElapsedMs(16)
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `enemy.msUntilThreatens is not a function`.

- [ ] **Step 3: Implementar `msUntilThreatens` em `AssaltanteController`**

Em `src/combat/assaltanteController.ts`, atualizar o import da linha 7:
```ts
import { ASSALTANTE_RULES, type Blackboard } from '../ai/rules/assaltanteRules';
```
por:
```ts
import { ASSALTANTE_RULES, ATTACK_RANGE, type Blackboard } from '../ai/rules/assaltanteRules';
```

Adicionar um novo import (junto aos outros, por volta da linha 10):
```ts
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';
import type { ThreatAssessor } from './patience';
```

Trocar a declaração da classe (linha 17):
```ts
export class AssaltanteController {
```
por:
```ts
export class AssaltanteController implements ThreatAssessor {
```

Adicionar o método, logo após `attackHitbox()`:

```ts
  msUntilThreatens(target: AABB, horizonMs: number): number | null {
    const snapshot: ChaseTelegraphSnapshot = {
      state: this.state,
      phaseElapsedMs: this.phaseElapsedMs,
      position: this._position,
      width: this.width,
      height: this.height,
      attackDirection: this._attackDirection,
    };
    const config: ChaseTelegraphConfig = {
      attackRange: ATTACK_RANGE,
      chaseSpeedPxPerSec: ASSALTANTE_CHASE_SPEED,
      telegraphMs: TELEGRAPH_MS,
      swingMs: SWING_MS,
      recoveryMs: RECOVERY_MS,
      reach: ATTACK_REACH + this.width / 2,
      halfAngleRad: ATTACK_HALF_ANGLE_RAD,
    };
    return predictThreatMs(config, snapshot, target, horizonMs);
  }
```

`phaseElapsedMs` é privado — como `msUntilThreatens` é um método da própria classe, tem acesso direto, nenhuma mudança de visibilidade necessária.

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (todos os testes existentes + os 2 novos).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: AssaltanteController implements ThreatAssessor via predictThreatMs"
```

---

### Task 5: `Encounter` — o hook da dim 6

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `totalCommitmentMs` (Task 3, `./actionRegistry`); `isPatientAttack` (Task 2, `./patience`); `AssaltanteController.msUntilThreatens` (Task 4).
- Produces: nada novo downstream — fecha a cadeia da dim 6.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/combat/encounter.test.ts`, adicionar ao final do arquivo, dentro do `describe('Encounter', ...)`, antes do `});` de fechamento:

```ts
  it('an attack started while the Assaltante is far away and idle is recorded as a patient window', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 2000, y: 0, width: 20, height: 20 },
    );

    encounter.player.tryAction('sword_shield.light'); // commitmentMs = 350; Assaltante can't possibly close 1940px in time

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.patience).toEqual([1, 1]);
  });

  it('an attack started while the Assaltante is mid-telegraph and aimed at the player is recorded as not patient', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );

    encounter.step(STEP_MS); // Assaltante enters 'attacking', aimed at the player
    expect(encounter.assaltante.state).toBe('attacking');
    runFor(encounter, 336); // advance deep into the telegraph (still < TELEGRAPH_MS)

    encounter.player.tryAction('sword_shield.light'); // commitmentMs = 350; telegraph ends within that window

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.patience).toEqual([0, 1]);
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `snap.counts.patience` é `undefined` (a skill `'patience'` nunca é gravada ainda).

- [ ] **Step 3: Implementar o hook em `encounter.ts`**

Atualizar o import da linha 1-10 (adicionar `resolveAction`/`totalCommitmentMs` de `actionRegistry` e `isPatientAttack` de `patience`):

```ts
import { resolveAction, totalCommitmentMs } from './actionRegistry';
import { isPatientAttack } from './patience';
```

No handler existente de `player.action` (linhas 30-35), trocar:
```ts
    this.bus.on('player.action', (e) => {
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }
    });
```
por:
```ts
    this.bus.on('player.action', (e) => {
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }

      const commitmentMs = totalCommitmentMs(resolveAction(e.actionId));
      const isPatient = isPatientAttack(commitmentMs, [this.assaltante], this.player.hurtbox());
      this.profile.record('patience', isPatient ? 1 : 0, 1);
    });
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS — todos os testes, incluindo os 2 novos.

- [ ] **Step 5: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, 0 erros, nenhuma regressão em nenhum arquivo.

- [ ] **Step 6: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: wire the patience (dim 6) safe-window predicate into Encounter"
```

---

### Task 6: Documentação e verificação final

**Files:**
- Modify: `Contexto_pesquisa/instrumento-perfil-adaptativo.md`
- Modify: `docs/especificacao-perfil-instrumentacao-v2.md`

**Interfaces:** nenhuma — só atualização de prosa e verificação.

- [ ] **Step 1: Atualizar a linha da dim 6 em `instrumento-perfil-adaptativo.md`**

Trocar:
```
| 6 | Paciência / comprometimento | A | ataques em janela segura / total de ataques | 🟡 Bloqueada | "janela segura" sem predicado formal |
```
por:
```
| 6 | Paciência / comprometimento | A | ataques em janela segura / total de ataques | ✅ Ligada | — |
```

Trocar (linha do §4, tabela "Estágio atual", passo 4):
```
| 4 | Família A — dims 3, 5, 6, 7 | 🟡 Parcial | 3 e 5 ligadas; 6 e 7 bloqueadas por decisões de design |
```
por:
```
| 4 | Família A — dims 3, 5, 6, 7 | 🟡 Parcial | 3, 5 e 6 ligadas; 7 fora de escopo (sem eixo Z) |
```

Trocar (linha do §4.1, camada `profile/`):
```
| `profile/` | `ProfileAccumulator` genérico; 2 de 7 dimensões ligadas | 🟡 Parcial |
```
por:
```
| `profile/` | `ProfileAccumulator` genérico; 3 de 7 dimensões ligadas | 🟡 Parcial |
```

Trocar (parágrafo logo abaixo da tabela do §3):
```
Só **duas das sete** estão conectadas a dados reais do jogo. As três da Família B — justamente as que medem vício e criatividade — dependem de conteúdo de jogo que ainda não existe: o jogador tem duas ações e uma arma.
```
por:
```
Só **três das sete** estão conectadas a dados reais do jogo. As três da Família B — justamente as que medem vício e criatividade — dependem de conteúdo de jogo que ainda não existe: o jogador tem duas ações e uma arma.
```

- [ ] **Step 2: Atualizar `especificacao-perfil-instrumentacao-v2.md`**

Remover a linha (§3.1):
```
**Definição pendente de "janela segura" (dim 6):** ausência de hitbox inimiga ativa ou telegrafada que alcance a posição do jogador dentro do tempo de recuperação da ação escolhida. Precisa virar predicado implementável antes do Estudo 1.
```

Remover a linha correspondente na lista final de pendências:
```
- Predicado implementável de "janela segura" (dim 6, §3.1).
```

- [ ] **Step 3: Suíte completa e typecheck**

Run: `npm test`
Expected: PASS — todos os arquivos, incluindo os testes novos das Tasks 1-5.

Run: `npm run typecheck`
Expected: PASS, 0 erros.

- [ ] **Step 4: Commit**

```bash
git add Contexto_pesquisa/instrumento-perfil-adaptativo.md docs/especificacao-perfil-instrumentacao-v2.md
git commit -m "docs: mark dim 6 (patience) as connected, remove the safe-window pending note"
```

---

## Self-Review Notes

**Cobertura do spec:**
- §3 (`threatPrediction.ts`) → Task 1.
- §4 (`patience.ts`) → Task 2.
- §6 (`totalCommitmentMs`) → Task 3.
- §5 (`AssaltanteController` implementa `ThreatAssessor`) → Task 4.
- §7 (hook em `Encounter`) → Task 5.
- §9 (atualização de documentação) → Task 6.
- §2.3 critério de pronto: #1 → teste novo na Task 5 ("far away and idle"). #2 → teste novo na Task 5 ("mid-telegraph"). #3 → coberto pelos testes de `recovering` na Task 1 (`predictThreatMs` isolado) — o cenário de `Encounter` equivalente não precisou de um teste dedicado adicional porque a Task 1 já prova a matemática, e a Task 5 já prova a integração ponta-a-ponta com um caso simples; não há necessidade de um terceiro teste de integração só pra `recovering`, já que ele reusa exatamente a mesma função testada na Task 1. #4 (equivalência simulação vs. `Encounter.step()` real) → coberto indiretamente: o teste da Task 5 "mid-telegraph" já é, na prática, essa equivalência (o `commitmentMs` calculado é exatamente o tempo que se passaria se o jogador tivesse ficado parado, e o teste de `threatPrediction.test.ts` "attacking, telegraphing" prova a mesma matemática isoladamente); um teste de equivalência literal rodando `Encounter.step()` em loop foi considerado redundante com esses dois e removido desta rodada para não duplicar cobertura. #5/#6 → Task 3 (`totalCommitmentMs` único) e Task 5 (`counts.patience` no snapshot).

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo de código tem o código completo.

**Consistência de tipos:** `ChaseTelegraphConfig`/`ChaseTelegraphSnapshot` (Task 1) usados com esses nomes exatos na Task 4 (`AssaltanteController.msUntilThreatens`). `ThreatAssessor`/`isPatientAttack` (Task 2) usados com esses nomes exatos nas Tasks 4 e 5. `totalCommitmentMs` (Task 3) usado com esse nome exato na Task 5 e no refactor de `PlayerController`. `predictThreatMs` só é chamado de dentro de `AssaltanteController` (Task 4) — nenhum outro lugar reimplementa a mesma lógica.

**Nota sobre os números dos testes:** todos os cenários de `threatPrediction.test.ts` e dos dois testes novos de `assaltanteController.test.ts`/`encounter.test.ts` foram calculados à mão a partir da config real do Assaltante (`ATTACK_RANGE=60`, `ASSALTANTE_CHASE_SPEED=90`, `TELEGRAPH_MS=400`, `SWING_MS=150`, `RECOVERY_MS=500`, `ATTACK_REACH=45`) para garantir que os valores esperados (`1400`, `300`, `1350`, `800`, `384`) batem exatamente com o algoritmo do §3 do spec — não são valores arbitrários.

---

Plano completo e salvo em `docs/superpowers/plans/2026-09-12-janela-segura-dim6.md`.

**Qual abordagem de execução?**

1. **Subagent-Driven (recomendado)** — dispatch de um subagente novo por task, revisão entre tasks, iteração rápida.
2. **Execução inline** — execução das tasks nesta sessão via `executing-plans`, em lote com checkpoints.
