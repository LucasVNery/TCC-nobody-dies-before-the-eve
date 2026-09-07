# Kit Defensivo + Barra de Postura (dim 4) — Design

**Data:** 07/09/2026
**Sub-projeto:** terceiro da trilha "repertório de armas/ações do jogador" (§5 do doc de referência)
**Depende de:** dim 1 e dim 2 já mescladas em master (commits `939a521`, `0c9bee4`) — `EntropyAccumulator` genérico e o padrão `recordAction`/`recordDefense` reaproveitados sem mudança de infraestrutura
**Documento guarda-chuva:** `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §5.1 (decisões de repertório já travadas) e §3 (registro das 7 dimensões)

---

## 1. Contexto e objetivo

Os sub-projetos 1 e 2 ligaram as dims 1 (repertório de armas) e 2 (repertório de ações) ao `ProfileAccumulator`, provando a cadeia *ação → evento → entropia → snapshot* duas vezes. Este sub-projeto fecha o **passo 5 do roadmap de 7 passos** (Família B completa) ligando a **dim 4** (repertório defensivo): hoje só existe esquiva (`tryDodge`, com i-frames); faltam bloqueio, recuo e contra-ataque (parry) para dar `n = 4` rótulos à dimensão.

Diferente das dims 1/2, que só precisaram de uma nova instância de `EntropyAccumulator` sobre mecânica já existente, a dim 4 exige mecânica de jogo nova: bloqueio e parry não existem hoje em nenhuma forma. Boa parte deste documento é sobre essa mecânica, não sobre o acumulador em si (que é a parte mais simples e já validada duas vezes).

### 1.1 Achado que motivou uma pergunta de escopo

O código atual não tem **nenhuma consequência** para o jogador ser atingido pelo Assaltante sem esquivar — `Encounter.step()` só reage a esquiva bem-sucedida. Isso é coerente com a filosofia "instrumento de medição, não jogo", mas sem custo de ignorar o telegraph, bloquear/recuar/parry virariam rótulos sem sinal real por trás. Decisão tomada nesta rodada: **hit não mitigado vira um contador HUD ("hits sofridos") + stagger breve**, sem HP. Um sistema de HP/dano completo (com contagem de mortes) fica registrado como sub-projeto futuro de coleta de dados, não faz parte deste documento.

### 1.2 Decisões de brainstorming desta rodada

| Decisão | Escolha |
|---|---|
| Consequência de hit não mitigado | Contador HUD "hits sofridos" + stagger breve (~350ms sem input). Sem HP/dano — adiado para quando houver um sub-projeto dedicado de coleta de dados via barra de vida. |
| Input do recuo | Reaproveita WASD — não é tecla própria. Recuo é inferido: o jogador estava ao alcance quando o Assaltante começou a atacar (precondição da própria regra de IA) e saiu do alcance antes do golpe conectar, sem usar nenhuma outra defesa. |
| Tecla de esquiva | Muda de **K** para **Espaço**. |
| Tecla de guarda (bloqueio/parry) | Nova tecla **E**, segurar. Bloqueio e parry nascem do mesmo botão — o que diferencia é o timing (§3.3). |
| Escopo de gravação da dim 4 | Só durante uma janela real de ataque do Assaltante (telegraph), não a cada aperto de tecla a qualquer momento — mede repertório usado sob pressão, reaproveita o ciclo de vida da oportunidade `dodge` já existente. |
| Quebra de postura | Stagger breve (~350ms sem input), mesma consequência do hit não mitigado. |
| Recompensa do parry | Interrompe o golpe do Assaltante e abre uma janela de punição extra/maior — diferencia claramente do bloqueio comum, que só absorve. |
| HUD | Só texto cru (mesmo estilo já existente) — nenhuma barra gráfica nova. Redesign de HUD com modo gameplay/dev é pendência separada (`Contexto_pesquisa/instrumento-perfil-adaptativo.md` §9), fora de escopo aqui. |

---

## 2. Escopo

### 2.1 Entra

- `combat/types.ts` — `PlayerState` ganha `'blocking'` e `'staggered'`.
- `combat/actionDefs.ts` — constantes de guarda/postura/stagger (§3).
- `PlayerController` — `poise: number`, `startBlock()`/`stopBlock()`, `isParryTiming` (getter), `absorbBlockHit()`, `enterStagger()`; `tryDodge()` passa a checar `state === 'idle'` como já faz (nenhuma mudança de precondição, só o novo estado `'blocking'` já bloqueia por exclusão, como `'acting'` já bloqueia hoje).
- `AssaltanteController` — `onPlayerParrySuccess()` (interrompe o golpe, abre punição bônus).
- `Encounter` — resolução dos 5 casos do golpe do Assaltante (§4); novo evento `player.hit_unmitigated`; rastreio por-janela de "already recorded"/"overlap happened" para decidir `retreat` no expire da oportunidade `dodge`.
- `opportunity` — `onExpire` da oportunidade `dodge` (hoje sempre `undefined` → `{outcome:'expired'}`) ganha lógica análoga à que `punish` já tem.
- `ProfileAccumulator` — `EntropyAccumulator` para `'defensive_repertoire'` (dim 4, `n=4`); novo método `recordDefense(label)`.
- `debug/hudState.ts` — contador `hitsUnmitigated`.
- `scenes/ArenaScene.ts` — rebind `K`→`Espaço` (esquiva), nova tecla `E` (guarda); duas linhas novas de texto cru no `hudText` (postura, hits sofridos); `controlsText` atualizado.

### 2.2 Não entra (sub-projetos/iterações futuras)

- Sistema de HP/dano/mortes — adiado, ver §1.1.
- Redesign visual da HUD (modo gameplay/dev) — pendência separada, `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §9.
- Predicado de "janela segura" (dim 6) — spec própria futura.
- Animação de ataque/bloqueio/parry nos sprites 3D — os personagens continuam com só `idle`/`walk`; um golpe bloqueado ou um parry não têm animação dedicada ainda (mudança puramente mecânica/numérica nesta rodada). O fix de hitbox diagonal (spec `2026-09-06-arco-arma-pesada-troca-arma-design.md` §8) continua sendo pré-requisito de animação de ataque, não deste documento.
- Seleção de déficit-alvo, pesos de regra, boss adaptativo (passos 6-7 do roadmap).
- Escudo bloqueando "muito melhor" que outras armas (§5.1 do doc de referência menciona isso como decisão futura) — nesta rodada, bloqueio é **universal e uniforme** independente de arma equipada, para não acoplar dim 4 a loadout (mesma razão dada no doc de referência: "mais limpa para o ICC"). Diferenciação por arma fica para quando (se) isso for revisitado.

