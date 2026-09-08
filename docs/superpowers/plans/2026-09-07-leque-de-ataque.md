# Leque de Ataque em Ângulo Livre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o hitbox de ataque alinhado a eixo (4 fatias de 90°) por um leque/setor centrado na mira em ângulo livre, corrigindo tiros/golpes diagonais que erram o alvo e falsos positivos de `'retreat'` na dim 4 do perfil de pesquisa.

**Architecture:** Novo primitivo geométrico puro (`combat/sector.ts`: `AttackSector`, `directionalSector`, `sectorOverlapsBox`) substitui `directionalHitbox`/`aabbOverlap` nos dois pontos de ataque (`PlayerController.attackHitbox()`, `AssaltanteController.attackHitbox()`) e na resolução de colisão em `Encounter.step()`. O overlay de debug em `ArenaScene` ganha uma projeção em leque (polígono amostrado ao longo do arco, reaproveitando `toScreen`) para visualizar o novo formato.

**Tech Stack:** TypeScript, Vitest (TDD igual ao resto de `combat/`), Phaser 3 só para o desenho do leque no overlay de debug.

**Spec:** `docs/superpowers/specs/2026-09-07-leque-de-ataque-design.md`

## Global Constraints

- Um único ângulo de leque para todas as armas nesta rodada (`ATTACK_HALF_ANGLE_RAD = Math.PI / 4`, 45° pra cada lado — 90° total) — sem diferenciação por arma.
- Origem do leque é o **centro** do atacante; alcance efetivo = `reach + largura/2` do atacante, para não encolher o alcance sentido hoje nos casos cardeais.
- `directionalHitbox` (`movement.ts`) **não é removida** — fica sem uso pelos ataques, sem limpeza nesta rodada.
- Sem mudança em `visual/` além do overlay de debug dentro de `ArenaScene` (que já mistura lógica/visual de propósito, único lugar que enxerga os dois lados).
- Testes que hoje comparam a *forma* do hitbox (x/y/width/height) devem virar testes de *comportamento* (`sectorOverlapsBox`), sem perda de cobertura.

---

## File Structure

| File | Responsabilidade |
|---|---|
| `src/combat/sector.ts` (novo) | `AttackSector`, `directionalSector()`, `sectorOverlapsBox()` — geometria pura, sem estado. |
| `src/combat/sector.test.ts` (novo) | Testes isolados da geometria do leque. |
| `src/combat/movementDefs.ts` (edit) | Nova constante `ATTACK_HALF_ANGLE_RAD`. |
| `src/combat/playerController.ts` (edit) | `attackHitbox()` muda de `AABB \| null` para `AttackSector \| null`. |
| `src/combat/playerController.test.ts` (edit) | Testes de forma → comportamento; 1 teste novo de alcance diagonal. |
| `src/combat/assaltanteController.ts` (edit) | Mesma troca de `attackHitbox()`. |
| `src/combat/assaltanteController.test.ts` (edit) | Testes de forma → comportamento; 1 teste novo de alcance diagonal (a prova determinística da correção). |
| `src/combat/encounter.ts` (edit) | `aabbOverlap` → `sectorOverlapsBox` nas duas checagens de colisão de ataque. |
| `src/combat/encounter.test.ts` (edit) | `aabbOverlap` → `sectorOverlapsBox` no teste de invariante existente; 1 teste novo (o mais importante): jogador parado numa diagonal não é mais lido como `'retreat'`. |
| `src/scenes/ArenaScene.ts` (edit) | `drawDebugHitboxes()` desenha o leque como polígono projetado em vez de retângulo. |

---

### Task 1: `combat/sector.ts` — o primitivo geométrico do leque

**Files:**
- Create: `src/combat/sector.ts`
- Create: `src/combat/sector.test.ts`
- Modify: `src/combat/movementDefs.ts`

**Interfaces:**
- Consumes: `Vec2`, `AABB` (`./types`, já existem).
- Produces: `AttackSector` (interface), `directionalSector(origin: Vec2, direction: Vec2, reach: number, halfAngleRad: number): AttackSector`, `sectorOverlapsBox(sector: AttackSector, box: AABB): boolean`, `ATTACK_HALF_ANGLE_RAD` (constante em `movementDefs.ts`) — consumidos pelas Tasks 2, 3 e 4.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/combat/sector.test.ts`:

```ts
// src/combat/sector.test.ts
import { describe, it, expect } from 'vitest';
import { directionalSector, sectorOverlapsBox } from './sector';

