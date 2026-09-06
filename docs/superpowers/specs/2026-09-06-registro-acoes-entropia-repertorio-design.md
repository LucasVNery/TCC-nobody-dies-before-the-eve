# Registro de Ações + Entropia de Repertório de Ações (dim 2) — Design

**Data:** 06/09/2026
**Sub-projeto:** primeiro da trilha "repertório de armas/ações do jogador"
**Depende de:** núcleo jogável (13/08), acumuladores decaídos (18/08), Família A dims 3+5 (18/08)
**Documento guarda-chuva:** `docs/especificacao-perfil-instrumentacao-v2.md` (revisado por D9 nesta rodada)

---

## 1. Contexto e objetivo

O jogo hoje tem duas ações de jogador: ataque leve e esquiva. Isso torna a **Família B do perfil** (entropia de repertório — dims 1, 2, 4) matematicamente quase degenerada e impossível de validar no Estudo 1. As dims de Família B são justamente as que medem "vício de repertório" e "criatividade", que estão no centro da pergunta da tese.

Este sub-projeto é a **primeira fatia vertical fina** da trilha de repertório: refatora o `PlayerController` para um modelo dirigido por dados, adiciona **uma** arma (espada+escudo) com três tipos de ação, e liga a **dim 2** (entropia de repertório de ações) de ponta a ponta até o `profile.snapshot`.

O objetivo é provar a cadeia inteira — *ação executada → evento → contagem decaída → entropia normalizada → snapshot* — com o mínimo de código, antes de construir 2ª/3ª armas e o kit defensivo em cima. Se a matemática da entropia tiver um problema de modelagem, ele aparece aqui e não depois.

### 1.1 Decisões de brainstorming que originam este design

| Decisão | Escolha |
|---|---|
| Acesso às armas | Jogador carrega as 3 armas, troca livre em combate (n=3 fixo para dim 1). *Não implementado neste sub-projeto — só há uma arma.* |
| Custo da troca | Recovery de ~250ms, cancelável por esquiva. *Fora de escopo aqui.* |
| Taxonomia da dim 2 | `{leve, pesado, carregado, arremesso, utilitário}`, **n = 5 fixo** (D9 — remove `aéreo`) |
| `carregado` | Não é ação à parte: é `actionType: 'charged'` + campo `charge` no mesmo `ActionDef`. Dano/reach escala **linearmente** com o tempo segurado. |
| Kit defensivo | Bloqueio e parry universais; escudo com bloqueio muito superior; barra de postura exclusiva do bloqueio. *Fora de escopo aqui.* |
| Só o boss adapta | Inimigos comuns têm IA fixa (instrumento de coleta estável). Registrado como contexto de pesquisa; sem efeito neste sub-projeto. |
| Fatiamento | Fatia vertical fina: refactor → 1 arma + dim 2 ponta-a-ponta → (depois) 2ª/3ª armas + dim 1 → (depois) kit defensivo + dim 4 |
| Registro de ações | Ação é **dado** numa tabela; máquina de estados genérica lê a tabela (opção 1 das 3 avaliadas) |

---

## 2. Escopo

### 2.1 Entra

- Refactor do `PlayerController` para máquina de estados genérica dirigida por `ActionDef`.
- `combat/actionRegistry.ts` — registro data-driven de ações, com `actionType` e `weaponId` carimbados no dado.
- **Uma arma** — `sword_shield` — com 3 ações: `light` (leve), `heavy` (pesado), `charged` (carregado).
- Mudança do schema de `player.action`: passa a carregar `actionId`, `actionType`, `weaponId`.
- `profile/decayedCount.ts` — `DecayedCount`, espelhando `DecayedRatio`.
- `profile/entropyAccumulator.ts` — `EntropyAccumulator` genérico sobre um conjunto de rótulos, com `κ_H = 25` e tratamento dos casos-limite `n<2`.
- Dim 2 (`'action_repertoire'`) ligada de ponta a ponta: `Encounter` → `EntropyAccumulator` → `profile.snapshot`.
- `ProfileAccumulator` passa a **coordenar** os `EntropyAccumulator`s (encaminha fronteiras de decaimento e reset; agrega no snapshot).
- Ajuste de tipo: `ProfileSnapshotPayload.domain` → `Record<SkillId, number | null>`.
- Revisão D9 aplicada em `especificacao-perfil-instrumentacao-v2.md` (feita nesta rodada).
- Apêndice "Ferramentas avaliadas" (§8) — material para o texto do TCC.

