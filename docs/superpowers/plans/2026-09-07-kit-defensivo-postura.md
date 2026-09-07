# Kit Defensivo + Barra de Postura (dim 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bloqueio, parry (contra-ataque) e recuo ao kit de defesa do jogador — hoje só existe esquiva — e ligar a dim 4 (repertório defensivo, `n=4`) ao `ProfileAccumulator`, fechando a Família B (dims 1/2/4) do roadmap de 7 passos.

**Architecture:** `PlayerController` ganha dois estados novos (`'blocking'`, `'staggered'`) e uma barra de postura numérica. `Encounter.step()` passa a resolver o golpe do Assaltante em 5 casos por precedência (dodge > parry > block > hit não mitigado > recuo), gravando no máximo 1 rótulo de dim 4 por janela de ataque via um guard booleano resetado a cada `opp.open` do tipo `dodge`. `AssaltanteController` ganha `onPlayerParrySuccess()`, espelhando `onPlayerDodgeSuccess()` já existente, com uma janela de punição bônus maior. Nenhuma mudança em `visual/`, `opportunity/` (fora do novo `onExpire`... na verdade nem isso, ver nota de desvio abaixo) ou nos specs de dim 1/2 já mesclados.

**Tech Stack:** TypeScript, Vitest (TDD igual ao resto de `combat/`/`profile/`), Phaser 3 só para o rebind de tecla e duas linhas de HUD em texto cru.

**Spec:** `docs/superpowers/specs/2026-09-07-kit-defensivo-postura-design.md`

**Nota de desvio do spec (implementabilidade):** o §5 do spec sugere que o `onExpire` da oportunidade `dodge` (dentro de `AssaltanteController`) chame de volta um método tipo `onPlayerRetreat()` que gravaria o perfil — mas `AssaltanteController` não tem (e não deve ganhar) uma referência ao `ProfileAccumulator`, e a assinatura de `onExpire` (`() => ExpiryResult`) não permite efeito colateral externo. Este plano resolve o mesmo comportamento observável (recuo só é gravado quando a janela `dodge` expira naturalmente sem nenhuma defesa) fazendo `Encounter` ouvir `opp.close` do tipo `dodge` com `outcome: 'expired'` — exatamente o mesmo padrão que `Encounter` já usa para `'punish'`. Nenhum código novo entra em `opportunity/opportunitySystem.ts`; `AssaltanteController` não precisa de nenhum `onExpire` novo na oportunidade `dodge`. Todos os critérios de pronto do spec continuam satisfeitos.

## Global Constraints

- Sem sistema de HP/dano — hit não mitigado é só um contador HUD + stagger breve, conforme decisão explícita do spec §1.1.
- Sem barra gráfica nova na HUD — só texto cru, mesmo estilo já existente (redesign de HUD é pendência separada).
- Bloqueio/parry são universais — nenhum efeito de arma equipada (spec §2.2).
- Recuo não tem tecla própria — é inferido do WASD já existente (spec, decisão de brainstorming).
- Esquiva muda de tecla `K` para `Espaço`; guarda (bloqueio/parry) entra em `E`.
- `combat/`, `opportunity/`, `ai/`, `profile/` continuam sem depender de `visual/` — só `ArenaScene` enxerga os dois lados (arquitetura travada do projeto).

---

## File Structure