describe('sectorOverlapsBox', () => {
  it('accepts a box centered directly ahead, within reach and angle', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 40, y: -5, width: 10, height: 10 })).toBe(true);
  });

  it('rejects a box beyond reach, even directly ahead', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 100, y: -5, width: 10, height: 10 })).toBe(false);
  });

  it('rejects a box within reach but outside the half-angle (90° off, straight up)', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // facing east, 45° half-angle
    expect(sectorOverlapsBox(sector, { x: -5, y: -40, width: 10, height: 10 })).toBe(false);
  });

  it('accepts a point just inside the half-angle boundary', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // 45° half-angle
    const angle = (40 * Math.PI) / 180; // 40°, inside the 45° cone
    const distance = 40;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    expect(sectorOverlapsBox(sector, { x: px - 1, y: py - 1, width: 2, height: 2 })).toBe(true);
  });

  it('rejects a point just outside the half-angle boundary', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 4); // 45° half-angle
    const angle = (50 * Math.PI) / 180; // 50°, outside the 45° cone
    const distance = 40;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    expect(sectorOverlapsBox(sector, { x: px - 1, y: py - 1, width: 2, height: 2 })).toBe(false);
  });

  it('accepts a box whose center is outside the sector but a corner falls inside it', () => {
    const sector = directionalSector({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, Math.PI / 8); // narrow 22.5° half-angle
    // center at (30,-14) is ~25° off-axis (outside); corners (20,2) and (40,2) are ~3-6° off-axis (inside)
    expect(sectorOverlapsBox(sector, { x: 20, y: -30, width: 20, height: 32 })).toBe(true);
  });

  it('a diagonal direction correctly reaches a diagonally-positioned box (the bug this fixes)', () => {
    const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 }; // southeast, 45°
    const sector = directionalSector({ x: 0, y: 0 }, dir, 50, Math.PI / 4);
    expect(sectorOverlapsBox(sector, { x: 25, y: 25, width: 10, height: 10 })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/sector.test.ts`
Expected: FAIL — `Cannot find module './sector'`.

- [ ] **Step 3: Implementar `src/combat/sector.ts`**

```ts
// src/combat/sector.ts
import type { AABB, Vec2 } from './types';

export interface AttackSector {
  origin: Vec2;
  direction: Vec2; // deve chegar normalizado
  reach: number;
  halfAngleRad: number;
}

export function directionalSector(
  origin: Vec2,
  direction: Vec2,
  reach: number,
  halfAngleRad: number,
): AttackSector {
  return { origin, direction, reach, halfAngleRad };
}

export function sectorOverlapsBox(sector: AttackSector, box: AABB): boolean {
  const points: Vec2[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  return points.some((p) => pointInSector(sector, p));
}

function pointInSector(sector: AttackSector, point: Vec2): boolean {
  const dx = point.x - sector.origin.x;
  const dy = point.y - sector.origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > sector.reach) return false;
  if (dist === 0) return true;
  const cosAngle = (dx * sector.direction.x + dy * sector.direction.y) / dist;
  return cosAngle >= Math.cos(sector.halfAngleRad);
}
```

- [ ] **Step 4: Adicionar a constante em `src/combat/movementDefs.ts`**

Adicionar, ao final do arquivo:

```ts
export const ATTACK_HALF_ANGLE_RAD = Math.PI / 4; // 45° pra cada lado da mira — leque de 90° total
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/sector.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS — nada mais no repo referencia `sector.ts`/`ATTACK_HALF_ANGLE_RAD` ainda, então nenhuma regressão possível fora deste arquivo.

- [ ] **Step 7: Commit**

```bash
git add src/combat/sector.ts src/combat/sector.test.ts src/combat/movementDefs.ts
git commit -m "feat: add AttackSector, a free-angle cone hitbox replacing the 4-quadrant AABB"
```

---

### Task 2: `PlayerController` — ataque do jogador usa o leque

**Files:**
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: `AttackSector`, `directionalSector` (Task 1, `./sector`); `ATTACK_HALF_ANGLE_RAD` (Task 1, `./movementDefs`).
- Produces: `PlayerController.attackHitbox(): AttackSector | null` (assinatura nova, era `AABB | null`) — consumido pela Task 4 (`Encounter`).

- [ ] **Step 1: Atualizar os imports**

Em `src/combat/playerController.ts`, trocar a linha 16-17 atuais:

```ts
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena, directionalHitbox } from './movement';
```

por:

```ts
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS, ATTACK_HALF_ANGLE_RAD } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, type AttackSector } from './sector';
```

- [ ] **Step 2: Reescrever os testes de forma para comportamento (RED antes do Step 3)**

Em `src/combat/playerController.test.ts`:

Trocar (linha ~86):
```ts
    expect(hitbox!.width).toBeCloseTo(HEAVY.reach);
```
por:
```ts
    expect(hitbox!.reach).toBeCloseTo(HEAVY.reach + 10); // +10 = metade da largura do hurtbox de teste (20)
```

Trocar (linha ~110):
```ts
    expect(hitbox!.width).toBeCloseTo(CHARGED.charge!.reachMax);
```
por:
```ts
    expect(hitbox!.reach).toBeCloseTo(CHARGED.charge!.reachMax + 10);
```

Trocar (linhas ~136-137):
```ts
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2;
    expect(hitbox!.width).toBeCloseTo(midpointReach);
```
por:
```ts
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2 + 10;
    expect(hitbox!.reach).toBeCloseTo(midpointReach);
```

Trocar (linha ~276):
```ts
    expect(hitbox!.y).toBeLessThan(player.hurtbox().y); // reach strip is above the hurtbox, matching the aim
```
por:
```ts
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // aiming up
```

Trocar (linha ~287):
```ts
    expect(hitbox!.y).toBeLessThan(player.hurtbox().y); // still using the "aim up" direction committed at tryAction() time
```
por:
```ts
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // still using the "aim up" direction committed at tryAction() time
```

Adicionar ao final do arquivo, dentro do último `describe` (ou num novo `describe('PlayerController — diagonal attacks', ...)` ao final do arquivo):

```ts
describe('PlayerController — diagonal attacks', () => {
  it('a diagonal attack reaches a target positioned on that diagonal (regression: old 4-quadrant hitbox could miss this)', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 1, y: 1 });
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const targetBox = { x: 30, y: 30, width: 20, height: 20 }; // on the same diagonal, within reach (LIGHT.reach=45 + 10)
    expect(sectorOverlapsBox(hitbox!, targetBox)).toBe(true);
  });
});
```

No topo do arquivo, adicionar o import:

```ts
import { sectorOverlapsBox } from './sector';
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `hitbox!.reach`/`hitbox!.direction` são `undefined` (o código ainda devolve um AABB com `x`/`y`/`width`/`height`); `sectorOverlapsBox` importável mas o teste novo falha porque `attackHitbox()` ainda não devolve um `AttackSector`.

- [ ] **Step 4: Implementar em `PlayerController`**

Substituir o método `attackHitbox()` inteiro por:

```ts
  attackHitbox(): AttackSector | null {
    if (this.state !== 'acting' || !this.currentAction) return null;

    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };

    if (this.currentAction.actionType === 'charged') {
      if (!this.chargeTriggered) return null;
      if (this.phaseElapsedMs >= this.currentAction.timing.activeMs) return null;
      return directionalSector(
        center,
        this.committedDirection,
        this.chargedReach() + this.width / 2,
        ATTACK_HALF_ANGLE_RAD,
      );
    }

    const { startupMs, activeMs } = this.currentAction.timing;
    const inActive = this.phaseElapsedMs >= startupMs && this.phaseElapsedMs < startupMs + activeMs;
    if (!inActive) return null;
    return directionalSector(
      center,
      this.committedDirection,
      this.currentAction.reach + this.width / 2,
      ATTACK_HALF_ANGLE_RAD,
    );
  }
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (todos os testes existentes + o novo).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: erros só em `src/combat/assaltanteController.ts`/`encounter.ts`/`src/scenes/ArenaScene.ts` (ainda esperam `AABB` de `attackHitbox()`) — corrigidos nas próximas tasks.

- [ ] **Step 7: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: PlayerController.attackHitbox() returns a free-angle AttackSector"
```

---

### Task 3: `AssaltanteController` — ataque do Assaltante usa o leque

**Files:**
- Modify: `src/combat/assaltanteController.ts`
- Modify: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Consumes: `AttackSector`, `directionalSector` (Task 1, `./sector`); `ATTACK_HALF_ANGLE_RAD` (Task 1, `./movementDefs`).
- Produces: `AssaltanteController.attackHitbox(): AttackSector | null` — consumido pela Task 4 (`Encounter`).

- [ ] **Step 1: Atualizar os imports**

Em `src/combat/assaltanteController.ts`, trocar as linhas 8-9 atuais:

```ts
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena, directionalHitbox } from './movement';
```

por:

```ts
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH, ATTACK_HALF_ANGLE_RAD } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, type AttackSector } from './sector';
```

- [ ] **Step 2: Reescrever os testes de forma para comportamento + teste diagonal novo (RED antes do Step 3)**

Em `src/combat/assaltanteController.test.ts`:

Trocar (linhas ~120-122):
```ts
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.x).toBeGreaterThan(enemy.position.x);
```
por:
```ts
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 1, y: 0 });
```

Trocar (linhas ~142-144):
```ts
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.y).toBeLessThan(enemy.position.y); // extends upward, toward player
```
por:
```ts
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // extends upward, toward player
```

Adicionar ao final do arquivo, dentro do `describe('AssaltanteController', ...)`, antes do `});` de fechamento:

```ts
  it('attack hitbox reaches a diagonally-positioned player (regression: old 4-quadrant hitbox could miss this)', () => {
    const { enemy } = makeAssaltante(); // enemy at x=100, y=0, 20x20
    const playerPos = { x: 130, y: 30 }; // diagonal offset, distance ~42.4, within ATTACK_RANGE (60)
    enemy.step(16, playerPos);
    expect(enemy.state).toBe('attacking');
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, playerPos);
      elapsed += 16;
    }
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    const playerHurtbox = { x: playerPos.x, y: playerPos.y, width: 20, height: 20 };
    expect(sectorOverlapsBox(hitbox!, playerHurtbox)).toBe(true);
  });
