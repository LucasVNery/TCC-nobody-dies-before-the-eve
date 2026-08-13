# Spec — Sistema de Movimento e Câmera

**Data:** 13/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** segundo sub-projeto do TCC (ver `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md` para o primeiro). Este spec cobre **apenas** locomoção do jogador e do Assaltante numa arena retangular maior que a tela, mais câmera que segue o jogador. Pipeline visual 3D (Blender, sprites pré-renderizados vs. motor 3D) fica para o sub-projeto seguinte — depende deste estar pronto, já que precisa de uma arena com movimento real para ser testado em condições realistas.

---

## 1. Por que este recorte

O sub-projeto anterior validou o `OpportunitySystem` com uma configuração estática — jogador e Assaltante fixos a 30px de distância, sem locomoção. Isso bastou para provar a instrumentação, mas não serve de ambiente de teste para as próximas decisões (câmera, visual 3D, e eventualmente PCG de salas maiores). Este sub-projeto existe para:

- dar posição real ao jogador e ao Assaltante, com movimento livre em 8 direções;
- fazer a câmera seguir o jogador dentro de uma arena maior que a viewport, como em Hades;
- manter a restrição de design já travada: lógica de combate/movimento nunca referencia asset visual, `scenes/` só lê e desenha.

Fora de escopo: pathfinding com desvio de obstáculos, paredes internas na arena, múltiplas salas, qualquer pipeline de asset 3D (isso é o próximo sub-projeto).

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Controle do jogador | WASD/setas, movimento livre em 8 direções, normalizado (diagonal não é mais rápido) |
| Esquiva | Vira dash direcional: desloca na direção do movimento atual (ou última direção se parado) por distância fixa, mantendo os i-frames já existentes |
| Movimento durante ataque | Bloqueado — `tryLightAttack()` já exige `state === 'idle'`, e `tryMove()`/atualização de velocidade também só se aplica em `idle`/`chasing`-equivalente do jogador |
| Perseguição do Assaltante | Linha reta na direção do jogador, velocidade fixa (mais lenta que o jogador), sem pathfinding. Para ao entrar em `ATTACK_RANGE` |
| Limites da arena | Retângulo fixo (`ARENA_BOUNDS`), maior que a viewport — sujeito a mudar quando salas variadas existirem |
| Câmera | Segue o jogador (`camera.startFollow`), clampada aos limites da arena (`camera.setBounds`) via recurso nativo do Phaser — nunca mostra área fora da sala |

## 3. Arquitetura

```
src/
├── combat/
│   ├── movement.ts        NOVO — funções puras: aplicar velocidade, normalizar diagonal, clamp em ARENA_BOUNDS
│   ├── movementDefs.ts    NOVO — velocidades (jogador, Assaltante), distância do dash, ARENA_BOUNDS
│   ├── playerController.ts    MODIFICADO — ganha `position: Vec2`, lê input direcional, dash na esquiva
│   ├── assaltanteController.ts MODIFICADO — ganha `position: Vec2`, persegue jogador em `chasing`
│   ├── encounter.ts       MODIFICADO — repassa input de movimento do jogador, calcula hurtbox/attackHitbox a partir de `position`
│   └── types.ts           MODIFICADO — adiciona `Vec2`
└── scenes/
    └── ArenaScene.ts      MODIFICADO — lê `position` a cada frame para mover os retângulos; câmera segue o retângulo do jogador
```

Nenhuma pasta nova além de `combat/movement.ts`/`movementDefs.ts` — ambos ficam em `combat/` porque são um detalhe de simulação da arena, não um sistema novo (não é `ai/`, não é `opportunity/`).

### Restrição de design (reafirmada)

`combat/movement.ts` opera sobre `Vec2`/`AABB` abstratos. `scenes/ArenaScene.ts` continua sendo a única camada que lê `position` para desenhar — nenhuma mudança na restrição do sub-projeto anterior.

## 4. Componentes

### `combat/movement.ts`
- `normalizeVelocity(dx: number, dy: number): Vec2` — normaliza vetor de direção (evita diagonal mais rápida).
- `applyMovement(position: Vec2, velocity: Vec2, stepMs: number): Vec2` — retorna nova posição.
- `clampToArena(position: Vec2, halfExtent: Vec2, bounds: AABB): Vec2` — impede a AABB da entidade de sair da arena.

### `combat/movementDefs.ts`
- `PLAYER_MOVE_SPEED`, `ASSALTANTE_CHASE_SPEED` (mais lenta que o jogador), `DASH_DISTANCE`, `ARENA_BOUNDS` (ex: `{x:0, y:0, width: 1600, height: 1200}` — maior que a viewport de 800x600 do sub-projeto anterior).

