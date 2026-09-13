# Predicado de "Janela Segura" (dim 6 — paciência/comprometimento) — Design

**Data:** 12/09/2026
**Sub-projeto:** #4 da trilha de repertório (`Contexto_pesquisa/instrumento-perfil-adaptativo.md` §5), primeiro passo depois do fix do leque de ataque
**Depende de:** `combat/sector.ts` (`directionalSector`, `sectorOverlapsBox`), `combat/movement.ts` (`normalizeVelocity`), `combat/actionRegistry.ts` (`ActionDef`, `resolveAction`), `profile/profileAccumulator.ts` (`record()`)
**Documentos relacionados:** `docs/especificacao-perfil-instrumentacao-v2.md` §3.1 ("Definição pendente de 'janela segura'"), `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §3 (dim 6, hoje 🟡 Bloqueada)

---

## 1. Contexto e objetivo

A dim 6 (paciência/comprometimento, Família A) mede `ataques iniciados em janela segura / total de ataques iniciados`. A definição em prosa — "ausência de hitbox inimiga ativa ou telegrafada que alcance o jogador dentro do tempo de recuperação da ação escolhida" — nunca virou predicado implementável. Essa é a única dimensão de Família A ainda bloqueada por decisão de design (não por falta de conteúdo de jogo, como as de Família B).

Hoje só existe um arquétipo (Assaltante) com uma única regra determinística: ataca sempre que `distanceToPlayer <= ATTACK_RANGE (60)`, num ciclo `idle/chasing → attacking (telegraph 400ms + swing 150ms) → recovering (500ms) → idle`. Mas a regra da própria trilha (confirmada nesta rodada) é que só o **boss** vai ler o perfil pra se adaptar — inimigos comuns (como o Assaltante) só emitem sinal pro instrumento, com mecânicas próprias e fixas, focadas em manter a gameplay fluida. Isso não muda o predicado em si, mas confirma que ele deve ser genérico o bastante pra qualquer arquétipo futuro reportar ameaça à sua própria maneira, sem forçar todos pela mesma máquina de estados.

### 1.1 Decisões de brainstorming desta rodada

| Decisão | Escolha |
|---|---|
| Escopo do predicado | Modelo genérico (`ThreatAssessor`), não uma checagem hard-coded pro Assaltante — arquétipos futuros com alcance/timing diferentes implementam a mesma interface. |
| Posição do jogador durante a exposição | Jogador fica travado (sem se mover, sem se defender) durante `startupMs + activeMs + recoveryMs` da ação escolhida — confirmado no código (`PlayerController.step()` só processa `moveInput` em `state === 'idle'`). |
| Janela de exposição usada | **Commitment total** (`startupMs + activeMs + recoveryMs`), não só `recoveryMs` como a prosa original sugeria — mede o risco real de decidir atacar, não só o risco pós-golpe. |
| Mecanismo de previsão | Simulação determinística da máquina de estados do inimigo (por transição de fase, não frame a frame) reaproveitando a mesma geometria já testada do leque (`directionalSector`/`sectorOverlapsBox`) — evita duplicar a lógica de colisão numa segunda fórmula que poderia divergir da real (mesma classe de bug do hitbox diagonal). |
| Onde a lógica de FSM vive | Extraída de `AssaltanteController.step()` para uma função pura e reutilizável (`predictThreatMs`), parametrizada por config + snapshot — o inimigo ao vivo e a previsão compartilham a mesma matemática, uma única fonte de verdade. |

---

## 2. Escopo

### 2.1 Entra

- `src/combat/threatPrediction.ts` (novo): `ChaseTelegraphConfig`, `ChaseTelegraphSnapshot`, `predictThreatMs(config, snapshot, target, horizonMs)` — simulador puro e genérico para qualquer inimigo com o formato `idle/chasing → attacking(telegraph+swing) → recovering`.
- `src/combat/patience.ts` (novo): `ThreatAssessor` (interface: `msUntilThreatens(target, horizonMs)`), `isPatientAttack(commitmentMs, threats, target)` — combinador genérico entre inimigos.
- `src/combat/assaltanteController.ts`: implementa `ThreatAssessor` delegando para `predictThreatMs` com sua própria config (`TELEGRAPH_MS`, `SWING_MS`, `RECOVERY_MS`, `ATTACK_RANGE`, `ASSALTANTE_CHASE_SPEED`, `ATTACK_REACH + width/2`, `ATTACK_HALF_ANGLE_RAD`).
- `src/combat/actionRegistry.ts`: `export function totalCommitmentMs(action: ActionDef): number` — extrai a fórmula que hoje só existe inline em `PlayerController.stepActing()`, reaproveitada também pelo hook da dim 6.
- `src/combat/playerController.ts`: `stepActing()` passa a chamar `totalCommitmentMs(action)` em vez da ternária inline (refactor puro, sem mudança de comportamento).
- `src/combat/encounter.ts`: no handler de `player.action`, calcula `commitmentMs` via `totalCommitmentMs(resolveAction(e.actionId))`, chama `isPatientAttack(commitmentMs, [this.assaltante], this.player.hurtbox())` e grava `this.profile.record('patience', isPatient ? 1 : 0, 1)`.
- Testes novos: `threatPrediction.test.ts`, `patience.test.ts`, casos novos em `assaltanteController.test.ts` e `encounter.test.ts`.
- Atualizar a linha da dim 6 nos dois documentos de referência (`instrumento-perfil-adaptativo.md` §3, `especificacao-perfil-instrumentacao-v2.md` §3.1) de 🟡 Bloqueada para ✅ Ligada.

### 2.2 Não entra

- Qualquer mudança de comportamento do Assaltante — a previsão só *observa* o estado atual dele, não altera a regra de ataque (`assaltanteRules.ts` inalterado).
- Seleção de déficit-alvo / boss adaptativo lendo a dim 6 — isso é o sub-projeto #5 da trilha (`snapshot.target` continua sempre `null`).
- Múltiplos inimigos simultâneos — `isPatientAttack` já aceita uma lista de `ThreatAssessor`, mas hoje `Encounter` só tem um Assaltante; não há mudança na composição de inimigos nesta rodada.
- Suporte a arquétipos com FSM diferente (ex: atirador à distância sem fase de perseguição) — `predictThreatMs`/`ChaseTelegraphConfig` cobrem o formato "persegue → telegrafa → golpeia → recupera"; um arquétipo futuro com forma diferente escreve seu próprio `msUntilThreatens`, sem reaproveitar `predictThreatMs`. Não é uma lacuna desta rodada, é o ponto — a interface é genérica, o simulador não precisa ser.

### 2.3 Critério de pronto

1. Um ataque iniciado com o Assaltante longe e parado (fora de alcance, sem chance de fechar distância + telegrafar dentro do `commitmentMs` da ação) é gravado como `patient` (numerador 1).
2. Um ataque iniciado com o Assaltante em pleno telegraph, mirado (direção que efetivamente alcançaria o jogador), é gravado como não-`patient` (numerador 0).
3. Um ataque iniciado com o Assaltante em `recovering`, mas com tempo restante de recovery + telegraph maior que o `commitmentMs` da ação escolhida, ainda é gravado como `patient` — a previsão não superestima o risco de um inimigo temporariamente incapaz de agir.
4. `predictThreatMs` retorna o mesmo veredito (`null` vs. não-`null`) que a colisão real produziria se o tempo se passasse exatamente como simulado — validado comparando a simulação com uma chamada real a `Encounter.step()` em loop pelo mesmo intervalo, no teste de integração mais crítico do arquivo `encounter.test.ts`.
5. `totalCommitmentMs` é a única fonte da fórmula de duração total de uma ação — `PlayerController.stepActing()` e o hook da dim 6 em `Encounter` chamam a mesma função, sem fórmula duplicada.
6. A dim 6 aparece no `profile.snapshot()` depois de pelo menos um ataque iniciado + uma `applyRoomBoundary()`, com `counts.patience` refletindo os ataques pacientes/totais.

---

## 3. `combat/threatPrediction.ts` — o simulador genérico

```ts
import type { AABB, Vec2 } from './types';
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
  state: 'idle' | 'chasing' | 'attacking' | 'recovering';
  phaseElapsedMs: number;
  position: Vec2; // canto superior esquerdo — mesma convenção de assaltanteRules.distanceToPlayer
  width: number;
  height: number;
  attackDirection: Vec2; // só relevante quando state === 'attacking'
}