```

No topo do arquivo, adicionar o import:

```ts
import { sectorOverlapsBox } from './sector';
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `hitbox!.direction` é `undefined`; o teste diagonal novo falha porque `attackHitbox()` ainda devolve o retângulo de eixo único (que, nesta geometria específica, erra o alvo — ver §5 do spec pra álgebra completa).

- [ ] **Step 4: Implementar em `AssaltanteController`**

Substituir o método `attackHitbox()` inteiro por:

```ts
  attackHitbox(): AttackSector | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    return directionalSector(center, this._attackDirection, ATTACK_REACH + this.width / 2, ATTACK_HALF_ANGLE_RAD);
  }
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (todos os testes existentes + o novo).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: erros só em `src/combat/encounter.ts`/`src/scenes/ArenaScene.ts` — corrigidos na Task 4/5.

- [ ] **Step 7: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: AssaltanteController.attackHitbox() returns a free-angle AttackSector"
```

---

### Task 4: `Encounter` — colisão de ataque usa `sectorOverlapsBox`

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `sectorOverlapsBox` (Task 1, `./sector`); `AttackSector`-returning `attackHitbox()` de `PlayerController`/`AssaltanteController` (Tasks 2, 3).
- Produces: nada novo downstream — fecha a cadeia de colisão de ataque.

