# Leque de Ataque em Ângulo Livre (fix do hitbox diagonal) — Design

**Data:** 07/09/2026
**Sub-projeto:** correção pontual, fora da trilha de repertório — pré-requisito registrado em dois specs anteriores
**Depende de:** `combat/movement.ts` (`normalizeVelocity`, `directionalHitbox` — este último será removido do uso em ataques, mas continua existindo/sem uso? ver §2.2), `visual/isometricProjection.ts` (`toScreen`)
**Documentos relacionados:** `2026-09-06-arco-arma-pesada-troca-arma-design.md` §8 (mira diagonal vs. hitbox de 4 direções), `2026-09-07-kit-defensivo-postura-design.md` §8 (achado escalado pela revisão final: hitbox diagonal infla falso `'retreat'` na dim 4)

---

## 1. Contexto e objetivo

`directionalHitbox` (`movement.ts`) resolve a direção de um ataque comparando `|dx|` vs `|dy|` e produz um retângulo alinhado a **um único eixo cardeal** — 4 fatias de 90° cada. A mira do jogador (mouse, contínua) e a direção de ataque do Assaltante já são vetores livres em qualquer ângulo. Isso gerava dois problemas já registrados como pendência:

1. Um tiro/golpe na diagonal pode errar um alvo que a seta/mira aponta certeiro.
2. **Mais grave** (achado da revisão final do kit defensivo, 07/09/2026): a dim 4 do perfil de pesquisa infere o rótulo `'retreat'` só de "a janela de ataque expirou sem colisão e sem defesa usada" — como o hitbox de 4 eixos pode nunca colidir com um jogador parado e ao alcance numa diagonal, isso é lido como recuo bem-sucedido quando na verdade foi só o hitbox errando geometricamente. Compromete a validade dos dados que o instrumento existe para coletar.

Pesquisa feita nesta rodada: no esquema teclado+mouse do Hades — o mesmo esquema já adotado aqui desde a spec de dim 1 — a direção do ataque é livre e contínua, desacoplada da direção de movimento. Isso confirma que a correção certa não é "trocar 4 fatias por 8" (ainda snapping, só menos grosseiro), e sim tornar o hitbox verdadeiramente livre em qualquer ângulo, coerente com a mira que já é livre.

### 1.1 Decisões de brainstorming desta rodada

| Decisão | Escolha |
|---|---|
| Forma do hitbox | Leque/setor (cone) centrado na direção da mira, ângulo livre — não mais retângulo alinhado a eixo, não mais snapping em 4 ou 8 direções. |
| Largura do leque por arma | Um único ângulo padrão para todas as armas nesta rodada (`ATTACK_HALF_ANGLE_RAD`) — mesma simplicidade que o código já tem hoje, onde só o alcance (`reach`) varia por arma, nunca o formato. Diferenciar por arma fica para se/quando o playtest pedir. |
| Teste de colisão do leque | Contra os 4 cantos + o centro da caixa-alvo (não geometria exata arco-retângulo) — simples, generoso o bastante para hurtboxes pequenas (20×20), sem precisar de biblioteca de geometria computacional. |
| Preservação de alcance | Origem do leque passa a ser o **centro** do atacante (era a borda do AABB); para o alcance sentido no jogo não encolher nos casos cardeais que já funcionavam, o alcance efetivo do leque é `reach + ENTITY_SIZE/2` (soma metade da largura do próprio atacante, já que atacante e alvo são quadrados do mesmo tamanho hoje). |
| Overlay de debug | Desenha o leque como um polígono (origem + N pontos amostrados ao longo do arco), cada vértice projetado por `toScreen` — reaproveita o pipeline de projeção isométrica já usado pros cantos de AABB, sem lidar manualmente com o skew elíptico da projeção. |

---

## 2. Escopo

### 2.1 Entra

- `src/combat/sector.ts` (novo arquivo): `AttackSector`, `directionalSector(center, direction, reach, halfAngleRad)`, `sectorOverlapsBox(sector, box)` — funções puras, sem estado, mesmo padrão de `movement.ts`.
- `src/combat/movementDefs.ts`: nova constante `ATTACK_HALF_ANGLE_RAD = Math.PI / 4` (45° para cada lado, leque de 90° total).
- `src/combat/playerController.ts`: `attackHitbox()` muda de `AABB | null` para `AttackSector | null`; usa `directionalSector` no lugar de `directionalHitbox`, com alcance efetivo `reach + this.width / 2` (ou `/2` da dimensão relevante — como `width === height` hoje, é o mesmo valor).
- `src/combat/assaltanteController.ts`: mesma troca em `attackHitbox()`.
- `src/combat/encounter.ts`: as duas checagens `aabbOverlap(enemyAttack, player.hurtbox())` / `aabbOverlap(playerAttack, assaltante.hurtbox())` viram `sectorOverlapsBox(...)`.
- `src/scenes/ArenaScene.ts`: `drawDebugHitboxes()` desenha o leque como polígono projetado em vez de `cornersAsPoints` de um AABB, para os dois ataques (jogador e Assaltante). O círculo/elipse de `ATTACK_RANGE` (alcance do Assaltante pra *iniciar* um ataque, não o hitbox do golpe em si) continua como está — não é afetado por esta mudança.
- Testes: `playerController.test.ts`, `assaltanteController.test.ts`, `encounter.test.ts` — toda asserção que hoje lê `.attackHitbox()!.x`/`.y`/`.width`/`.height` diretamente passa a usar `sectorOverlapsBox(hitbox, targetBox)` para verificar comportamento (acerta/não acerta), não forma. Novos casos de teste na diagonal (§5).
- Novo teste de regressão em `encounter.test.ts`: jogador parado, ao alcance, numa diagonal, não gera mais o rótulo `'retreat'` na dim 4.