| File | Responsabilidade |
|---|---|
| `src/combat/types.ts` (edit) | `PlayerState` ganha `'blocking'` e `'staggered'`. |
| `src/combat/actionDefs.ts` (edit) | Constantes novas: `POISE_MAX`, `POISE_DRAIN_PER_BLOCK`, `POISE_REGEN_DELAY_MS`, `POISE_REGEN_PER_SECOND`, `STAGGER_MS`, `PARRY_WINDOW_MS`, `PARRY_BONUS_RECOVERY_MS`. |
| `src/combat/playerController.ts` (edit) | `poise`, `startBlock()`/`stopBlock()`, `isBlocking`/`isParryTiming` (getters), `absorbBlockHit()`, `enterStagger()`, novos ramos de `'blocking'`/`'staggered'` em `step()`. |
| `src/combat/playerController.test.ts` (edit) | Testes da máquina de estados nova. |
| `src/profile/profileAccumulator.ts` (edit) | `DEFENSIVE_LABELS`/`DefensiveLabel`, nova instância de `EntropyAccumulator` para `'defensive_repertoire'`, método `recordDefense(label)`. |
| `src/profile/profileAccumulator.test.ts` (edit) | Testes da dim 4 isolada (mesmo padrão de `weapon_repertoire`). |
| `src/combat/assaltanteController.ts` (edit) | `onPlayerParrySuccess()`. |
| `src/combat/assaltanteController.test.ts` (edit) | Testes do parry isolado. |
| `src/core/events.ts` (edit) | Novo evento `'player.hit_unmitigated'`. |
| `src/combat/encounter.ts` (edit) | Resolução dos 5 casos do golpe do Assaltante; listeners de `opp.open`/`opp.close`/`player.dodge` para gravar dim 4 no máximo 1x por janela. |
| `src/combat/encounter.test.ts` (edit) | Testes de integração ponta a ponta (critérios de pronto #1, #2, #5, #6 do spec). |
| `src/debug/hudState.ts` (edit) | `HudCounters.hitsUnmitigated`. |
| `src/debug/hudState.test.ts` (edit) | Teste do contador novo. |
| `src/scenes/ArenaScene.ts` (edit) | Rebind `K`→`Espaço`, nova tecla `E`; duas linhas de HUD (postura, hits sofridos); `controlsText` atualizado. |

---

### Task 1: `PlayerController` — bloqueio, parry, stagger, postura

**Files:**
- Modify: `src/combat/types.ts`
- Modify: `src/combat/actionDefs.ts`
- Modify: `src/combat/playerController.ts`
- Modify: `src/combat/playerController.test.ts`

**Interfaces:**
- Consumes: nada novo (só o `PlayerState` e as constantes que este task também cria).
- Produces: `PlayerState` inclui `'blocking'`/`'staggered'`; `PlayerController.poise: number`; `startBlock(): void`; `stopBlock(): void`; `get isBlocking(): boolean`; `get isParryTiming(): boolean`; `absorbBlockHit(): void`; `enterStagger(): void` — todos consumidos por Task 4 (`Encounter`).

- [ ] **Step 1: Adicionar os dois estados novos**

Em `src/combat/types.ts`, linha 14:

```ts
export type PlayerState = 'idle' | 'acting' | 'dodging' | 'blocking' | 'staggered';
```

- [ ] **Step 2: Adicionar as constantes novas**

Em `src/combat/actionDefs.ts`, depois de `export const SWITCH_RECOVERY_MS = 250;`:

```ts
export const POISE_MAX = 100;
export const POISE_DRAIN_PER_BLOCK = 40; // 3 bloqueios seguidos quebram a postura
export const POISE_REGEN_DELAY_MS = 1000; // tempo parado em 'idle' antes de regenerar
export const POISE_REGEN_PER_SECOND = 50; // recarga total em ~2s depois do delay
export const STAGGER_MS = 350;
export const PARRY_WINDOW_MS = 150; // guarda levantada há menos que isso quando o golpe conecta = parry
export const PARRY_BONUS_RECOVERY_MS = 750; // vs. RECOVERY_MS = 500 em assaltanteController.ts
```

- [ ] **Step 3: Escrever os testes que falham**

Adicionar ao final de `src/combat/playerController.test.ts` (novo `describe`, depois do `describe('PlayerController — weapon switching', ...)` existente):

```ts
describe('PlayerController — defensive kit (blocking/parry/stagger/poise)', () => {
  it('starts with full poise', () => {
    const { player } = makePlayer();
    expect(player.poise).toBe(POISE_MAX);
  });

  it('startBlock() transitions to blocking, only from idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.state).toBe('blocking');
    expect(player.isBlocking).toBe(true);
  });

  it('startBlock() is a no-op outside idle', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.state).toBe('dodging');
    player.startBlock();
    expect(player.state).toBe('dodging'); // unchanged
  });

  it('stopBlock() returns to idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.stopBlock();
    expect(player.state).toBe('idle');
  });

  it('isParryTiming is true just after starting the block, false once past PARRY_WINDOW_MS', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.isParryTiming).toBe(true);
    player.step(PARRY_WINDOW_MS + 10);
    expect(player.isParryTiming).toBe(false);
    expect(player.isBlocking).toBe(true); // still blocking, just past the parry window
  });

  it('absorbBlockHit() drains poise by POISE_DRAIN_PER_BLOCK', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    expect(player.poise).toBe(POISE_MAX - POISE_DRAIN_PER_BLOCK);
    expect(player.state).toBe('blocking'); // poise not yet broken
  });

  it('poise breaking (3 absorbed hits) enters staggered', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    player.absorbBlockHit();
    player.absorbBlockHit();
    expect(player.poise).toBe(0);
    expect(player.state).toBe('staggered');
  });

  it('enterStagger() blocks all input until STAGGER_MS elapses, then returns to idle', () => {
    const { player } = makePlayer();
    player.enterStagger();
    expect(player.state).toBe('staggered');
    player.tryDodge();
    expect(player.state).toBe('staggered'); // still locked out
    player.step(STAGGER_MS - 1);
    expect(player.state).toBe('staggered');
    player.step(2);
    expect(player.state).toBe('idle');
  });

  it('poise regenerates after POISE_REGEN_DELAY_MS of standing idle, even across a single large step()', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    player.stopBlock(); // back to idle, poise = 60, regen delay armed at 1000ms
    player.step(POISE_REGEN_DELAY_MS + 1000); // one big step: 1000ms of delay + 1000ms of regen
    expect(player.poise).toBe(POISE_MAX); // 60 + (1000/1000)*50 = 110, clamped to 100
  });

  it('poise never regenerates above POISE_MAX', () => {
    const { player } = makePlayer();
    player.step(POISE_REGEN_DELAY_MS + 5000);
    expect(player.poise).toBe(POISE_MAX);
  });
});
```

No topo do arquivo, ajustar o import existente (linha 6) para incluir as novas constantes:

```ts
import {
  DODGE,
  SWITCH_RECOVERY_MS,
  POISE_MAX,
  POISE_DRAIN_PER_BLOCK,
  POISE_REGEN_DELAY_MS,
  PARRY_WINDOW_MS,
  STAGGER_MS,
} from './actionDefs';
```

- [ ] **Step 4: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `player.poise`/`startBlock`/etc. não existem ainda.

- [ ] **Step 5: Implementar em `PlayerController`**

Import no topo de `src/combat/playerController.ts` (substituindo a linha 5 atual):

```ts
import {
  DODGE,
  SWITCH_RECOVERY_MS,
  POISE_MAX,
  POISE_DRAIN_PER_BLOCK,
  POISE_REGEN_DELAY_MS,
  POISE_REGEN_PER_SECOND,
  STAGGER_MS,
  PARRY_WINDOW_MS,
} from './actionDefs';
```

Novos campos (depois de `private dashDirection: Vec2 = { x: 1, y: 0 };`, linha 27):

```ts
  poise = POISE_MAX;
  private blockHeldMs = 0;
  private staggerRemainingMs = 0;
  private poiseRegenDelayRemainingMs = 0;
```

Novos getters (depois do getter `facing`, linha 48):

```ts
  get isBlocking(): boolean {
    return this.state === 'blocking';
  }

  get isParryTiming(): boolean {
    return this.state === 'blocking' && this.blockHeldMs < PARRY_WINDOW_MS;
  }
```

Novos métodos (depois de `tryDodge()`, antes de `step()`):

```ts
  startBlock(): void {
    if (this.state !== 'idle') return;
    this.state = 'blocking';
    this.blockHeldMs = 0;
  }

  stopBlock(): void {
    if (this.state !== 'blocking') return;
    this.state = 'idle';
    this.blockHeldMs = 0;
  }

  absorbBlockHit(): void {
    this.poise = Math.max(0, this.poise - POISE_DRAIN_PER_BLOCK);
    if (this.poise <= 0) this.enterStagger();
  }

  enterStagger(): void {
    this.state = 'staggered';
    this.staggerRemainingMs = STAGGER_MS;
    this.blockHeldMs = 0;
  }
```

Em `step()`, adicionar dois ramos novos antes do ramo `// dodging` (que hoje é o `else` implícito no final — os ramos existentes usam `if (this.state === 'idle') { ...; return; }` e `if (this.state === 'acting') { ...; return; }` antes de cair no bloco de dodging sem guarda). Inserir logo depois do bloco `if (this.state === 'acting') { this.stepActing(stepMs); return; }`:

```ts
    if (this.state === 'blocking') {
      this.blockHeldMs += stepMs;
      return;
    }

    if (this.state === 'staggered') {
      this.staggerRemainingMs -= stepMs;
      if (this.staggerRemainingMs <= 0) {
        this.state = 'idle';
        this.staggerRemainingMs = 0;
      }
      return;
    }
```

E dentro do ramo `if (this.state === 'idle') { ... }` (existente), adicionar a regeneração de postura logo antes do `return;` final desse bloco:

```ts
      if (this.poise < POISE_MAX) {
        // Handles a single large stepMs (as tests use, e.g. player.step(DODGE.durationMs)
        // elsewhere) as correctly as many small 60Hz ticks: whatever portion of this
        // step falls *after* the delay expires still regenerates poise, instead of the
        // delay-countdown and the regen being mutually exclusive within one call.
        const delayBefore = this.poiseRegenDelayRemainingMs;
        this.poiseRegenDelayRemainingMs = Math.max(0, delayBefore - stepMs);
        const regenMs = stepMs - delayBefore; // time left in this step after the delay ends
        if (regenMs > 0) {
          this.poise = Math.min(POISE_MAX, this.poise + (regenMs / 1000) * POISE_REGEN_PER_SECOND);
        }
      }
      return;
```

E em `absorbBlockHit()`, antes de drenar, iniciar o delay de regeneração — ajustar o método para:

```ts
  absorbBlockHit(): void {
    this.poise = Math.max(0, this.poise - POISE_DRAIN_PER_BLOCK);
    this.poiseRegenDelayRemainingMs = POISE_REGEN_DELAY_MS;
    if (this.poise <= 0) this.enterStagger();
  }
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (todos os testes existentes + os novos).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: erros só em `assaltanteController.ts`/`encounter.ts`/`hudState.ts`/`ArenaScene.ts` (ainda não tocados) — nenhum erro em `playerController.ts`/`types.ts`/`actionDefs.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/combat/types.ts src/combat/actionDefs.ts src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: add blocking/staggered states, poise, and parry timing to PlayerController"
```

---

### Task 2: `ProfileAccumulator` — dim 4 (`defensive_repertoire`)

**Files:**
- Modify: `src/profile/profileAccumulator.ts`
- Modify: `src/profile/profileAccumulator.test.ts`

**Interfaces:**
- Consumes: `EntropyAccumulator` (já existe, sem mudança).
- Produces: `DEFENSIVE_LABELS`, `DefensiveLabel`, `ProfileAccumulator.recordDefense(label: DefensiveLabel): void` — consumidos por Task 4 (`Encounter`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/profile/profileAccumulator.test.ts`:

```ts
describe('ProfileAccumulator — defensive repertoire (Família B, dim 4)', () => {
  it('a skill with no defenses recorded has a null domain', () => {
    const acc = new ProfileAccumulator();
    acc.applyRoomBoundary();
    expect(acc.domain('defensive_repertoire', 'trait')).toBeNull();
  });

  it('recordDefense() feeds the defensive_repertoire entropy dimension', () => {
    const acc = new ProfileAccumulator();
    acc.recordDefense('dodge');
    acc.recordDefense('dodge');
    acc.recordDefense('block');
    acc.recordDefense('parry');
    acc.recordDefense('retreat');
    acc.applyRoomBoundary();

    const counts = { dodge: 2, block: 1, parry: 1, retreat: 1 };
    const total = 5;
    const H =
      -Object.values(counts).reduce((acc2, c) => {
        const p = c / total;
        return acc2 + p * Math.log(p);
      }, 0) / Math.log(4);

    expect(acc.domain('defensive_repertoire', 'trait')).toBeCloseTo(H, 6);
  });

  it('only one defensive label ever used keeps the domain null (n effective < 2)', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordDefense('dodge');
    acc.applyRoomBoundary();
    expect(acc.domain('defensive_repertoire', 'trait')).toBeNull();
  });

  it('snapshot includes defensive_repertoire once folded, independently of the other dims', () => {
    const acc = new ProfileAccumulator();
    acc.recordDefense('block');
    acc.applyRoomBoundary();
    const snap = acc.snapshot('room.exit');
    expect('defensive_repertoire' in snap.domain).toBe(true);
    expect(snap.counts.defensive_repertoire).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: FAIL — `recordDefense` não existe, `domain('defensive_repertoire', ...)` sempre `null` mesmo com uso.

- [ ] **Step 3: Implementar**

No topo de `src/profile/profileAccumulator.ts`, depois dos imports existentes:

```ts
export const DEFENSIVE_LABELS = ['dodge', 'block', 'parry', 'retreat'] as const;
export type DefensiveLabel = (typeof DEFENSIVE_LABELS)[number];
```

No construtor, depois de `this.entropyDims.set('weapon_repertoire', ...)`:

```ts
    this.entropyDims.set('defensive_repertoire', {
      acc: new EntropyAccumulator(DEFENSIVE_LABELS),
      folded: false,
      everRecorded: false,
    });
```

Novo método, depois de `recordAction(...)`:

```ts
  recordDefense(label: DefensiveLabel): void {
    const dim = this.entropyDims.get('defensive_repertoire')!;
    dim.acc.record(label);
    dim.everRecorded = true;
  }
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/profile/profileAccumulator.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: PASS — nada mais no repo referencia `defensive_repertoire` ainda, então nenhuma regressão possível fora deste arquivo.

- [ ] **Step 6: Commit**

```bash
git add src/profile/profileAccumulator.ts src/profile/profileAccumulator.test.ts
git commit -m "feat: wire the defensive-repertoire entropy dimension (dim 4) into ProfileAccumulator"
```

---

### Task 3: `AssaltanteController` — `onPlayerParrySuccess()`

**Files:**
- Modify: `src/combat/assaltanteController.ts`
- Modify: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Consumes: `PARRY_BONUS_RECOVERY_MS` (Task 1, `actionDefs.ts`).
- Produces: `AssaltanteController.onPlayerParrySuccess(): void` — consumido por Task 4 (`Encounter`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/combat/assaltanteController.test.ts` (dentro do `describe('AssaltanteController', ...)` existente, antes do `});` de fechamento):

```ts
  it('onPlayerParrySuccess() during attacking cuts the swing short, resolves dodge as taken, and opens a bigger punish window', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    const closeHandler = vi.fn();
    const openHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    bus.on('opp.open', openHandler);

    enemy.onPlayerParrySuccess();

    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
    expect(openHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', src: 'assaltante.recover', window_ms: PARRY_BONUS_RECOVERY_MS }),
    );
  });

  it('onPlayerParrySuccess() outside the attacking state is a no-op', () => {
    const { enemy, bus } = makeAssaltante();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerParrySuccess(); // still idle, no active dodge opportunity
    expect(closeHandler).not.toHaveBeenCalled();
    expect(enemy.state).toBe('idle');
  });