**Importante sobre o estado intermediário desta task:** neste ponto do plano (depois das Tasks 2/3), `PlayerController.attackHitbox()`/`AssaltanteController.attackHitbox()` já devolvem `AttackSector` (campos `origin`/`direction`/`reach`/`halfAngleRad`), mas `encounter.ts` ainda chama o antigo `aabbOverlap(attack, hurtbox)`, que lê `attack.x`/`attack.width`/etc. — campos que não existem mais nesse objeto. O Vitest deste projeto roda via `esbuild` (só remove tipos, não checa), então isso **não trava a suíte por erro de compilação** — em vez disso, `aabbOverlap` recebe `undefined` nesses campos e a comparação sempre dá `false`. Na prática, **todo teste que depende de um ataque conectar de verdade** (esquiva, bloqueio, parry, hit não mitigado, punição — praticamente toda a suíte de `encounter.test.ts` construída no kit defensivo) vai falhar nesse checkpoint intermediário, não só o teste novo desta task. Isso é esperado — corrigido no Step 3 abaixo.

- [ ] **Step 1: Escrever o teste de regressão novo e reescrever o de invariante existente (RED)**

Em `src/combat/encounter.test.ts`, trocar o import (linha 5):
```ts
import { aabbOverlap } from './collision';
```
por:
```ts
import { sectorOverlapsBox } from './sector';
```

Trocar (linha ~135):
```ts
      if (hitbox && aabbOverlap(hitbox, encounter.player.hurtbox())) {
```
por:
```ts
      if (hitbox && sectorOverlapsBox(hitbox, encounter.player.hurtbox())) {
```

Adicionar ao final do arquivo, dentro do `describe('Encounter', ...)`, antes do `});` de fechamento:

```ts
  it('a stationary in-range player approached diagonally is hit, not misread as retreat (regression for the 4-quadrant hitbox bug)', () => {
    const encounter = new Encounter(
      { x: 130, y: 30, width: 20, height: 20 },
      { x: 100, y: 0, width: 20, height: 20 },
    );
    const hitEvents: unknown[] = [];
    encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    expect(hitEvents).toHaveLength(1);
    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toBeUndefined(); // no dim-4 label — the window resolved as a hit, not a retreat
  });
```

- [ ] **Step 2: Rodar a suíte completa para confirmar o estado RED esperado**

Run: `npm test`
Expected: **FAIL em muitos testes**, não só no novo — exatamente a situação descrita no aviso acima (`aabbOverlap` recebendo um `AttackSector` sem `x`/`width`/etc., sempre `false`). Confirme especificamente que o teste novo (`'a stationary in-range player approached diagonally is hit...'`) falha com `hitEvents` vazio — esse é o único resultado que você precisa verificar com atenção; o resto da suíte falhando junto é esperado e não é motivo de alarme nesta task.

- [ ] **Step 3: Atualizar `encounter.ts`**

Trocar:
```ts
import { aabbOverlap } from './collision';
```
por:
```ts
import { sectorOverlapsBox } from './sector';
```

Trocar:
```ts
    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && aabbOverlap(enemyAttack, this.player.hurtbox())) {
```
por:
```ts
    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && sectorOverlapsBox(enemyAttack, this.player.hurtbox())) {
```

Trocar:
```ts
    const playerAttack = this.player.attackHitbox();
    if (playerAttack && aabbOverlap(playerAttack, this.assaltante.hurtbox())) {
```
por:
```ts
    const playerAttack = this.player.attackHitbox();
    if (playerAttack && sectorOverlapsBox(playerAttack, this.assaltante.hurtbox())) {
```

- [ ] **Step 4: Rodar a suíte completa para confirmar que passa**

Run: `npm test`
Expected: PASS — todos os arquivos, incluindo o teste novo e todos os que falharam no Step 2.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — erros restantes, se houver, só em `src/scenes/ArenaScene.ts` (Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "fix: resolve attack collisions with the free-angle AttackSector, not the 4-quadrant AABB"
```

---

### Task 5: `ArenaScene` — overlay de debug desenha o leque

**Files:**
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `AttackSector` (Task 1, `../combat/sector`); `attackHitbox(): AttackSector | null` de `PlayerController`/`AssaltanteController` (Tasks 2, 3).
- Produces: nada novo downstream — task final de wiring visual.

- [ ] **Step 1: Adicionar o import do tipo**

Junto aos outros imports de tipo (perto de `import type { Vec2, AABB } from '../combat/types';`):

```ts
import type { AttackSector } from '../combat/sector';
```

- [ ] **Step 2: Adicionar `sectorAsPoints`**

Logo antes do método `cornersAsPoints` existente:

```ts
  private sectorAsPoints(sector: AttackSector, samples = 10): Phaser.Geom.Point[] {
    const centerAngle = Math.atan2(sector.direction.y, sector.direction.x);
    const originScreen = toScreen(sector.origin, ISO_CONFIG);
    const points: Phaser.Geom.Point[] = [new Phaser.Geom.Point(originScreen.x, originScreen.y)];
    for (let i = 0; i <= samples; i++) {
      const angle = centerAngle - sector.halfAngleRad + (2 * sector.halfAngleRad * i) / samples;
      const worldPoint = {
        x: sector.origin.x + Math.cos(angle) * sector.reach,
        y: sector.origin.y + Math.sin(angle) * sector.reach,
      };
      const screen = toScreen(worldPoint, ISO_CONFIG);
      points.push(new Phaser.Geom.Point(screen.x, screen.y));
    }
    return points;
  }
```

- [ ] **Step 3: Trocar as duas chamadas de desenho do ataque**

Em `drawDebugHitboxes()`, trocar:
```ts
    this.debugGraphics.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = this.encounter.player.attackHitbox();
    if (playerAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(playerAttack), true);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(assaltanteAttack), true);
```
por:
```ts
    this.debugGraphics.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = this.encounter.player.attackHitbox();
    if (playerAttack) this.debugGraphics.fillPoints(this.sectorAsPoints(playerAttack), true);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) this.debugGraphics.fillPoints(this.sectorAsPoints(assaltanteAttack), true);