### 2.2 Não entra

- Diferenciação de largura de leque por arma (§1.1, decisão já tomada de adiar).
- Qualquer mudança na mecânica do arco além de herdar o novo formato de hitbox — continua "acerto instantâneo", sem projétil.
- `directionalHitbox` em si **não é removida** de `movement.ts` — fica sem uso pelos ataques (dead code candidato a limpeza futura), mas removê-la não é objetivo desta rodada; se algum outro chamador aparecer depois (não há nenhum hoje além de `playerController.ts`/`assaltanteController.ts`), reavaliar então.
- Animações de ataque, kit visual, qualquer coisa de `visual/` além do overlay de debug (que já é `debug/`-adjacent, dentro de `ArenaScene`).
- Sistema de HP/dano, redesign de HUD — inalterados, fora de escopo desde specs anteriores.

### 2.3 Critério de pronto

1. Um ataque do jogador mirado na diagonal (ex: mira `{x: 0.707, y: 0.707}`) acerta um Assaltante posicionado exatamente nessa diagonal, dentro do alcance.
2. Um ataque do Assaltante contra um jogador posicionado na diagonal, dentro do alcance, conecta (mesmo teste de "reachability invariant" que já existe hoje para o caso cardeal, estendido pra diagonal).
3. Um jogador parado, ao alcance do Assaltante, numa diagonal, **não** gera o rótulo `'retreat'` na dim 4 quando o Assaltante ataca (a regressão que motivou toda a correção).
4. Um ataque mirado longe do alvo (fora do meio-ângulo do leque, mesmo dentro do alcance) **não** conecta — o leque continua tendo um limite angular real, não virou um círculo completo.
5. Todos os testes que hoje comparam a *forma* do hitbox (x/y/width/height) foram reescritos para verificar *comportamento* via `sectorOverlapsBox`, sem perda de cobertura.
6. Overlay de debug mostra visualmente o leque (não mais um retângulo) apontando na direção exata da mira/ataque, verificável rodando o jogo.

---

## 3. `combat/sector.ts` — o novo primitivo geométrico

```ts
export interface AttackSector {
  origin: Vec2;
  direction: Vec2;    // normalizado
  reach: number;       // alcance efetivo a partir de origin (já inclui o ajuste de metade da largura do atacante — quem chama decide isso, sector.ts só recebe o valor final)
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

`direction` deve chegar já normalizado (mesma responsabilidade que `directionalHitbox` já delega hoje a quem chama — `PlayerController`/`AssaltanteController` já normalizam via `normalizeVelocity` antes).

---

## 4. Pontos de chamada — `PlayerController` e `AssaltanteController`

Em `playerController.ts`, `attackHitbox()` troca:

```ts
return directionalHitbox(this._position, this.width, this.height, this.committedDirection, this.chargedReach());
```
por
```ts
const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
return directionalSector(center, this.committedDirection, this.chargedReach() + this.width / 2, ATTACK_HALF_ANGLE_RAD);
```
(mesma troca para o ramo não-`charged`, usando `this.currentAction.reach + this.width / 2`).

Em `assaltanteController.ts`, `attackHitbox()` troca:
```ts
return directionalHitbox(this._position, this.width, this.height, this._attackDirection, ATTACK_REACH);
```
por
```ts
const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
return directionalSector(center, this._attackDirection, ATTACK_REACH + this.width / 2, ATTACK_HALF_ANGLE_RAD);
```

`ATTACK_HALF_ANGLE_RAD` importado de `movementDefs.ts` nos dois arquivos.

---

## 5. `Encounter` e testes — de forma para comportamento

`encounter.ts`: as duas linhas que hoje chamam `aabbOverlap(attack, hurtbox)` passam a chamar `sectorOverlapsBox(attack, hurtbox)` — import trocado, nenhuma outra mudança de lógica (a precedência dodge/parry/block/hit/retreat do kit defensivo não muda, só a função de colisão usada).

**Testes existentes a reescrever** (comportamento, não forma):

```ts
// Antes:
expect(hitbox!.x).toBeGreaterThan(enemy.position.x);
// Depois (mesma intenção — o golpe aponta pro jogador à direita):
expect(sectorOverlapsBox(hitbox!, { x: enemy.position.x + 30, y: enemy.position.y, width: 20, height: 20 })).toBe(true);
expect(sectorOverlapsBox(hitbox!, { x: enemy.position.x - 30, y: enemy.position.y, width: 20, height: 20 })).toBe(false);
```

**Casos novos** (critério de pronto §2.3):

```ts
it('a diagonal attack connects with a target positioned exactly on that diagonal', () => {
  // jogador mira {x: 0.707, y: 0.707}; Assaltante posicionado na mesma diagonal, dentro do alcance -> conecta
});

