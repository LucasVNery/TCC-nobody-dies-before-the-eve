# Mira por Mouse + Arco/Arma Pesada + Troca de Arma (dim 1) — Design

**Data:** 06/09/2026
**Sub-projeto:** segundo da trilha "repertório de armas/ações do jogador"
**Depende de:** registro de ações + dim 2 (mesclado em master, commit `0c9bee4`)
**Documento guarda-chuva:** `docs/especificacao-perfil-instrumentacao-v2.md` (sem revisão nesta rodada — dim 1 com n=3 fixo já é um caso compatível com a spec tal como está, só não exercita a complexidade de "arma desbloqueada em runtime")

---

## 1. Contexto e objetivo

O sub-projeto 1 provou a cadeia *ação executada → evento → contagem decaída → entropia normalizada → snapshot* para a dim 2 (repertório de ações), com uma arma só. Este sub-projeto é o passo 2 da trilha (`docs/superpowers/specs/2026-09-06-registro-acoes-entropia-repertorio-design.md` §10): adiciona a 2ª e 3ª armas (arco, arma pesada) e a troca de arma em combate, e liga a **dim 1** (entropia de repertório de armas) reaproveitando a mesma infraestrutura genérica (`EntropyAccumulator`) já construída — dim 1 não precisa de nenhuma classe nova, só uma segunda instância dela, com outro conjunto de rótulos.

Durante o brainstorming, surgiu uma peça de escopo maior que "adicionar arma": trocar o esquema de controle de teclado puro para **WASD (move) + mouse (mira/ataque)**. Isso não é cosmético — muda de onde vem a direção do hitbox de ataque e do `facing` visual, hoje 100% derivados do último input de movimento. Essa mudança é tratada como a primeira peça deste documento porque as armas novas (e seus testes) já nascem em cima dela.

### 1.1 Decisões de brainstorming que originam este design

| Decisão | Escolha |
|---|---|
| Acesso às armas | Confirma decisão anterior (13/08): jogador carrega as 3 armas desde o início, troca livre, **n = 3 fixo** para dim 1. Não há mecânica de desbloqueio. |
| Mecânica do arco | Acerto instantâneo com alcance grande (`directionalHitbox` reaproveitado, só com `reach` maior) — não é projétil que viaja pela arena. Zero mecânica de colisão nova. |
| Tipos de ação por arma | Arco = `throw` (1 ação só: `bow.shot`) — primeira vez que esse slot da taxonomia da dim 2 tem `ActionDef` de verdade. Arma pesada = `light`/`heavy`/`charged`, espelhando a espada com números mais lentos/fortes. |
| Movimento durante a troca de arma | Livre — troca não é ação de combate, não trava posição. Só `tryAction()` fica bloqueado durante o recovery. |
| Seleção de arma | Tecla dedicada por arma (1/2/3), não ciclo. Selecionar a arma já equipada é no-op. |
| Direção do ataque | **Muda de WASD para mouse** (mira contínua) — decisão foi por dinamismo/diversão, aceitando o escopo maior (mexe na camada de projeção isométrica). Direção do dash/esquiva continua vindo do WASD. |
| Esquema de controle | Botão esquerdo = ação primária da arma equipada (`light` ou `throw`); botão direito = a ação secundária (`heavy`, sem efeito no arco); Q segura/solta = `charged` (sem efeito no arco); K = esquiva (inalterado); 1/2/3 = seleção de arma; E reservado sem uso. |

### 1.2 Por que a mira entra nesta spec e não numa própria

A mira por mouse é uma peça isolada e barata (uma função pura nova + um campo novo no `PlayerController` + leitura de posição do mouse por frame na `ArenaScene`) que **nenhuma arma nova depende semanticamente** para existir — mas o critério de pronto das armas novas (testes de `attackHitbox()` na direção certa) só faz sentido depois dela existir. Por isso ela é a §3 deste documento, implementada e testada antes do resto, mas dentro do mesmo ciclo spec → plano → implementação (não abriu um sub-projeto à parte porque o corpo de código é pequeno o bastante pra caber num único plano com fases claras).

---

## 2. Escopo

### 2.1 Entra