### 2.3 Critério de pronto

1. Uma sequência conhecida de janelas de ataque do Assaltante, cada uma respondida com uma defesa diferente (esquiva, bloqueio, parry no timing certo, recuo por espaçamento, e uma sem defesa nenhuma) resulta em exatamente 4 registros na dim 4 (o 5º caso, hit não mitigado, não gera registro) e 1 incremento do contador de hits sofridos.
2. `domain['defensive_repertoire']` bate com a entropia calculada à mão sobre `{dodge, block, parry, retreat}` após uma sequência conhecida.
3. Postura zera após N bloqueios seguidos (N definido por `POISE_MAX`/`POISE_DRAIN_PER_BLOCK`) e o jogador entra em `'staggered'` por `STAGGER_MS`, sem aceitar input nesse intervalo.
4. Parry bem-sucedido interrompe o golpe do Assaltante (`state` pula direto pra `'recovering'`) e abre uma oportunidade `punish` com janela maior que a normal (`PARRY_BONUS_RECOVERY_MS > RECOVERY_MS`).
5. Recuo só é registrado quando o Assaltante de fato iniciou o ataque com o jogador ao alcance (nunca antes disso) e o jogador saiu do alcance sem usar nenhuma tecla de defesa.
6. Harness de fechamento: toda janela de ataque do Assaltante gera **no máximo 1** registro de dim 4 (nunca 0 defesas conflitantes, nunca 2).

---

## 3. Máquina de estados e constantes

### 3.1 `PlayerState`

```ts
export type PlayerState = 'idle' | 'acting' | 'dodging' | 'blocking' | 'staggered';
```

- **`'blocking'`**: entra ao pressionar `E` (só a partir de `'idle'`, mesma exclusão que `'acting'`/`'dodging'` já respeitam). Sai ao soltar `E` (volta a `'idle'`) ou ao ser atingido de forma que zera a postura (vai para `'staggered'`).
- **`'staggered'`**: entra por dois caminhos — postura zerada durante `'blocking'`, ou hit não mitigado em `'idle'`. Dura `STAGGER_MS`, não aceita nenhum input (`tryAction`, `tryDodge`, `startBlock`, `switchWeapon` todos viram no-op, mesmo padrão de guarda que os outros estados já usam). Ao expirar, volta a `'idle'` sozinho (avançado em `step()`, como `'dodging'` já faz hoje).