### 2.2 Não entra (sub-projetos seguintes)

- 2ª e 3ª armas (arco, arma pesada), troca de arma com recovery, **dim 1** (entropia de armas).
- Kit defensivo (recuo, bloqueio, parry, barra de postura, stagger), **dim 4**.
- Ações de tipo `arremesso` e `utilitário` implementadas de fato — só ficam **reservadas** na taxonomia (contam como "opção disponível não usada").
- Adaptação do boss, preditor de movimento, seleção de déficit-alvo, pesos de regra.
- Destino final da dim 7 (bloqueada por "sem eixo Z" — ver D9).
- Qualquer trabalho visual (prismas isométricos, sprites a partir de modelos 3D).

### 2.3 Critério de pronto

Um teste de integração que:
1. Instancia um `Encounter`, executa uma sequência conhecida de ações do jogador (ex: 6× `light`, 3× `heavy`, 1× `charged`).
2. Chama `applyRoomBoundary()` e `snapshot('room.exit')`.
3. Verifica que `snapshot.domain['action_repertoire']` é igual à entropia normalizada esperada dessa distribuição sobre n=5 (valor calculado à mão no teste).
4. Um segundo caso: só `light` executado → `snapshot.domain['action_repertoire']` é `null` (n efetivo < 2), e a skill **não** pode ser déficit-alvo.

---

## 3. Modelo de dados

### 3.1 `ActionDef` e registro

```ts
// combat/actionRegistry.ts
export type ActionType = 'light' | 'heavy' | 'charged' | 'throw' | 'utility';

export interface ChargeSpec {
  minHoldMs: number;   // hold mínimo para disparar a fase ativa
  maxHoldMs: number;   // hold além disso não adiciona (clamp)
}

export interface ActionDef {
  id: string;              // 'sword_shield.light'
  weaponId: string;        // 'sword_shield'
  actionType: ActionType;
  timing: ActionPhaseTiming;   // startup/active/recovery — reusa o tipo de actionDefs.ts
  reach: number;
  charge?: ChargeSpec;     // presente sse e só se actionType === 'charged'
}

export const ACTION_REGISTRY: ReadonlyMap<string, ActionDef> = buildRegistry([
  SWORD_SHIELD_ACTIONS,
]);

export function resolveAction(id: string): ActionDef;   // lança se id desconhecido
```

`ACTION_TYPES: readonly ActionType[]` — a lista canônica dos 5 tipos (n=5), exportada para o `EntropyAccumulator` consumir. `'throw'` e `'utility'` estão na lista mas não têm `ActionDef` correspondente neste sub-projeto.

### 3.2 Ações da `sword_shield`

| id | actionType | startup | active | recovery | reach | charge |
|---|---|---|---|---|---|---|
| `sword_shield.light` | `light` | 100 | 100 | 150 | 45 | — |
| `sword_shield.heavy` | `heavy` | 220 | 120 | 300 | 55 | — |
| `sword_shield.charged` | `charged` | 150 (mín) | 140 | 350 | 50→70 | `{minHoldMs: 150, maxHoldMs: 900}` |

Números são ponto de partida para tuning, não sagrados. `charged`: reach e dano interpolam linearmente entre o valor base (hold = `minHoldMs`) e o valor máximo (hold ≥ `maxHoldMs`).

### 3.3 Schema de evento

```ts
// core/events.ts — BREAKING CHANGE
export interface PlayerActionPayload {
  actionId: string;        // era: action: ActionId
  actionType: ActionType;  // novo — o que a dim 2 conta
  weaponId: string;        // novo — o que a dim 1 vai contar (sub-projeto futuro)
  opp_id?: string;         // inalterado
}
```

Consumidores a atualizar: `Encounter` (handler de `player.action` em `encounter.ts:26`), HUD de debug (`debug/hudState.ts` se referenciar `action`), qualquer teste que emita ou escute `player.action`.

`dodge` **não** passa mais por `player.action` como "ação" de Família B — ele é defensivo e entra na dim 4 num sub-projeto futuro. Se hoje ele emite `player.action`, passa a emitir um evento separado (`player.dodge`) ou um `actionType` que o `EntropyAccumulator` da dim 2 ignora explicitamente. **Decisão:** evento separado `player.dodge`, para não poluir a taxonomia de ação com um membro que não pertence ao conjunto D9.