```

No topo do arquivo, adicionar o import:

```ts
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `onPlayerParrySuccess` não existe.

- [ ] **Step 3: Implementar**

Em `src/combat/assaltanteController.ts`, adicionar o import no topo (junto aos outros):

```ts
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
```

Novo método, logo depois de `onPlayerDodgeSuccess()`:

```ts
  onPlayerParrySuccess(): void {
    if (this.state !== 'attacking' || !this.activeOppId) return;
    this.opp.resolve(this.activeOppId, 'taken');
    this.state = 'recovering';
    this.phaseElapsedMs = 0;
    this.playerWasInRangeDuringPunish = false;
    this.activeOppId = this.opp.open('punish', 'assaltante.recover', PARRY_BONUS_RECOVERY_MS, () =>
      this.playerWasInRangeDuringPunish
        ? { outcome: 'expired' }
        : { outcome: 'invalid', reason: 'out_of_range' },
    );
  }
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: add AssaltanteController.onPlayerParrySuccess() with a bonus punish window"
```

---

### Task 4: `Encounter` — resolução dos 5 casos + evento de hit não mitigado

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `player.isBlocking`/`isParryTiming`/`absorbBlockHit()`/`enterStagger()` (Task 1); `profile.recordDefense(label)` (Task 2); `assaltante.onPlayerParrySuccess()` (Task 3).
- Produces: novo evento `'player.hit_unmitigated'` — consumido por Task 5 (`HudState`).