- `visual/isometricProjection.ts` — `fromScreen(delta, config)`, inverso linear de `toScreen`.
- `PlayerController` — separa `lastMoveDirection` (WASD, só dash) de `aimDirection` (mouse, ataque + `facing`); novo `setAimDirection(direction: Vec2): void`.
- `combat/actionRegistry.ts` — `HEAVY_WEAPON_ACTIONS`, `BOW_ACTIONS`, `WEAPON_IDS`, `findWeaponAction(weaponId, actionType)`.
- `PlayerController` — `equippedWeaponId`, `switchWeapon(weaponId)`, bloqueio de ataque durante recovery de troca (cancelável por esquiva), validação de arma equipada em `tryAction`.
- `actionDefs.ts` — `SWITCH_RECOVERY_MS = 250`.
- `ProfileAccumulator` — novo `EntropyAccumulator` para `'weapon_repertoire'` (dim 1); `recordAction` passa a receber também `weaponId`.
- `Encounter` — repassa `e.weaponId` para `profile.recordAction`.
- Dim 1 ligada de ponta a ponta: `Encounter` → `EntropyAccumulator` → `profile.snapshot`.

### 2.2 Não entra (sub-projetos seguintes)

- Kit defensivo (recuo, bloqueio, parry, barra de postura, stagger), **dim 4**.
- Definição do predicado "janela segura", **dim 6**.
- Seleção de déficit-alvo, pesos de regra, boss adaptativo.
- Desbloqueio de arma em runtime / `n` variável para dim 1 — continua fora, como no sub-projeto 1.
- Qualquer trabalho visual de asset (sprites, prismas, efeitos) — a mira por mouse muda a **fonte** da direção que já existia (`facing`), não adiciona nem modifica nenhum asset.
- Vibração/feedback de câmera para o mouse (zoom, deadzone de mira, etc.) — mira é a direção crua normalizada, sem suavização.

### 2.3 Critério de pronto

Dois testes de integração, cada um cobrindo uma metade do documento:

**Mira:**
1. Com o jogador numa posição conhecida e um ponto de mouse conhecido (já convertido para coordenada de mundo), `setAimDirection` normaliza corretamente e `attackHitbox()` aponta na direção esperada — inclusive quando essa direção diverge da última direção de movimento.

**Dim 1:**
2. Um `Encounter`, uma sequência conhecida de ataques trocando de arma (ex: 3× `bow.shot`, 2× `heavy_weapon.light`, 4× `sword_shield.light`), `applyRoomBoundary()` + `snapshot('room.exit')` → `domain['weapon_repertoire']` bate com a entropia calculada à mão sobre `{sword_shield, bow, heavy_weapon}`.
3. Um segundo caso: só uma arma usada a sessão inteira → `domain['weapon_repertoire']` é `null`.
4. `tryAction` com uma `actionId` de arma não equipada é rejeitado sem lançar e sem mudar estado.
5. `switchWeapon` bloqueia `tryAction` por `SWITCH_RECOVERY_MS`; `tryDodge` no meio do bloqueio libera o ataque na hora; trocar para a arma já equipada é no-op (não arma o bloqueio).

---

## 3. Mira por mouse

### 3.1 `fromScreen` — inverso de `toScreen`

`toScreen` é uma transformação linear:

```
screenX = (col - row) * halfWidth       col = worldX / tileWorldSize
screenY = (col + row) * halfHeight      row = worldY / tileWorldSize
```

Sendo linear, o inverso vale tanto para posições quanto para deltas (não precisa subtrair origem antes):

```ts
// src/visual/isometricProjection.ts — adição
export function fromScreen(delta: Vec2, config: IsoConfig): Vec2 {
  const col = (delta.x / config.halfWidth + delta.y / config.halfHeight) / 2;
  const row = (delta.y / config.halfHeight - delta.x / config.halfWidth) / 2;
  return {
    x: col * config.tileWorldSize,
    y: row * config.tileWorldSize,
  };
}
```

Identidade a testar: `fromScreen(toScreen(v, config), config) ≈ v` para vetores arbitrários (não só a origem).

### 3.2 `PlayerController` — duas direções, não uma

Hoje `lastDirection` serve dois papéis (direção do dash **e** direção do hitbox de ataque/`facing`), atualizados só quando `moveInput` é não-nulo. Isso muda:

| Campo | Fonte | Uso |
|---|---|---|
| `lastMoveDirection` (renomeado de `lastDirection`) | WASD (`setMoveInput`), como hoje | Só `dashDirection` em `tryDodge()` |
| `aimDirection` (novo) | Mouse, via `setAimDirection()` | `attackHitbox()` e o getter `facing` |

```ts
private lastMoveDirection: Vec2 = { x: 1, y: 0 }; // renomeado de lastDirection, mesmo valor inicial
private aimDirection: Vec2 = { x: 1, y: 0 };       // novo, mesmo valor inicial — mira "pra direita" até o primeiro update do mouse

setAimDirection(direction: Vec2): void {
  const normalized = normalizeVelocity(direction.x, direction.y);
  if (normalized.x === 0 && normalized.y === 0) return; // mouse exatamente sobre o jogador — mantém a mira anterior
  this.aimDirection = normalized;
}
```

`facing` passa a retornar `aimDirection` em vez de `lastMoveDirection`. **Mudança de contrato deliberada** — o teste existente `'exposes the last movement direction via facing, for visual/HUD purposes'` descreve o comportamento antigo e será reescrito no plano para refletir mira em vez de movimento.

### 3.3 `ArenaScene` — cálculo por frame

```ts
const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
const playerScreen = toScreen(this.encounter.player.position, ISO_CONFIG);
const delta = { x: worldPoint.x - playerScreen.x, y: worldPoint.y - playerScreen.y };
this.encounter.player.setAimDirection(fromScreen(delta, ISO_CONFIG));
```

Roda a cada `update()`, não só em `pointermove` — a mira precisa recalcular mesmo com o mouse parado, porque o jogador se move.

---

## 4. Armas novas

### 4.1 Registro (`combat/actionRegistry.ts`)

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

export const ACTION_REGISTRY: ReadonlyMap<string, ActionDef> = buildRegistry([
  SWORD_SHIELD_ACTIONS,
  HEAVY_WEAPON_ACTIONS,
  BOW_ACTIONS,
]);

export function findWeaponAction(weaponId: string, actionType: ActionType): ActionDef | undefined {
  for (const action of ACTION_REGISTRY.values()) {
    if (action.weaponId === weaponId && action.actionType === actionType) return action;
  }
  return undefined;
}
```

`findWeaponAction` é o que deixa a `ArenaScene` resolver "o que o botão esquerdo faz agora" sem `if`/`switch` por arma: tenta `light`, e se não existir (caso do arco) tenta `throw`. Botão direito tenta `heavy` (sem efeito se `undefined`). Q tenta `charged` (sem efeito se `undefined`).

Números são ponto de partida para tuning, não sagrados — mesma ressalva do sub-projeto 1.

### 4.2 `PlayerController` — arma equipada e troca

```ts
equippedWeaponId: string = 'sword_shield'; // default
private attackLockedMs = 0;

switchWeapon(weaponId: string): void {
  if (this.state !== 'idle' || weaponId === this.equippedWeaponId) return;
  this.equippedWeaponId = weaponId;
  this.attackLockedMs = SWITCH_RECOVERY_MS; // sempre reinicia cheio, mesmo trocando de novo no meio de um lock anterior
}
```

`tryAction(actionId)` ganha duas rejeições silenciosas a mais (além de `state !== 'idle'`, que já existe): `this.attackLockedMs > 0` e `action.weaponId !== this.equippedWeaponId`. Ambas seguem o mesmo padrão já estabelecido no sub-projeto 1 — `resolveAction` ainda lança para id desconhecido, mas essas duas checagens novas são sobre uma `ActionDef` válida que não pode ser usada *agora*, então não lançam.

`tryDodge()` ganha um efeito colateral: `this.attackLockedMs = 0` ao entrar em `'dodging'` — é isso que cancela o bloqueio de troca.

`step()` decrementa `attackLockedMs` do mesmo jeito que já decrementa `dodgeCooldownRemainingMs` (`Math.max(0, attackLockedMs - stepMs)`), independente do `state` — a troca não ocupa a state machine principal, é só um relógio paralelo.

### 4.3 `actionDefs.ts`

```ts
export const SWITCH_RECOVERY_MS = 250;
```

Ao lado de `DODGE`, mesmo padrão — uma constante de timing que não pertence a nenhuma arma específica.

---

## 5. Dim 1 no `ProfileAccumulator`

**Sem mudança de schema de evento** — `PlayerActionPayload.weaponId` já existe desde o sub-projeto 1.

```ts
constructor(private confidenceKappa: number = DEFAULT_CONFIDENCE_KAPPA) {
  this.entropyDims.set('action_repertoire', { acc: new EntropyAccumulator(ACTION_TYPES), folded: false, everRecorded: false });
  this.entropyDims.set('weapon_repertoire', { acc: new EntropyAccumulator(WEAPON_IDS), folded: false, everRecorded: false });
}