---

## 4. Refactor do `PlayerController`

### 4.1 Estados

`'idle' | 'acting' | 'dodging'` (discriminated union + switch exaustivo — sem lib de FSM, ver §8).

- `currentAction: ActionDef | null` — a ação em curso quando `state === 'acting'`.
- `chargeHeldMs: number` — acumulado enquanto o input de uma ação `charged` está segurado.

### 4.2 API

| Antes | Depois |
|---|---|
| `tryLightAttack()` | `tryAction(actionId: string)` — valida `state==='idle'`, resolve no registro, entra em `'acting'` |
| — | `releaseAction()` — solta uma ação `charged` segurada (dispara fase ativa; no-op para não-`charged`) |
| `tryDodge()` | inalterado (só muda o nome do estado no enum) |
| `attackHitbox()` | lê `currentAction.reach` e `currentAction.timing` em vez das consts `LIGHT_ATTACK` |

### 4.3 Ciclo de vida de `charged`

1. `tryAction('sword_shield.charged')` → estado `'acting'`, `chargeHeldMs = 0`, fase = startup.
2. Enquanto input segurado **e** `chargeHeldMs < charge.maxHoldMs`: permanece em startup, acumula `chargeHeldMs`.
3. `releaseAction()` **ou** `chargeHeldMs >= maxHoldMs` → se `chargeHeldMs >= minHoldMs`, dispara fase ativa com `reach`/dano interpolados; senão, cancela para `'idle'` sem hitbox.
4. Fase ativa → recovery → `'idle'`, como as ações normais.

### 4.4 `actionDefs.ts`

`LIGHT_ATTACK` sai (vira entrada no registro). `DODGE` e `DodgeTiming` permanecem. `ActionPhaseTiming` e `totalDurationMs` permanecem (reusados pelo `ActionDef`).

---

## 5. Instrumentação da Família B

### 5.1 `DecayedCount`

```ts
// profile/decayedCount.ts — espelha DecayedRatio
export class DecayedCount {
  add(n = 1): void;          // buffer em pending
  decay(gamma: number): void; // count = gamma*count + pending; pending = 0
  reset(): void;
  get value(): number;
}
```

### 5.2 `EntropyAccumulator`

```ts
// profile/entropyAccumulator.ts
export class EntropyAccumulator {
  constructor(labels: readonly string[], kappa = 25);

  record(label: string): void;   // add(1) no DecayedCount do rótulo, nos DOIS relógios
  decayTrait(gamma: number): void;
  decayState(gamma: number): void;
  reset(): void;

  domain(clock: Clock): number | null;   // H normalizada; null nos casos-limite
  deficit(clock: Clock): number | null;  // 1 - domain, ou null
  confidence(clock: Clock): number;       // total / (total + kappa)
  totalCount(clock: Clock): number;
  counts(clock: Clock): Record<string, number>;
}
```

`record()` com um `label` fora de `labels` lança — protege contra rótulo digitado errado silenciosamente virando uma categoria fantasma.

### 5.3 Matemática

```
p_i = count_i / Σ count      (i sobre rótulos com count > 0)
H   = −Σ p_i · ln(p_i) / ln(n)      n = labels.length  (FIXO em 5, não o nº de rótulos usados)
```

### 5.4 Casos-limite (§3.3 da spec de perfil)

| Situação | `domain()` | Conta p/ confiança | Pode ser déficit-alvo |
|---|---|---|---|
| `totalCount == 0` | `null` | não | não |
| exatamente 1 rótulo com `count > 0` | `null` | sim | **não** |
| ≥ 2 rótulos com `count > 0` | `H ∈ [0, 1]` | sim | sim |

A distinção `null`-por-zero-amostras vs. `null`-por-um-rótulo-só é registrada internamente (o snapshot só expõe `domain: null` nos dois casos, mas a lógica de seleção de déficit-alvo — sub-projeto futuro — precisa saber que "um rótulo só" já tem evidência).

### 5.5 Coordenação pelo `ProfileAccumulator`

`ProfileAccumulator` ganha `private entropyDims: Map<SkillId, EntropyAccumulator>`, populado no construtor (por ora: `'action_repertoire'` → `new EntropyAccumulator(ACTION_TYPES)`).