- [ ] **Step 1: Adicionar o evento novo**

Em `src/core/events.ts`, junto a `PlayerDodgePayload`:

```ts
export type PlayerHitUnmitigatedPayload = Record<string, never>;
```

E no `GameEvents`:

```ts
export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
  'player.hit_unmitigated': PlayerHitUnmitigatedPayload;
};
```

- [ ] **Step 2: Escrever os testes que falham**

Adicionar ao final de `src/combat/encounter.test.ts` (mesmo arquivo, dentro do `describe('Encounter', ...)`, antes do `});` final). Usa os mesmos `runFor`/`useWeapon`/`attackWith` helpers já definidos no topo do arquivo, e o mesmo par de posições `{x:0,y:0}`/`{x:30,y:0}` já comprovado como produzindo overlap durante o swing (teste "a successful dodge resolves..." já existente):

```ts
  it('a well-timed parry (E right before impact) resolves dodge as taken, records the parry label, and opens a bigger punish window', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    runFor(encounter, TELEGRAPH_MS - STEP_MS * 2);
    encounter.player.startBlock(); // right before impact -> parry window
    runFor(encounter, STEP_MS * 3); // let the swing connect while still inside PARRY_WINDOW_MS

    expect(encounter.assaltante.state).toBe('recovering');
    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toEqual([1, 1]); // exactly 1 label recorded: parry
  });

  it('holding block from well before impact (past PARRY_WINDOW_MS) absorbs the hit as a block, draining poise, not a parry', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.player.startBlock();
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Block absorbs the hit but — unlike parry — never cuts the swing short;
    // the Assaltante still reaches 'recovering' on its own normal timing.
    // Poise drops by exactly one hit's worth (40), not to 0 — the hitbox
    // keeps overlapping for the rest of the ~150ms swing, but the guard
    // must make absorbBlockHit() fire only once per attack window.
    expect(encounter.player.poise).toBe(60);
    expect(encounter.assaltante.state).toBe('recovering');
  });

  it('taking a hit with no defense at all increments the unmitigated-hit counter and staggers the player', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const hitEvents: unknown[] = [];
    encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    expect(hitEvents).toHaveLength(1);
    expect(encounter.player.state).toBe('staggered');
  });

  it('retreating out of range before the swing connects, with no defense used, records the retreat label', () => {
    // Player at x=100 (not x=0) so there's room to retreat left without
    // hitting ARENA_BOUNDS' left edge (x=0).
    const encounter = new Encounter(
      { x: 100, y: 0, width: 20, height: 20 },
      { x: 130, y: 0, width: 20, height: 20 },
    );
    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    encounter.setPlayerMoveInput(-1, 0); // run away from the Assaltante
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toEqual([1, 1]); // exactly 1 label recorded: retreat
  });

  it('a full sequence of one of each defense yields exactly 4 dim-4 records and 1 unmitigated hit', () => {
    // Room 1: dodge
    const e1 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e1.step(STEP_MS);
    runFor(e1, TELEGRAPH_MS - STEP_MS * 2);
    e1.player.tryDodge();
    runFor(e1, SWING_MS + STEP_MS * 2);

    // Room 2: parry
    const e2 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e2.step(STEP_MS);
    runFor(e2, TELEGRAPH_MS - STEP_MS * 2);
    e2.player.startBlock();
    runFor(e2, STEP_MS * 3);

    // Room 3: block (held from well before impact)
    const e3 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e3.player.startBlock();
    runFor(e3, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Room 4: retreat (player offset from x=0 so there's room to move away
    // from the Assaltante without hitting ARENA_BOUNDS' left edge)
    const e4 = new Encounter({ x: 100, y: 0, width: 20, height: 20 }, { x: 130, y: 0, width: 20, height: 20 });
    e4.step(STEP_MS);
    e4.setPlayerMoveInput(-1, 0);
    runFor(e4, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Room 5: unmitigated hit
    const e5 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    const hits: unknown[] = [];
    e5.bus.on('player.hit_unmitigated', (e) => hits.push(e));
    runFor(e5, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    for (const e of [e1, e2, e3, e4, e5]) e.profile.applyRoomBoundary();
    expect(e1.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e2.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e3.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e4.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e5.profile.snapshot('room.exit').counts.defensive_repertoire).toBeUndefined(); // never folded, nothing recorded
    expect(hits).toHaveLength(1);
  });
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `startBlock`/`player.hit_unmitigated`/`defensive_repertoire` ainda não produzem o comportamento esperado (o golpe hoje só reage a `isInvulnerable`).

- [ ] **Step 4: Implementar em `Encounter`**

Substituir o conteúdo de `src/combat/encounter.ts` inteiro por:

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
  // Guards dim 4: at most one recordDefense() (or unmitigated-hit event) per
  // attack window. Reset whenever the Assaltante opens a new 'dodge'
  // opportunity (i.e. starts a new attack).
  private defenseRecordedThisAttack = false;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = new ProfileAccumulator();

    this.bus.on('player.action', (e) => {
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }
    });

    this.bus.on('player.dodge', () => {
      if (this.assaltante.state === 'attacking' && !this.defenseRecordedThisAttack) {
        this.defenseRecordedThisAttack = true;
        this.profile.recordDefense('dodge');
      }
    });

    this.bus.on('opp.open', (e) => {
      if (e.type === 'dodge') this.defenseRecordedThisAttack = false;
    });

    this.bus.on('opp.close', (e) => {
      if (e.type === 'punish' && e.outcome !== 'invalid') {
        this.profile.recordOutcome('punish', e.outcome);
      }
      if (e.type === 'dodge' && e.outcome === 'expired' && !this.defenseRecordedThisAttack) {
        this.defenseRecordedThisAttack = true;
        this.profile.recordDefense('retreat');
      }
    });
  }

  setPlayerMoveInput(dx: number, dy: number): void {
    this.player.setMoveInput(dx, dy);
  }

  step(stepMs: number): void {
    this.assaltante.step(stepMs, this.player.position);
    this.player.step(stepMs);

    // Dodge and parry are self-terminating (dodge via its own i-frame timing;
    // parry by pushing the Assaltante straight into 'recovering', which makes
    // attackHitbox() go null on the very next tick) — safe to leave ungated,
    // matching how onPlayerDodgeSuccess() already worked pre-existing this
    // plan. Block and the unmitigated-hit case are NOT self-terminating: the
    // hitbox keeps overlapping every tick for the rest of the ~150ms swing,
    // so both are explicitly gated by defenseRecordedThisAttack — otherwise
    // absorbBlockHit()/enterStagger() would refire every tick (poise would
    // vanish in ~3 ticks; stagger would never end while overlap holds).
    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && aabbOverlap(enemyAttack, this.player.hurtbox())) {
      if (this.player.isInvulnerable) {
        this.assaltante.onPlayerDodgeSuccess();
      } else if (this.player.isParryTiming) {
        this.assaltante.onPlayerParrySuccess();
        this.recordDefenseOnce('parry');
      } else if (!this.defenseRecordedThisAttack && this.player.isBlocking) {
        this.player.absorbBlockHit();
        this.recordDefenseOnce('block');
      } else if (!this.defenseRecordedThisAttack) {
        this.player.enterStagger();
        this.bus.emit('player.hit_unmitigated', {});
        this.defenseRecordedThisAttack = true; // no dim-4 label, but the window is "resolved"
      }
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
    const stepSeconds = stepMs / 1000;
    this.profile.record('distance', distance <= ATTACK_REACH ? stepSeconds : 0, stepSeconds);
  }

  private recordDefenseOnce(label: 'block' | 'parry'): void {
    if (this.defenseRecordedThisAttack) return;
    this.defenseRecordedThisAttack = true;
    this.profile.recordDefense(label);
  }
}
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS (todos os testes existentes + os novos).

- [ ] **Step 6: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/events.ts src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "feat: resolve the Assaltante's attack into dodge/parry/block/retreat/unmitigated-hit"
```