### 3.2 Constantes novas (`actionDefs.ts`)

```ts
export const POISE_MAX = 100;
export const POISE_DRAIN_PER_BLOCK = 40; // 3 bloqueios seguidos quebram a postura
export const POISE_REGEN_DELAY_MS = 1000; // tempo parado em 'idle' antes de começar a regenerar
export const POISE_REGEN_PER_SECOND = 50; // recarga total em ~2s depois do delay
export const STAGGER_MS = 350;
export const PARRY_WINDOW_MS = 150; // guarda levantada há menos que isso quando o golpe conecta = parry
export const PARRY_BONUS_RECOVERY_MS = 750; // vs. RECOVERY_MS = 500 em assaltanteController.ts
```

Números de partida, ajustáveis em playtest — nenhum deles é usado por nenhum teste em termos absolutos além de "menor que"/"maior que" as relações acima (ex: `PARRY_BONUS_RECOVERY_MS > RECOVERY_MS`, `POISE_DRAIN_PER_BLOCK` tal que 3 hits seguidos zerem `POISE_MAX`).

### 3.3 Bloqueio vs. parry — mesmo botão, timing decide

`PlayerController` guarda `blockHeldMs: number` (cresce em `step()` enquanto `state === 'blocking'`). No momento em que um golpe do Assaltante colide com o jogador (checado em `Encounter.step()`, não dentro do `PlayerController`, que não conhece o Assaltante):

- Se `blockHeldMs < PARRY_WINDOW_MS` → **parry**.
- Caso contrário → **bloqueio comum**.

Isso reproduz o padrão "aperte pouco antes do golpe" (Sekiro/Dark Souls) sem precisar de uma segunda tecla nem de um estado novo — é uma leitura de `blockHeldMs` no instante da colisão, feita por quem já faz essa checagem hoje (`Encounter`).

---

## 4. Resolução do golpe do Assaltante (`Encounter.step`)

Substitui o bloco atual (`if (enemyAttack && overlap && player.isInvulnerable) ...`) por uma cadeia de precedência, avaliada a cada tick enquanto `enemyAttack` não é `null`. Todos os 5 casos abaixo são guardados pela mesma flag `defenseRecordedThisAttack` (§5): o primeiro caso que dispara numa janela marca a flag e é o único que efetivamente grava (rótulo de dim 4 e/ou contador HUD); qualquer disparo seguinte na mesma janela (ex: esquiva cedo que já gravou `dodge`, e depois o jogador ainda leva o resto do golpe em `'blocking'`) é ignorado — garante o critério de pronto #6 (no máximo 1 registro por janela).

```
1. overlap && player.isInvulnerable          → DODGE   (existente: onPlayerDodgeSuccess)
2. overlap && player.state === 'blocking'
     && player.blockHeldMs < PARRY_WINDOW_MS → PARRY   (novo: onPlayerParrySuccess)
3. overlap && player.state === 'blocking'    → BLOCK   (novo: player.absorbBlockHit())
4. overlap (nenhum dos acima)                → HIT NÃO MITIGADO
                                                (novo: player.enterStagger(); emit
                                                'player.hit_unmitigated')
5. (fim da janela sem NENHUM overlap)         → RETREAT (resolvido no onExpire da opp)
```

Casos 1-3 chamam `profile.recordDefense(label)` no exato tick em que acontecem (mesmo padrão de `recordAction`, chamado a partir de um evento/chamada direta do `Encounter`, nunca de dentro de `combat/`). O caso 4 não grava rótulo de dim 4 — só o contador HUD (§6) — seguindo a mesma filosofia da Família B (ação não realizada não é um 5º rótulo, é ausência de evidência).

**Esquiva sem colisão ainda conta — bloqueio/parry não**: a esquiva já é registrada hoje no instante em que é *acionada* (evento `player.dodge`, disparado por `tryDodge()` independente de colisão) — esse comportamento não muda: uma esquiva cedo demais, que nunca chega a colidir com o golpe, ainda grava o rótulo `dodge`. Bloqueio e parry são diferentes: só podem ser distinguidos um do outro **no instante da colisão** (§3.3 depende de `blockHeldMs` medido exatamente quando o golpe conecta), então só são gravados pelos casos 2-3 acima. Segurar `E` a janela inteira sem o golpe nunca colidir (cenário raro — a regra de ataque só dispara com o jogador já ao alcance, então o hitbox do Assaltante normalmente conecta se o jogador não sai do alcance) cai no caso 5 (retreat) por padrão, um efeito colateral conhecido e aceito, não uma mecânica visada.