const MAX_ITERATIONS = 8; // um ciclo completo (telegraph+swing+recovery) nunca cabe mais que ~2x num horizonte típico

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
        continue; // a transição em si não consome tempo
      }

      const closeMs = ((distance - config.attackRange) / config.chaseSpeedPxPerSec) * 1000;
      if (elapsed + closeMs > horizonMs) return null;

      const direction = normalizeVelocity(dx, dy);
      position = {
        x: position.x + direction.x * (distance - config.attackRange),
        y: position.y + direction.y * (distance - config.attackRange),
      };
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

  return null; // válvula de segurança — não deveria ser alcançado dado o horizonte típico
}
```

**Por que não precisa mover `position` durante `attacking`/`recovering`:** o inimigo não anda nesses estados (só em `idle`/`chasing`), então a única atualização de posição necessária é quando ele fecha distância perseguindo — capturada no único `position = {...}` do ramo `idle`/`chasing`.

**Por que a checagem do leque é feita com `sector` recomputado a cada laço:** a direção do ataque é travada no momento em que o inimigo entra em `attacking` (seja porque já estava perseguindo e chegou ao alcance, seja num segundo ciclo depois de recuperar) — reaproveitar `directionalSector`/`sectorOverlapsBox` garante que a previsão usa exatamente a mesma geometria que decide colisões reais em `Encounter.step()`.

---

## 4. `combat/patience.ts` — o combinador genérico

```ts
import type { AABB } from './types';