---

### Task 5: `HudState` — contador de hits sofridos

**Files:**
- Modify: `src/debug/hudState.ts`
- Modify: `src/debug/hudState.test.ts`

**Interfaces:**
- Consumes: `'player.hit_unmitigated'` (Task 4).
- Produces: `HudCounters.hitsUnmitigated: number` — consumido por Task 6 (`ArenaScene`).

- [ ] **Step 1: Ler o teste existente para seguir o padrão**

`src/debug/hudState.test.ts` já testa `dashAttempts`/`effectiveDashes`/`bossHitsLanded` com o mesmo `EventBus`+`bus.emit(...)` direto (sem passar por `Encounter`). O primeiro teste do arquivo, `'starts with zeroed counters'`, usa `toHaveBeenCalledWith` com um objeto **exato** — isso vai quebrar assim que `hitsUnmitigated` for adicionado ao objeto renderizado (igualdade exata deixa de bater), então esse teste precisa ser atualizado, não só o teste novo escrito.

- [ ] **Step 2: Atualizar o import e o teste existente, e escrever o teste novo (todos devem falhar)**

No topo de `src/debug/hudState.test.ts`, trocar a linha 4 por:

```ts
import { HudState, type HudCounters } from './hudState';
```

Atualizar o primeiro teste (`'starts with zeroed counters'`):