### 4.1 Parry — interrupção do golpe

`onPlayerParrySuccess()` (novo em `AssaltanteController`, espelha `onPlayerDodgeSuccess()`):

```ts
onPlayerParrySuccess(): void {
  if (this.state !== 'attacking' || !this.activeOppId) return;
  this.opp.resolve(this.activeOppId, 'taken');
  this.state = 'recovering';
  this.phaseElapsedMs = 0;
  this.playerWasInRangeDuringPunish = false;
  this.activeOppId = this.opp.open('punish', 'assaltante.recover', PARRY_BONUS_RECOVERY_MS, () => /* mesmo onExpire de hoje */);
}
```

Pula o resto do `swing` e abre a janela de punição **imediatamente**, maior que a normal (`PARRY_BONUS_RECOVERY_MS` vs. `RECOVERY_MS`) — a recompensa mecânica que diferencia parry de bloqueio comum, que só absorve sem interromper nada.

### 4.2 Retreat — sem detecção especial

A regra `assaltante.attack` (`ai/rules/assaltanteRules.ts`) já só dispara quando `distanceToPlayer <= ATTACK_RANGE`. Logo, "recuo" é simplesmente: a oportunidade `dodge` chegou ao fim da janela (`TELEGRAPH_MS + SWING_MS`) sem nenhum overlap ter acontecido e sem nenhuma defesa ter sido acionada. Isso é resolvido no `onExpire` da oportunidade (§5), não precisa de nenhum cálculo de distância adicional — o AABB simplesmente nunca colidiu.

---

## 5. `onExpire` da oportunidade `dodge`

Hoje `AssaltanteController.step()` abre a oportunidade `dodge` sem `onExpire` (linha `this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS + SWING_MS)`), então ela sempre fecha como `'expired'` quando ninguém a resolve antes. Precisa de um `onExpire` análogo ao que `'assaltante.recover'` já usa para distinguir `expired`/`invalid`:

```ts
this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS + SWING_MS, () => {
  if (!this.defenseRecordedThisAttack) {
    this.onPlayerRetreat(); // profile.recordDefense('retreat') via Encounter
  }
  return { outcome: 'expired' };
});
```

`defenseRecordedThisAttack` é uma flag nova (mesmo padrão de `playerWasInRangeDuringPunish`), resetada em `false` toda vez que uma nova janela de ataque abre. É a única fonte de verdade sobre "já resolvemos essa janela": qualquer um dos casos 1-4 do §4, ao disparar, primeiro checa a flag — se já estiver `true`, o caso é ignorado (nenhum efeito, nenhuma gravação); caso contrário, executa seu efeito (gravar rótulo de dim 4, ou incrementar o contador de hit não mitigado) e marca a flag como `true`. Isso cobre inclusive a sequência "esquivou cedo, depois ainda foi pego em `'blocking'` no mesmo golpe" (§4, nota da esquiva sem colisão): o segundo evento não sobrescreve o primeiro.

---

## 6. Perfil e HUD

### 6.1 `ProfileAccumulator`

```ts
export const DEFENSIVE_LABELS = ['dodge', 'block', 'parry', 'retreat'] as const;
export type DefensiveLabel = (typeof DEFENSIVE_LABELS)[number];
```

Construtor ganha `this.entropyDims.set('defensive_repertoire', { acc: new EntropyAccumulator(DEFENSIVE_LABELS), folded: false, everRecorded: false })`, mesmo padrão de `weapon_repertoire`. Novo método:

```ts
recordDefense(label: DefensiveLabel): void {
  const dim = this.entropyDims.get('defensive_repertoire')!;
  dim.acc.record(label);
  dim.everRecorded = true;
}
```

Chamado por `Encounter`, nunca por `combat/` diretamente — mesma separação de camadas que `recordAction` já respeita.

### 6.2 HUD (`hudState.ts` + `ArenaScene.ts`)

`HudCounters` ganha `hitsUnmitigated: number`, incrementado em `bus.on('player.hit_unmitigated', ...)`, mesmo padrão dos contadores existentes. `ArenaScene.hudText` ganha duas linhas cruas:

```
postura: ${Math.round(player.poise)}/${POISE_MAX}
hits sofridos: ${hudCounters.hitsUnmitigated}
```