- `applyRoomBoundary()` / `applyEncounterBoundary()` / `resetSession()` — passam a encaminhar para cada `EntropyAccumulator` além de fazerem o que já fazem para as razões. **Uma só porta de ciclo de vida para o `Encounter`.**
- `snapshot(at)` — passa a agregar as dims de entropia junto com as de razão, na mesma estrutura. Dims de Família B com `domain == null` aparecem no payload com `domain: null` **explícito** (não omitidas — a análise precisa saber que a dimensão foi observada).
- `domain(skill, clock)` / `confidence(skill, clock)` / `deficit(skill, clock)` — passam a rotear para o `EntropyAccumulator` quando `skill` é uma dim de Família B.

### 5.6 Ligação no `Encounter`

```ts
this.bus.on('player.action', (e) => {
  this.profile.recordAction(e.actionType);   // -> entropyDims.get('action_repertoire').record(...)
});
```

`recordAction` é um método novo, fino, no `ProfileAccumulator` (paralelo a `record` / `recordOutcome`). `arremesso` e `utilitário` nunca disparam neste sub-projeto — o rótulo existe no conjunto, então contam como opção disponível não usada, que é o comportamento correto para a entropia.

---

## 6. Mudanças em `ProfileSnapshotPayload`

```ts
export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  counts: Record<SkillId, [number, number]>;   // Família A: [num, den]. Família B: [rótulos distintos usados, total] (informativo)
  domain: Record<SkillId, number | null>;      // <- number | null (era number)
  confidence: Record<SkillId, number>;
  target: SkillId | null;   // ainda sempre null
  lambda: number;           // ainda sempre 0
}
```

`counts` para Família B: guardar `[nº de rótulos distintos com count>0, totalCount]` como resumo — suficiente para o replay/análise reconstruir o regime sem carregar o vetor inteiro. (Vetor completo fica disponível via `entropyAccumulator.counts()` se o Estudo 1 precisar; não vai pro payload por ora.)

---

## 7. Estratégia de testes (TDD, Vitest)

| Unidade | Testes-chave |
|---|---|
| `DecayedCount` | buffer não afeta `value` antes de `decay`; `decay` aplica `gamma*old + pending`; `reset` zera tudo (espelha `decayedRatio.test.ts`) |
| `EntropyAccumulator` | `H==1` (dentro de ε) para distribuição uniforme sobre 5; `H==ln(2)/ln(5)` para 50/50 sobre 2 de 5; `null` para 0 amostras; `null` para 1 rótulo só; `confidence` monotônica crescente e → 1; `record` de rótulo desconhecido lança; `decayTrait`/`decayState` independentes |
| `actionRegistry` | `resolveAction` retorna o def certo; id desconhecido lança; `charge` presente ⟺ `actionType==='charged'`; `ACTION_TYPES` tem 5 membros |
| `PlayerController` (reescrito) | `tryAction` resolve pelo registro; id desconhecido rejeitado sem trocar de estado; `light`/`heavy` ciclo startup→active→recovery→idle; `charged` solto antes de `minHoldMs` cancela sem hitbox; `charged` segurado além de `maxHoldMs` faz clamp; `attackHitbox` usa `reach`/`timing` do `ActionDef`; dodge inalterado; não é possível `tryAction` durante `acting`/`dodging` |
| `ProfileAccumulator` (estendido) | `recordAction` alimenta a dim de entropia; `applyRoomBoundary` decai razão **e** entropia; `resetSession` limpa as duas; `snapshot` inclui `action_repertoire` com `domain` numérico ou `null`; `domain('action_repertoire', clock)` roteia para o `EntropyAccumulator` |
| `Encounter` (integração) | sequência conhecida de `tryAction` → `snapshot('room.exit').domain['action_repertoire']` == valor calculado à mão; caso "só `light`" → `null`; evento `player.action` carrega `actionType`/`weaponId` corretos |

Determinismo: nenhuma das unidades novas usa tempo real ou `Math.random` — `EntropyAccumulator` e `DecayedCount` são puros; `PlayerController` é dirigido por `stepMs` como hoje.

---

## 8. Apêndice — ferramentas, libs e assets avaliados

Material para a seção de decisões técnicas do TCC. Frente por frente, o que foi considerado e por que foi ou não adotado.

### 8.1 Máquina de estados (`PlayerController`)