```

(As duas linhas de `strokePoints(this.cornersAsPoints(...))` para as hurtboxes, logo acima, **não mudam** — hurtboxes continuam sendo AABBs de verdade.)

- [ ] **Step 4: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: PASS, 0 erros, nenhuma regressão.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: render the attack sector as a fan polygon in the debug overlay"
```

---

### Task 6: Verificação final (suíte completa + checagem visual)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suíte completa**

Run: `npm test`
Expected: PASS — todos os arquivos, incluindo os testes novos das Tasks 1-4.

Run: `npm run typecheck`
Expected: PASS, 0 erros.

- [ ] **Step 2: Checagem visual via dev server (o motivo original desta correção)**

Run: `npm run dev` (background), abrir no navegador via Claude in Chrome.

Roteiro:
1. Aproximar do Assaltante e deixar ele atacar — confirmar que o overlay de debug agora desenha um **leque** (não mais um retângulo) na direção do ataque.
2. Mirar o mouse numa diagonal (ex: canto superior direito) e atacar — confirmar visualmente que o leque aponta exatamente pra essa diagonal, não trava num dos 4 eixos.
3. Posicionar-se numa diagonal em relação ao Assaltante, ficar parado sem se defender, e deixar ele atacar — confirmar que o golpe conecta (HUD "hits sofridos" incrementa) em vez de passar batido.

Se qualquer item falhar, voltar à task correspondente, corrigir, e repetir a Step 1 desta task antes de prosseguir.

- [ ] **Step 3: Parar o dev server** — nenhum commit nesta task, a menos que a Step 2 tenha exigido correções (nesse caso, commitar na task de origem do bug, não aqui).

---

## Self-Review Notes

**Cobertura do spec:**
- §3 (`sector.ts`) → Task 1.
- §4 (pontos de chamada `PlayerController`/`AssaltanteController`, ajuste de alcance `+ width/2`) → Tasks 2, 3.
- §5 (`Encounter`, testes de forma→comportamento, casos diagonais, regressão de `'retreat'`) → Task 4 (mais os testes unitários de alcance diagonal nas Tasks 2/3, que cobrem o critério de pronto #1/#2 de forma mais direta e determinística que uma simulação de perseguição de vários segundos — ver justificativa inline nas tasks).
- §6 (overlay de debug em leque) → Task 5.
- §2.3 critério de pronto: #1 → teste novo na Task 2. #2 → teste novo na Task 3 (prova determinística: mostra que o código antigo erraria esse ataque específico). #3 → teste novo na Task 4 (o mais crítico — prova que a dim 4 não grava mais `'retreat'` falso). #4 → já coberto pelos testes de ângulo em `sector.test.ts` (Task 1). #5 → todas as reescritas de forma→comportamento nas Tasks 2/3/4. #6 → Task 6, Step 2.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo de código tem o código completo; a Step 2 de verificação manual (Task 6) descreve exatamente o que observar.

**Consistência de tipos:** `AttackSector` (Task 1) com campos `origin`/`direction`/`reach`/`halfAngleRad` usado com esses nomes exatos em `PlayerController`/`AssaltanteController` (Tasks 2, 3), em `ArenaScene.sectorAsPoints` (Task 5), e nos testes que leem `hitbox!.reach`/`hitbox!.direction`. `directionalSector`/`sectorOverlapsBox` importados com esses nomes exatos em todo lugar que os usa. `ATTACK_HALF_ANGLE_RAD` definida uma vez em `movementDefs.ts` (Task 1) e importada com esse nome exato nas Tasks 2 e 3.

**Nota sobre o RED da Task 4:** diferente das outras tasks, o checkpoint RED da Task 4 (Step 2) espera falha em MUITOS testes ao mesmo tempo, não só no novo — isso é consequência de `PlayerController`/`AssaltanteController` já devolverem `AttackSector` (Tasks 2/3) enquanto `encounter.ts` ainda usa o `aabbOverlap` antigo, que silenciosamente sempre retorna `false` contra um objeto sem `x`/`width`/etc. (o Vitest deste projeto não checa tipos em tempo de execução). Documentado explicitamente na task para não ser confundido com uma regressão introduzida por engano.

---

Plano completo e salvo em `docs/superpowers/plans/2026-09-07-leque-de-ataque.md`.

**Qual abordagem de execução?**

1. **Subagent-Driven (recomendado)** — dispatch de um subagente novo por task, revisão entre tasks, iteração rápida.
2. **Execução inline** — execução das tasks nesta sessão via `executing-plans`, em lote com checkpoints.