`controlsText` atualizado: `Espaço - esquiva`, `E (segure) - guarda: aperte bem em cima do golpe = parry, segure de longe = bloqueio`. Nenhuma barra gráfica nova — texto cru, mesmo estilo do resto da HUD atual (pendência de redesign registrada à parte).

> **CORREÇÃO (revisão final de branch, 07/09/2026):** a redação original deste parágrafo ("soltar no timing certo = parry") descrevia errado o próprio mecanismo — parry é decidido pelo instante em que **E é pressionado** (`blockHeldMs < PARRY_WINDOW_MS` no momento em que o golpe conecta, §3.3), não por quando é solto. Como a dim 4 mede justamente qual das 4 ferramentas o jogador escolhe, uma instrução errada na tela ameaça a própria coleta de dados (parry na prática nunca seria alcançado por quem seguisse o texto). Corrigido no código (`ArenaScene.ts`) e aqui.

---

## 7. Testes

Tudo em `combat/`/`profile/` continua puro e testável sem Phaser:

- **`PlayerController`**: `startBlock`/`stopBlock` respeitam exclusão de estado; `blockHeldMs` avança em `step()`; `enterStagger()` bloqueia todo input por `STAGGER_MS` e retorna a `'idle'` sozinho; postura drena e regenera conforme §3.2.
- **`AssaltanteController`**: `onPlayerParrySuccess()` só age em `state === 'attacking'`, pula pra `'recovering'` com uma oportunidade `punish` de janela maior.
- **`Encounter`**: os 5 casos do §4 isoladamente (fixture com Assaltante atacando e jogador em cada um dos 5 estados na hora da colisão/expiração); harness garantindo no máximo 1 registro de dim 4 por janela (critério de pronto #6); sequência completa (critério de pronto #1) validando os 4 rótulos + o contador de hits.
- **`ProfileAccumulator`**: `recordDefense` alimenta `defensive_repertoire`; entropia calculada à mão bate com `domain('defensive_repertoire', 'trait')` (critério de pronto #2); dimensão continua `null` se só um rótulo foi usado a sessão inteira (mesmo comportamento de `weapon_repertoire`/`action_repertoire` com evidência insuficiente).

---

## 8. Pendências conhecidas (registradas nesta rodada, não bloqueantes)

| Item | Detalhe | Quando vale a pena resolver |
|---|---|---|
| Sistema de HP/dano | Adiado por decisão explícita (§1.1) — hits sofridos é só contador por enquanto. | Sub-projeto futuro dedicado de coleta de dados (o usuário já sinalizou interesse: "velocidade que desce a barra, quantidade de mortes"). |
| Redesign de HUD (gameplay/dev) | Adições desta rodada ficam em texto cru de propósito. | Brainstorm dedicado, ver `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §9. |
| Bloqueio uniforme entre armas (sem bônus de escudo) | `sword_shield` não bloqueia melhor que `bow`/`heavy_weapon` nesta rodada, ao contrário do que o doc de referência §5.1 cogitava. | Se/quando isso importar para o jogo em si — não afeta a dim 4, que já é `n=4` fixo sem efeito de loadout por desenho. |
| Sem animação de bloqueio/parry nos sprites 3D | Mecânica pura por enquanto (postura sobe/desce, stagger, sem feedback visual dedicado além do HUD). | Junto com a animação de ataque — e só depois do fix de hitbox diagonal (`2026-09-06-arco-arma-pesada-troca-arma-design.md` §8), que já é pré-requisito registrado. |
| **Hitbox diagonal do Assaltante agora também é um problema de validade de dados, não só de sensação de combate** | Achado pela revisão final de branch (07/09/2026): `directionalHitbox` (`movement.ts`) resolve em 4 quadrantes; num ângulo de aproximação diagonal, o golpe do Assaltante pode nunca colidir com o jogador mesmo parado e ao alcance — e como "recuo" é inferido só de "a janela expirou sem overlap e sem defesa" (§4.2), esse whiff geométrico é lido como recuo bem-sucedido. Em ângulos diagonais (comuns numa arena isométrica), isso infla artificialmente o rótulo `retreat` da dim 4 com falsos positivos. | **Antes de qualquer coleta de dados real com dim 4** — não é mais só "quando for animar ataques". Ou adianta o fix de `2026-09-06-arco-arma-pesada-troca-arma-design.md` §8, ou adiciona uma checagem de distância no expire da oportunidade `dodge` (se o jogador ainda estava dentro de `ATTACK_REACH`, não foi recuo — foi só o hitbox errando). |

---

Spec escrito e pronto para revisão. Próximo passo após aprovação: `superpowers:writing-plans`.