### `combat/playerController.ts`
- Novo método `setMoveInput(dx: number, dy: number): void` — chamado pela cena a cada frame com o vetor de input bruto (a cena lê teclado, o controller decide o que fazer com isso).
- `step()` aplica `movement.ts` quando `state === 'idle'` (parado ou andando não têm estados distintos — "andando" é só `idle` com velocidade não-nula).
- `tryDodge()` agora também fixa uma direção de dash (última direção não-nula do input, ou direção atual) e `step()` desloca a posição durante a fase de dash usando essa direção e `DASH_DISTANCE`/`DODGE.durationMs`.

### `combat/assaltanteController.ts`
- Em `chasing`, `step()` calcula vetor até a posição do jogador (recebida como parâmetro, como hoje `distanceToPlayer` é recebido — vira `playerPosition: Vec2`), anda nessa direção a `ASSALTANTE_CHASE_SPEED`, para quando a distância `<= ATTACK_RANGE`.
- **Direção do ataque deixa de ser fixa.** Hoje `attackHitbox()` sempre golpeia para a esquerda (`hurtboxBase.x - 20`), porque o jogador sempre esteve à esquerda do Assaltante nos testes do sub-projeto anterior. Com movimento livre, o inimigo pode abordar o jogador de qualquer lado — sem corrigir isso, ele só acertaria quando o jogador estivesse posicionado à direita dele, repetindo a classe de bug que a revisão final do sub-projeto 1 pegou (critério de pronto inalcançável). Correção: ao entrar em `attacking`, capturar a direção normalizada até a posição do jogador naquele instante (congelada durante o telegraph/swing, não recalculada frame a frame) e usar o eixo dominante (x ou y) para posicionar a hitbox do golpe no lado correspondente da hurtbox.

### `combat/encounter.ts`
- Substitui `setDistanceToPlayer(d: number)` por `setPlayerMoveInput(dx, dy)` (repassado ao `PlayerController`) — `distanceToPlayer` some como conceito externo; `Encounter.step()` calcula a distância internamente a partir das duas posições antes de chamar `assaltante.step()`.
- `hurtbox()`/`attackHitbox()` de ambos os controllers passam a derivar de `position`, não de uma AABB fixa passada no construtor.

### `scenes/ArenaScene.ts`
- Lê teclado (WASD/setas) a cada frame, chama `encounter.setPlayerMoveInput(dx, dy)`.
- `update()` posiciona os retângulos em `encounter.player.position`/`encounter.assaltante.position`.
- `this.cameras.main.startFollow(playerRect)` e `this.cameras.main.setBounds(...)` com os mesmos valores de `ARENA_BOUNDS`, configurados em `create()`.

## 5. Fluxo de dados

`ArenaScene` lê teclado → `encounter.setPlayerMoveInput(dx,dy)` → `PlayerController.step()` aplica `movement.ts` (normaliza, desloca, clampa) → `AssaltanteController.step()` recebe a posição atualizada do jogador, persegue ou ataca → colisões e oportunidades seguem exatamente o fluxo já existente (inalterado) → `ArenaScene.update()` lê as posições finais para desenhar; câmera do Phaser segue o retângulo do jogador automaticamente.

## 6. Testes

- Vitest cobre `movement.ts` (normalização, clamp nos limites) e as mudanças em `playerController.ts`/`assaltanteController.ts` (movimento até a borda da arena, dash desloca a posição corretamente, Assaltante persegue e para em `ATTACK_RANGE`) — tudo sem depender de Phaser, como no sub-projeto anterior.
- Sem testes de câmera/renderização — `camera.startFollow`/`setBounds` são comportamento nativo do Phaser, verificado manualmente.

## 7. Critério de pronto

- Jogador se move livremente em 8 direções dentro da arena, sem atravessar os limites.
- Esquiva desloca o jogador (dash) na direção certa, com i-frames.
- Assaltante persegue o jogador em linha reta e para ao entrar em alcance de ataque.
- Câmera segue o jogador e nunca mostra área fora da arena.
- Todos os testes automatizados herdados do sub-projeto anterior continuam passando (nenhuma regressão no `OpportunitySystem`/combate).

## 8. Próximos sub-projetos (fora deste spec)

1. Pipeline visual 3D (Blender → Phaser): avaliar sprites pré-renderizados vs. motor 3D embutido — depende deste sub-projeto para ter uma arena com movimento onde testar de verdade.
2. Perfil do jogador, telemetria, roleta ponderada, PCG e boss — conforme já listado no spec do sub-projeto anterior.