```ts
  it('starts with zeroed counters', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    expect(render).toHaveBeenCalledWith({
      dashAttempts: 0,
      effectiveDashes: 0,
      wastedDashes: 0,
      bossHitsLanded: 0,
      hitsUnmitigated: 0,
    });
  });
```

Adicionar ao final do arquivo, antes do `});` de fechamento do `describe`:

```ts
  it('counts unmitigated hits via player.hit_unmitigated', () => {
    const bus = new EventBus<GameEvents>();
    let latest: HudCounters | undefined;
    new HudState(bus, (c) => (latest = c));
    bus.emit('player.hit_unmitigated', {});
    bus.emit('player.hit_unmitigated', {});
    expect(latest?.hitsUnmitigated).toBe(2);
  });
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run src/debug/hudState.test.ts`
Expected: FAIL — `'starts with zeroed counters'` falha (objeto renderizado ainda não tem `hitsUnmitigated`), e o teste novo falha (`hitsUnmitigated` é `undefined`).

- [ ] **Step 4: Implementar**

Em `src/debug/hudState.ts`:

```ts
export interface HudCounters {
  dashAttempts: number;
  effectiveDashes: number;
  wastedDashes: number;
  bossHitsLanded: number;
  hitsUnmitigated: number;
}

export class HudState {
  private dashAttempts = 0;
  private effectiveDashes = 0;
  private bossHitsLanded = 0;
  private hitsUnmitigated = 0;

  constructor(
    private bus: EventBus<GameEvents>,
    private render: (counters: HudCounters) => void,
  ) {
    this.bus.on('player.dodge', () => {
      this.dashAttempts += 1;
      this.renderNow();
    });
    this.bus.on('player.hit_unmitigated', () => {
      this.hitsUnmitigated += 1;
      this.renderNow();
    });
    this.bus.on('opp.close', (e) => {
      if (e.type === 'dodge' && e.outcome === 'taken') {
        this.effectiveDashes += 1;
        this.renderNow();
      }
      if (e.type === 'punish' && e.outcome === 'taken') {
        this.bossHitsLanded += 1;
        this.renderNow();
      }
    });
    this.renderNow();
  }

  private renderNow(): void {
    this.render({
      dashAttempts: this.dashAttempts,
      effectiveDashes: this.effectiveDashes,
      wastedDashes: Math.max(0, this.dashAttempts - this.effectiveDashes),
      bossHitsLanded: this.bossHitsLanded,
      hitsUnmitigated: this.hitsUnmitigated,
    });
  }
}
```