recordAction(actionType: ActionType, weaponId: string): void {
  const actionDim = this.entropyDims.get('action_repertoire')!;
  actionDim.acc.record(actionType);
  actionDim.everRecorded = true;

  const weaponDim = this.entropyDims.get('weapon_repertoire')!;
  weaponDim.acc.record(weaponId);
  weaponDim.everRecorded = true;
}
```

`applyRoomBoundary`/`applyEncounterBoundary`/`resetSession`/`snapshot` já iteram `entropyDims` genericamente (implementados assim de propósito no sub-projeto 1) — **nenhuma mudança** nesses quatro métodos. É o benefício direto de ter generalizado `EntropyAccumulator` sobre um conjunto de rótulos qualquer em vez de hardcodar para a dim 2.

`Encounter`:

```ts
this.bus.on('player.action', (e) => {
  this.profile.recordAction(e.actionType, e.weaponId);
  if (this.assaltante.state === 'attacking') {
    this.assaltante.onPlayerWrongAction(e.actionId);
  }
});
```

---

## 6. Estratégia de testes (TDD, Vitest)

| Unidade | Testes-chave |
|---|---|
| `isometricProjection.fromScreen` | inverso de `toScreen` para vetores arbitrários (não só a origem); `toScreen(fromScreen(d)) ≈ d` |
| `PlayerController` (mira) | `setAimDirection` normaliza; vetor zero não altera a mira anterior; `attackHitbox()` usa `aimDirection`, não `lastMoveDirection`; `facing` reflete `aimDirection`; dash continua usando `lastMoveDirection` mesmo com mira apontando para outro lado |
| `PlayerController` (armas/troca) | `switchWeapon` muda `equippedWeaponId` e arma `attackLockedMs`; trocar para a arma já equipada é no-op; `tryAction` de uma arma não equipada é rejeitado sem lançar/mudar estado; `tryAction` durante `attackLockedMs > 0` é rejeitado; `tryDodge` zera `attackLockedMs`; trocar de novo antes do lock acabar reinicia para `SWITCH_RECOVERY_MS` cheio |
| `actionRegistry` | `findWeaponAction` retorna a `ActionDef` certa; retorna `undefined` para combinação weapon/actionType inexistente (ex: `bow`+`heavy`); `WEAPON_IDS` tem 3 membros; `ACTION_REGISTRY.size` cresce para a soma das 3 listas |
| `ProfileAccumulator` (dim 1) | `recordAction` alimenta os dois `EntropyAccumulator`s no mesmo evento; `domain('weapon_repertoire', clock)` roteia certo; `snapshot` inclui `weapon_repertoire` só depois de folded, igual à dim 2 |
| `Encounter` (integração) | critério de pronto §2.3, itens 2-5 |

Determinismo: `fromScreen`/`setAimDirection` são funções puras de entrada explícita (sem `Math.random`, sem ler o relógio do sistema) — os testes passam vetores/posições diretamente, sem depender de um mouse real ou de `ArenaScene`.

---

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Mudar a fonte de `facing` quebra silenciosamente algum consumidor visual (`DirectionalSprite`) | `DirectionalSprite` só lê o valor de `facing`, não sabe de onde vem — nenhuma mudança nele. O teste que descrevia o contrato antigo é reescrito explicitamente, não deletado, para não perder cobertura do "vetor normalizado" em si. |
| `attackLockedMs` e `dodgeCooldownRemainingMs` são dois relógios paralelos parecidos — risco de um decremento esquecer o outro num refactor futuro | Ambos decrementados no mesmo bloco de `step()`, lado a lado, com o mesmo padrão `Math.max(0, x - stepMs)` — mantém a simetria visível no código. |
| `findWeaponAction` varre `ACTION_REGISTRY` inteiro a cada chamada (O(n) em vez de O(1)) | `n` é no máximo ~10 ações no fim da trilha inteira (3 armas × até 3 ações + arco). Não vale indexar por `(weaponId, actionType)` antes de isso ser um problema real. |
| Escopo escorregar para incluir kit defensivo ou predicado de janela segura | Critério de pronto (§2.3) é só sobre mira + dim 1. Kit defensivo é sub-projeto separado com spec própria. |

---

## 8. Pendências conhecidas (não bloqueantes, registradas na revisão final de 06/09/2026)

Nenhuma afeta a validade dos dados coletados pelo perfil (dim 1/dim 2) — são sensação de jogo e robustez de código. Não bloquearam o merge; ficam aqui para não se perderem quando alguma sessão futura mexer nessa área de novo.

| Item | Detalhe | Quando vale a pena resolver |
|---|---|---|
| Mira diagonal vs. hitbox de 4 direções | `directionalHitbox` (`movement.ts`) resolve a mira em 4 quadrantes; a seta visual agora aponta continuamente pro mouse. Num tiro de arco na diagonal, o hitbox pode "errar" um alvo que a seta aponta certeiro. | Junto com o sub-projeto do kit defensivo (passo 3 abaixo), que já vai mexer em `movement.ts`/geometria de hitbox. |
| Direção do `charged` trava no aperte, não na soltura | `committedDirection` é fixado em `tryAction()`. Girar o mouse durante a carga não muda a direção do golpe final. | Questão de sensação de jogo — só se incomodar durante playtest. |
| `switchWeapon` não valida o `weaponId` | Um id inexistente é aceito silenciosamente e trava todo `tryAction` depois disso (nenhuma arma bate). `equippedWeaponId` também é campo público mutável, sem guarda. | Cedo, é barato — checar contra `WEAPON_IDS` (já importável) ou tipar como union. |
| `WEAPON_IDS` é `string[]` genérico | Perde a checagem de tipo literal — `findWeaponAction('sword_sheild', ...)` (erro de digitação) compila. | Trocar por `as const` + tipo `WeaponId` derivado, sem custo de runtime. |
| Sem indicador de arma equipada / bloqueio de troca na HUD | Quem está jogando não vê qual arma está segurando nem que o ataque está bloqueado durante os 250ms de troca. | Uma linha no `hudText` existente (`weapon: ${player.equippedWeaponId}`) resolve. |
| Clique esquerdo+direito simultâneos | `pointer.leftButtonDown()` checado primeiro — segurar os dois faz o clique ser lido como ataque primário. | Trocar para checar `pointer.button` (0/2) em vez dos helpers de estado. |
| `tryEquippedAction` tem nome mais forte que o que faz | Retorna "existe uma ação desse tipo pra arma atual", não "a ação foi executada" — o fallback esquerdo (`light`→`throw`) depende dessa distinção continuar válida conforme mais armas entram. | Renomear ou comentar quando a 4ª arma for adicionada. |
| Teste com nome desatualizado | `'dash defaults to facing right if the player never moved'` usa "facing" no sentido antigo (movimento); hoje `facing` = mira. Testa posição, então continua correto — só o nome ficou capenga. | Cosmético, qualquer PR que passar por perto. |

---

## 9. Trilha completa (contexto — só o passo 2 é este sub-projeto)

1. ~~Registro de ações + dim 2, com espada+escudo.~~ **Mesclado (commit `0c9bee4`).**
2. ~~Mira por mouse + arco + arma pesada + troca de arma → dim 1.~~ **Mesclado (commit `939a521`).**
3. Kit defensivo: recuo, bloqueio, parry, barra de postura, stagger → **dim 4**.
4. Definição do predicado "janela segura" → **dim 6**.
5. Seleção de déficit-alvo com histerese.
6. Pesos de regra + boss adaptativo + preditor de movimento.

Estudo 1 pode rodar ao fim do passo 4.