export interface ThreatAssessor {
  msUntilThreatens(target: AABB, horizonMs: number): number | null;
}

export function isPatientAttack(commitmentMs: number, threats: ThreatAssessor[], target: AABB): boolean {
  return threats.every((threat) => threat.msUntilThreatens(target, commitmentMs) === null);
}
```

Vago o suficiente pra qualquer arquétipo futuro implementar `ThreatAssessor` com sua própria lógica interna (inclusive um que não use `predictThreatMs`/`ChaseTelegraphConfig` — ex: um atirador cujo "alcance" não depende de perseguição).

---

## 5. `AssaltanteController` — implementando `ThreatAssessor`

`ATTACK_RANGE` já existe em `ai/rules/assaltanteRules.ts` mas não é importado por `assaltanteController.ts` hoje — precisa entrar na linha 7 junto com `ASSALTANTE_RULES`.

```ts
import { ASSALTANTE_RULES, ATTACK_RANGE, type Blackboard } from '../ai/rules/assaltanteRules';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';
import type { ThreatAssessor } from './patience';

export class AssaltanteController implements ThreatAssessor {
  // ...

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
      reach: ATTACK_REACH + this.width / 2, // mesmo ajuste que attackHitbox() já faz hoje
      halfAngleRad: ATTACK_HALF_ANGLE_RAD,
    };
    return predictThreatMs(config, snapshot, target, horizonMs);
  }
}
```

---

## 6. `actionRegistry.ts` — `totalCommitmentMs`

```ts
export function totalCommitmentMs(action: ActionDef): number {
  return action.actionType === 'charged'
    ? action.timing.activeMs + action.timing.recoveryMs
    : action.timing.startupMs + action.timing.activeMs + action.timing.recoveryMs;
}
```

Extraída literalmente da ternária que já existe em `PlayerController.stepActing()` (linhas 278-281 hoje). `stepActing()` passa a chamar essa função; nenhuma mudança de comportamento.

**Por que a ação carregada usa só `activeMs + recoveryMs`:** o evento `player.action` (que dispara o hook da dim 6) só é emitido em `releaseAction()`/no auto-trigger de `maxHoldMs` — nesse momento `phaseElapsedMs` já foi zerado e o `startupMs` (que nas ações carregadas é só documentacional, dirigido por `charge.minHoldMs`/`maxHoldMs`) já foi todo consumido durante o hold. O commitment que resta a partir do instante do evento é exatamente `activeMs + recoveryMs` — coerente com o que `stepActing()` já usa pra decidir quando a ação termina.

---

## 7. `Encounter` — o hook da dim 6

```ts
import { resolveAction, totalCommitmentMs } from './actionRegistry';
import { isPatientAttack } from './patience';

// dentro do handler existente de 'player.action':
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

`this.player.hurtbox()` no momento do evento já reflete a posição travada (o jogador entrou em `'acting'` na mesma chamada de `tryAction()`/`releaseAction()` que emitiu o evento, antes de qualquer `step()` rodar) — corresponde exatamente à posição que o jogador vai manter durante todo o `commitmentMs`.

---

## 8. Testes

Três camadas, mesmo padrão do resto de `combat/`:

**`threatPrediction.test.ts`** (puro, isolado):
- Inimigo `idle`, longe, horizonte curto demais pra fechar distância + telegrafar → `null`.
- Inimigo `idle`, perto o bastante pra fechar distância + telegrafar dentro do horizonte → retorna o ms exato (fechar + telegraph).
- Inimigo `attacking` em telegraph, mirado no alvo, horizonte cobre o telegraph restante → retorna o ms exato.
- Inimigo `attacking` mirado **longe** do alvo (setor não sobrepõe) e o horizonte não é longo o bastante pra cobrir um novo ciclo completo (telegraph+swing+recovery+telegraph) → `null` — o caso que prova que o predicado não superestima risco de um golpe que geometricamente vai errar.
- Mesmo cenário acima, mas com horizonte longo o bastante pra cobrir o próximo ciclo → retorna o ms do *segundo* ataque.
- Inimigo `recovering`, horizonte curto demais pra cobrir recovery restante + telegraph → `null`.
- Inimigo `recovering`, horizonte suficiente → retorna o ms exato.

**`patience.test.ts`** (puro, isolado):
- Lista vazia de ameaças → `true` (vacuamente seguro).
- Uma ameaça retornando `null` → `true`.
- Uma ameaça retornando não-`null` → `false`.
- Duas ameaças, uma segura e outra não → `false` (qualquer ameaça real barra a janela).

**`assaltanteController.test.ts`** (integração com o estado real):
- `msUntilThreatens()` com o Assaltante recém-criado (idle, longe) e horizonte curto → `null`.
- `msUntilThreatens()` depois de `step()` colocar o Assaltante em `attacking`, mirado corretamente → não-`null`, valor bate com `TELEGRAPH_MS - phaseElapsedMs`.

**`encounter.test.ts`** (o critério de pronto mais importante — §2.3 item 4):
- Simular o Assaltante longe/parado, iniciar um ataque do jogador (`sword_shield.light`), chamar `applyRoomBoundary()` e verificar via `snapshot('room.exit')` que `counts.patience` é `[1, 1]` (contagem bruta, não `domain()` — que aplica suavização Beta e não seria exatamente `1` mesmo com um único registro paciente).
- Simular o Assaltante em pleno telegraph mirado no jogador, iniciar um ataque do jogador, verificar `counts.patience` é `[0, 1]`.
- Teste de equivalência: para um cenário fixo (Assaltante em `recovering` com X ms restantes), comparar o veredito de `predictThreatMs` contra rodar `Encounter.step()` de verdade pelo mesmo `commitmentMs` e checar se um hit realmente ocorreu (`player.hit_unmitigated` emitido ou não) — os dois devem concordar.

---

## 9. Atualização de documentação

Depois da implementação, atualizar:
- `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §3: dim 6 de 🟡 Bloqueada para ✅ Ligada; §4 roadmap (passo 5, "Família B" nota) permanece igual — dim 6 é Família A, não faz parte do passo 5.
- `docs/especificacao-perfil-instrumentacao-v2.md` §3.1: remover a nota "Definição pendente de 'janela segura'" (§3.1) e a entrada correspondente na lista de "Novas, criadas por esta especificação" ao final do documento.

---

## 10. Pendências conhecidas (não bloqueantes)

| Item | Detalhe | Quando vale a pena resolver |
|---|---|---|
| `predictThreatMs` assume o jogador **sempre parado** no alvo passado | Correto para o uso atual (o jogador está travado durante o próprio commitment), mas se algum dia o predicado precisar avaliar "seria seguro esperar aqui" (fora do momento de commit), essa suposição não vale mais. | Só se a dim 6 (ou outra) precisar prever segurança de uma posição hipotética, não de um ataque já commitado. |
| `ChaseTelegraphConfig`/`predictThreatMs` cobrem só o formato "persegue → telegrafa → golpeia → recupera" | Um arquétipo com fase de recarga variável, múltiplos golpes por ciclo, ou ataque à distância sem perseguição precisa de seu próprio `ThreatAssessor`, não de `predictThreatMs`. | Quando o próximo arquétipo (não-Assaltante) entrar na trilha. |
| `MAX_ITERATIONS = 8` é uma válvula de segurança, não uma garantia matemática | Com os valores atuais (`TELEGRAPH_MS=400, SWING_MS=150, RECOVERY_MS=500`) um ciclo completo dura ~1050ms; o maior `commitmentMs` do jogo hoje (`heavy_weapon.heavy`, 890ms) cabe em menos de 1 ciclo, então 8 iterações é generoso. Se timings mudarem drasticamente (ciclo do inimigo muito mais curto, ou uma ação do jogador com `commitmentMs` muito maior), reavaliar o valor. | Se/quando novos valores de timing forem introduzidos numa arma ou inimigo futuro. |

---

Spec escrito e pronto para revisão. Próximo passo após aprovação: `superpowers:writing-plans`.