it('an attack aimed away from the target does not connect even within reach', () => {
  // alvo dentro do alcance mas fora do meio-ângulo do leque -> não conecta
});

it('a stationary in-range player approached diagonally is not recorded as retreat', () => {
  // Assaltante numa diagonal em relação ao jogador parado, ao alcance -> antes do fix, hitbox nunca colidia
  // e a dim 4 gravava 'retreat' por engano; depois do fix, o golpe conecta e NÃO grava retreat
  // (grava block/dodge/parry conforme o jogador reagir, ou nada, se levar o golpe sem defesa)
});
```

---

## 6. Overlay de debug — visualizar o leque

Em `ArenaScene.drawDebugHitboxes()`, a função `cornersAsPoints` (que projeta os 4 cantos de um AABB) ganha uma irmã:

```ts
private sectorAsPoints(sector: AttackSector, samples = 10): Phaser.Geom.Point[] {
  const centerAngle = Math.atan2(sector.direction.y, sector.direction.x);
  const points: Phaser.Geom.Point[] = [toScreen(sector.origin, ISO_CONFIG)].map(
    (p) => new Phaser.Geom.Point(p.x, p.y),
  );
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

E as duas chamadas de `fillPoints(this.cornersAsPoints(playerAttack), true)` / `...assaltanteAttack...` viram `fillPoints(this.sectorAsPoints(playerAttack), true)` / `...assaltanteAttack...`. O círculo/elipse de `ATTACK_RANGE` (linha 273-279 hoje) não muda — é uma métrica diferente (quando o Assaltante *decide* atacar, não o hitbox do golpe).

---

## 7. Testes

Cobertura em três camadas, mesmo padrão do resto do combate:

- **`sector.ts`** (novo, puro): `pointInSector`/`sectorOverlapsBox` testados isoladamente — dentro do alcance e do ângulo (true), fora do alcance (false), dentro do alcance mas fora do ângulo (false), ponto exatamente na borda do meio-ângulo (decisão de arredondamento, documentar no teste), caixa-alvo que só tem um canto dentro do setor (true — confirma que a checagem por múltiplos pontos funciona).
- **`PlayerController`/`AssaltanteController`**: `attackHitbox()` retorna `null` fora da janela ativa (comportamento inalterado); quando não-nulo, `origin`/`direction`/`reach` batem com a posição/mira atual.
- **`Encounter`**: os 3 casos novos do §5, mais todos os testes existentes reescritos para comportamento.

---

## 8. Pendências conhecidas (não bloqueantes)

| Item | Detalhe | Quando vale a pena resolver |
|---|---|---|
| Largura de leque uniforme entre armas | Arco e espada usam o mesmo `ATTACK_HALF_ANGLE_RAD` — pode não fazer sentido pra sempre (arco "deveria" ser mais preciso). | Se/quando o playtest mostrar que o arco parece bugado por acertar coisas fora da linha de mira. |
| `directionalHitbox` fica sem uso | Não removida nesta rodada (§2.2) — código morto candidato a limpeza. | Qualquer PR futuro que passar por `movement.ts`. |
| `aabbOverlap` (`collision.ts`) também fica sem uso | Achado pela revisão final de branch (07/09/2026): com `Encounter` migrado pra `sectorOverlapsBox`, `aabbOverlap` só é referenciada pelo próprio `collision.ts` e seu teste — código morto, mesma situação de `directionalHitbox`. | Mesma oportunidade — qualquer PR futuro que passar por `combat/`. |
| Amostragem por 5 pontos não cobre alvo sobrepondo/atrás da origem | `sectorOverlapsBox` testa 4 cantos + centro; um alvo que contém ou está atrás da origem do atacante pode ter os 5 pontos fora do ângulo, não é detectado. Mesma limitação que o retângulo antigo já tinha (ele começava na borda do atacante) — não é regressão, mas documentado explicitamente pela revisão final. | Só se o playtest revelar um caso real de "colado no inimigo e o ataque não conecta". |
| Dados de perfil coletados antes desta correção não são comparáveis aos de depois | Achado pela revisão final: o leque cobre lateralmente muito mais que o retângulo antigo no alcance máximo (±55px vs ±10px) — ataques conectam em situações que antes erravam. Isso é a correção pretendida, mas significa que qualquer sessão de playtest/piloto gravada ANTES deste fix mede um instrumento diferente do que existe depois. | Antes de qualquer análise que combine dados de antes e depois desta correção — descartar ou segregar sessões piloto anteriores, se houver. |

---

Spec escrito e pronto para revisão. Próximo passo após aprovação: `superpowers:writing-plans`.