- [ ] **Step 5: Rodar o teste para confirmar que passa**

Run: `npx vitest run src/debug/hudState.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: erros só em `src/scenes/ArenaScene.ts` (ainda inicializa `hudCounters` sem `hitsUnmitigated`) — corrigido na Task 6.

- [ ] **Step 7: Commit**

```bash
git add src/debug/hudState.ts src/debug/hudState.test.ts
git commit -m "feat: track unmitigated hits in HudState"
```

---

### Task 6: `ArenaScene` — rebind de teclas + HUD

**Files:**
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `PlayerController.startBlock()`/`stopBlock()`/`poise` (Task 1); `HudCounters.hitsUnmitigated` (Task 5).
- Produces: nada novo downstream — task final de wiring.

- [ ] **Step 1: Rebind da esquiva e nova tecla de guarda**

Em `src/scenes/ArenaScene.ts`, no bloco `this.keys = { ... }` (linha ~155-165), trocar:

```ts
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
```

por:

```ts
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      guard: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
```

E no tipo do campo `keys` (declaração da propriedade da classe, logo acima do construtor):

```ts
  private keys!: {
    weapon1: Phaser.Input.Keyboard.Key;
    weapon2: Phaser.Input.Keyboard.Key;
    weapon3: Phaser.Input.Keyboard.Key;
    charged: Phaser.Input.Keyboard.Key;
    dodge: Phaser.Input.Keyboard.Key;
    guard: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
```

- [ ] **Step 2: Ligar a guarda**

Logo depois de `this.keys.dodge.on('down', () => this.encounter.player.tryDodge());`:

```ts
    this.keys.guard.on('down', () => this.encounter.player.startBlock());
    this.keys.guard.on('up', () => this.encounter.player.stopBlock());
```

- [ ] **Step 3: Atualizar `hudCounters` inicial e `controlsText`**

No campo `hudCounters` da classe (declaração no topo, logo abaixo de `overlayText`/`hudText`):

```ts
  private hudCounters: HudCounters = {
    dashAttempts: 0,
    effectiveDashes: 0,
    wastedDashes: 0,
    bossHitsLanded: 0,
    hitsUnmitigated: 0,
  };
```

No array de linhas do `controlsText` (dentro de `create()`), trocar `'  K           - esquiva',` por:

```ts
        '  Espaço     - esquiva',
        '  E (segurar) - bloqueio / soltar no timing certo = parry',
```

(mantendo as demais linhas do array como estão).

- [ ] **Step 4: Adicionar as duas linhas de HUD**

Em `update()`, no array passado a `this.hudText.setText([...])`, adicionar duas linhas ao final:

```ts
    this.hudText.setText([
      `move: (${this.lastMoveInput.dx}, ${this.lastMoveInput.dy})`,
      `dash: ${this.encounter.player.isInvulnerable ? 'active (i-frames)' : 'idle'}`,
      `dashes: ${this.hudCounters.effectiveDashes} effective / ${this.hudCounters.wastedDashes} wasted`,
      `boss: ${this.encounter.assaltante.state} (${this.encounter.assaltante.activeRuleId ?? '-'})`,
      `boss hits landed: ${this.hudCounters.bossHitsLanded}`,
      `postura: ${Math.round(this.encounter.player.poise)}/100`,
      `hits sofridos: ${this.hudCounters.hitsUnmitigated}`,
    ]);
```

- [ ] **Step 5: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: PASS, 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: rebind dodge to Space, add guard on E, show poise and unmitigated hits in HUD"
```

---

### Task 7: Verificação final (suíte completa + checagem manual)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Suíte completa**

Run: `npm test`
Expected: PASS — todos os arquivos, incluindo os testes novos das Tasks 1-6.

Run: `npm run typecheck`
Expected: PASS, 0 erros.

- [ ] **Step 2: Checagem manual via dev server**

Run: `npm run dev` (background), abrir no navegador.

Roteiro:
1. Aproximar do Assaltante e deixar ele atacar sem reagir — confirmar que "hits sofridos" incrementa e o jogador trava brevemente (stagger).
2. Repetir aproximando e segurando **E** bem antes do golpe (bloqueio comum) — confirmar que "postura" cai no HUD, sem incrementar "hits sofridos".
3. Repetir segurando **E** só no último instante antes do golpe (parry) — confirmar que o Assaltante entra em `recovering` mais cedo (checável pelo texto de estado do boss no HUD) e que a postura não caiu dessa vez.
4. Repetir andando pra trás (WASD) assim que o Assaltante começar a atacar, sem apertar nada — confirmar que nem "postura" nem "hits sofridos" mudam (recuo bem-sucedido).
5. Confirmar que **Espaço** continua funcionando como esquiva (tecla antiga **K** não faz mais nada).

Se qualquer item falhar, voltar à task correspondente, corrigir, e repetir as Steps 1-2 desta task antes de prosseguir.

- [ ] **Step 3: Parar o dev server** (`TaskStop` ou equivalente) — nenhum commit nesta task, a menos que a Step 2 tenha exigido correções (nesse caso, commitar na task de origem do bug, não aqui).

---

## Self-Review Notes

**Cobertura do spec:**
- §3.1 (`PlayerState`) e §3.2 (constantes) → Task 1.
- §3.3 (bloqueio vs. parry por timing) → Task 1 (`isParryTiming`) + Task 4 (uso no `Encounter`).
- §4 (resolução dos 5 casos, precedência, guard `defenseRecordedThisAttack`) → Task 4.
- §4.1 (parry interrompe o golpe + punição bônus) → Task 3 + Task 4.
- §4.2 (recuo sem detecção especial) → Task 4 (via listener `opp.close`, ver nota de desvio no cabeçalho).
- §5 (`onExpire`/retreat) → implementado via listener de `Encounter`, não um novo `onExpire` em `AssaltanteController` (nota de desvio já registrada, comportamento observável idêntico).
- §6.1 (perfil) → Task 2. §6.2 (HUD) → Task 5 (contador) + Task 6 (texto/tecla).
- §2.3 critério de pronto: #1/#2 → testes de `Encounter` na Task 4. #3 → testes de `PlayerController` na Task 1. #4 → testes de `AssaltanteController` na Task 3. #5 → teste de recuo na Task 4. #6 → o guard `defenseRecordedThisAttack`, exercitado no teste "a full sequence..." da Task 4.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo de código tem o código completo; passos de verificação manual (Task 7) descrevem exatamente o que observar, não "testar o resto".

**Consistência de tipos:** `DefensiveLabel` (Task 2) usado em `ProfileAccumulator.recordDefense` e no parâmetro de `Encounter.recordDefenseOnce` (Task 4, restrito a `'block' | 'parry'` já que `'dodge'`/`'retreat'` têm seus próprios call-sites diretos). `PARRY_BONUS_RECOVERY_MS` (Task 1) importado e usado exatamente com esse nome em `AssaltanteController` (Task 3) e referenciado no teste da Task 3. `isBlocking`/`isParryTiming`/`absorbBlockHit`/`enterStagger` (Task 1) usados com essas assinaturas exatas em `Encounter.step()` (Task 4). `HudCounters.hitsUnmitigated` (Task 5) consumido com esse nome exato em `ArenaScene` (Task 6).

---

Plano completo e salvo em `docs/superpowers/plans/2026-09-07-kit-defensivo-postura.md`.

**Qual abordagem de execução?**

1. **Subagent-Driven (recomendado)** — dispatch de um subagente novo por task, revisão entre tasks, iteração rápida.
2. **Execução inline** — execução das tasks nesta sessão via `executing-plans`, em lote com checkpoints.