| Opção | Veredito |
|---|---|
| **XState** | Rejeitado. Statecharts hierárquicos e visualizador são poderosos, mas é dependência grande e orientada a configuração declarativa que destoa do estilo imperativo/funcional de `combat/`. A máquina do player tem 3 estados. |
| **fiume / robot** (FSMs minimalistas, zero-dependência) | Rejeitado. Ainda é lib para um problema de 3 estados. |
| **Máquina à mão** (discriminated union + switch exaustivo) | **Adotado.** É o padrão que o resto do código já usa; o compilador TypeScript garante exaustividade. |

### 8.2 Cálculo de entropia

| Opção | Veredito |
|---|---|
| `shannon-entropy` (npm) | Rejeitado. Descontinuado (sem release há +12 meses). |
| `binary-shannon-entropy` (npm) | Rejeitado. Opera sobre buffers binários e log base 2 não normalizado; não faz o que a §3.2 pede (entropia normalizada por `ln(n)` com `n` fixo). |
| **Implementação própria** (~8 linhas em `EntropyAccumulator`) | **Adotado.** Mais fácil de testar e auditar para a banca do que justificar uma dependência. |

### 8.3 Combate data-driven / hitbox em Phaser

Não existe lib madura de "sistema de combate data-driven" para Phaser 3. `phaser3-hadoken` resolve *sequências de input* (comandos estilo jogo de luta), não ciclo de vida de ação/hitbox. O projeto já tem colisão AABB determinística própria (`combat/collision.ts`). **Nada a adotar.**

### 8.4 Assets / placeholders 3D

| Recurso | Licença | Aplicabilidade |
|---|---|---|
| [Kenney — Prototype Kit](https://kenney.nl/assets/prototype-kit) (145 peças) | CC0 | Blockout/prototipagem. Phaser é 2D → exige pré-renderizar sprites via Blender headless (mini-pipeline). **Opção para sub-projeto visual futuro, não agora.** |
| [Kenney — Blocky Characters](https://kenney.nl/assets/blocky-characters) (20 modelos, 27 animações) | CC0 | "Boneco 3D de prototipagem" pronto. Mesma ressalva de pipeline. **Sub-projeto visual futuro.** |
| [KayKit](https://kaylousberg.com) / Quaternius | CC0 | Packs low-poly (personagens, dungeon). Mesma ressalva. **Sub-projeto visual futuro.** |

**Recomendação para agora:** desenhar prismas isométricos (3 faces com tons diferentes) direto em `src/visual/`, com hitboxes de ataque como volumes projetados na mesma malha isométrica. Custo quase zero, sem dependência, sem pipeline — e entrega a leitura "caixa 3D + margens de hitbox 3D" pedida. Migração para Three.js/Babylon fica registrada como sub-projeto visual futuro possível (a separação lógica/visual atual sobreviveria: `combat/`, `opportunity/`, `ai/`, `profile/` ficam intactos).

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor do `PlayerController` quebra combate silenciosamente | TDD: os testes de ciclo de vida de ação são escritos **antes** e cobrem o comportamento atual do `light_attack` antes de generalizar. |
| Dessincronização dos relógios trait/state entre razão e entropia | `ProfileAccumulator` é a **única** porta de ciclo de vida; encaminha para os dois. Teste explícito de que `applyRoomBoundary` decai ambos. |
| `n` fixo em 5 com 2 tipos nunca usados (`throw`/`utility`) puxa a entropia pra baixo "artificialmente" | É o comportamento **correto** e intencional: são opções disponíveis não usadas = déficit real de repertório. Documentado na §5.6 e na D9. Revisitar só se o Estudo 1 mostrar que a dim 2 tem ICC ruim por causa disso. |
| Escopo escorregar para incluir 2ª arma / dim 1 | Critério de pronto (§2.3) é sobre a dim 2 e uma arma. 2ª/3ª armas são sub-projeto separado com spec própria. |

---

## 10. Trilha completa (contexto — só o passo 1 é este sub-projeto)

1. **[este doc]** Registro de ações + dim 2, com espada+escudo.
2. Arco + arma pesada + troca de arma (recovery 250ms) → **dim 1** (entropia de armas, n=3).
3. Kit defensivo: recuo, bloqueio, parry, barra de postura, stagger → **dim 4** (repertório defensivo, n=4).
4. Definição do predicado "janela segura" → **dim 6** (paciência).
5. Seleção de déficit-alvo com histerese (passo 6 do §8 da spec de perfil).
6. Pesos de regra + boss adaptativo + preditor de movimento (passo 7).

Estudo 1 pode rodar ao fim do passo 4.
