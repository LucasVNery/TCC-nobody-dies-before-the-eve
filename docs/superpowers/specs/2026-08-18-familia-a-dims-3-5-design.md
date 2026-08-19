# Spec — Família A, Dimensões 3 e 5 (Punição e Distância Operacional)

**Data:** 18/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** sexto sub-projeto do TCC (ver `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md`, `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md`, `docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md`, `docs/superpowers/specs/2026-08-18-ciclo-vida-oportunidade-design.md` e `docs/superpowers/specs/2026-08-18-acumuladores-decaidos-design.md` para os cinco anteriores). Este spec implementa a parte do passo 4 do §8 de `docs/especificacao-perfil-instrumentacao-v2.md` que já é possível hoje: as dimensões 3 (aproveitamento de punição) e 5 (distância operacional) da Família A, ligando o `ProfileAccumulator` a dados reais do jogo pela primeira vez.

---

## 1. Por que este recorte

O `ProfileAccumulator` (sub-projeto anterior) é um mecanismo puro, sem nenhum consumidor real. A Família A tem quatro dimensões (§3.1 do doc de perfil): punição (3), distância operacional (5), paciência (6) e uso de espaço (7). Das quatro, só duas são implementáveis com o jogo atual:

- **Dim 3 (punição):** numerador = janelas `punish` com outcome `taken`; denominador = janelas `punish` ∈ {`taken`, `missed`, `expired`}. Isso já existe por inteiro no `OpportunitySystem` desde o sub-projeto de ciclo de vida da oportunidade — só falta encanar o evento `opp.close` até o `ProfileAccumulator`.
- **Dim 5 (distância operacional):** numerador = tempo em alcance corpo-a-corpo; denominador = tempo total de combate. Não passa pelo `OpportunitySystem` — é tempo, não oportunidade anotada — mas a posição do jogador e do Assaltante já são públicas, então dá pra calcular a cada `step()`.

As outras duas ficam de fora:
- **Dim 6 (paciência):** precisa de "janela segura" como predicado implementável, ainda não definido (o próprio doc de perfil marca isso como pendência, §3.1).
- **Dim 7 (uso de espaço):** precisa de um `OppType` `reposition`, que não existe — não há mecânica de reposicionamento no jogo hoje.

Este sub-projeto existe para:
- ligar `Encounter` (que já orquestra combate e oportunidade) a um `ProfileAccumulator` próprio, alimentando as duas dimensões em tempo real;
- provar que a integração dim 3 (via evento) e dim 5 (via tempo por tick) funcionam ponta a ponta, com testes que fecham o ciclo completo `Encounter.step()` → `ProfileAccumulator.domain()`.

Fora de escopo: qualquer fronteira de sala/encontro real (`applyRoomBoundary()`/`applyEncounterBoundary()` continuam sem gatilho automático — essa decisão já foi tomada e revalidada no sub-projeto anterior; os testes chamam essas fronteiras manualmente, como já fazem os testes do `ProfileAccumulator`); dimensões 6 e 7; qualquer exposição do perfil no HUD/debug (é um sub-projeto de integração de dados, não de visualização); telemetria de rede.

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Dono do `ProfileAccumulator` | `Encounter` ganha `readonly profile: ProfileAccumulator` — mesmo padrão de já possuir `opportunities` |
| `SkillId` das duas dimensões | `'punish'` (dim 3, já bate com o `OppType` existente) e `'distance'` (dim 5) |
| Gatilho da dim 3 | `Encounter` assina `opp.close` no construtor; se `type === 'punish'` e `outcome !== 'invalid'`, chama `profile.recordOutcome('punish', outcome)` — `taken`/`missed`/`expired` passam direto, sem tradução (`ProfileOutcome` já é `OppOutcome` sem `invalid`) |
| Gatilho da dim 5 | Em cada `Encounter.step()`, calcula a distância jogador↔Assaltante, converte `stepMs` para segundos e chama `profile.record('distance', dentroDoAlcance ? stepSegundos : 0, stepSegundos)` — a confiança dessa dimensão é medida em segundos de combate, não em ticks, conforme `especificacao-perfil-instrumentacao-v2.md` §3.1 — "alcance corpo-a-corpo" = `ATTACK_REACH`, já definido em `movementDefs.ts` |
| Fronteiras (sala/encontro) | Continuam sem gatilho real neste sub-projeto — decisão já tomada e explicitamente revalidada ("defensável, não reverteria") pela revisão final do sub-projeto anterior |

## 3. Arquitetura

```
src/
└── combat/
    └── encounter.ts   MODIFICADO — ganha `profile: ProfileAccumulator`, assina opp.close pra dim 3, atualiza dim 5 a cada step()
```

Nenhum arquivo novo. `AssaltanteController`, `PlayerController`, `ProfileAccumulator` e `OpportunitySystem` não mudam — toda a fiação fica em `Encounter`, que já é a única camada que enxerga combate e oportunidade ao mesmo tempo.

## 4. Componentes

### `src/combat/encounter.ts`
- Novo campo `readonly profile: ProfileAccumulator = new ProfileAccumulator();`, inicializado no construtor.
- No construtor, após as assinaturas já existentes: `this.bus.on('opp.close', (e) => { if (e.type === 'punish' && e.outcome !== 'invalid') this.profile.recordOutcome('punish', e.outcome); });`
- Em `step()`, antes ou depois do resto da lógica (ordem não importa para este cálculo, que só lê posições já atualizadas no fim do tick): calcula `distance = Math.hypot(assaltante.position.x - player.position.x, assaltante.position.y - player.position.y)`; converte `stepMs` para segundos e chama `this.profile.record('distance', distance <= ATTACK_REACH ? stepSegundos : 0, stepSegundos)` — a confiança dessa dimensão é medida em segundos de combate, não em ticks, conforme `especificacao-perfil-instrumentacao-v2.md` §3.1.

## 5. Fluxo de dados

Uma janela `punish` se resolve (via colisão real ou expiração, como já acontece) → `OpportunitySystem` emite `opp.close` no bus compartilhado → o listener assinado por `Encounter` no construtor recebe o evento e, se for `punish` não-`invalid`, chama `profile.recordOutcome('punish', outcome)`, que acumula no buffer pendente dos dois relógios do `ProfileAccumulator`. Em paralelo, a cada `Encounter.step()`, a distância atual entre jogador e Assaltante decide se o tick conta como "tempo em alcance" para a dimensão `distance`, via `profile.record()`. Nada disso é visível ainda sem chamar `applyRoomBoundary()`/`applyEncounterBoundary()` manualmente — o que os testes fazem diretamente, e o que um sub-projeto futuro (quando sala/encontro existirem) vai automatizar.

## 6. Testes

- `src/combat/encounter.test.ts`: um teste que resolve uma janela `punish` como `taken` (aterrissando um golpe durante `recovering`, como o teste existente já faz), chama `encounter.profile.applyRoomBoundary()` manualmente, e confirma que `encounter.profile.domain('punish', 'trait')` subiu acima do prior uniforme (0,5). Dois testes para a dimensão `distance`: jogador dentro de `ATTACK_REACH` a simulação toda → `domain('distance','trait')` próximo de 1 depois de `applyRoomBoundary()`; jogador longe a simulação toda → próximo de 0.
- Suite herdada dos cinco sub-projetos anteriores deve continuar passando sem regressão.

## 7. Critério de pronto

- Uma janela `punish` resolvida (`taken`/`missed`/`expired`) atualiza `encounter.profile`'s skill `'punish'`, verificável via `domain()`/`confidence()` depois de uma fronteira manual.
- Tempo em `ATTACK_REACH` atualiza a skill `'distance'` corretamente, tendendo a 1 quando o jogador fica perto e a 0 quando fica longe.
- Nenhuma fronteira automática foi introduzida — `applyRoomBoundary()`/`applyEncounterBoundary()` continuam exclusivamente chamáveis manualmente.
- Todos os testes automatizados herdados dos cinco sub-projetos anteriores continuam passando.

## 8. Próximos sub-projetos (fora deste spec)

Conforme `docs/especificacao-perfil-instrumentacao-v2.md` §8:
1. Dim 6 (paciência) — assim que "janela segura" virar um predicado implementável.
2. Dim 7 (uso de espaço) — assim que existir mecânica de reposicionamento (`OppType` `reposition`).
3. Família B de dimensões (entropia de repertório — dims 1/2/4), reaproveitando `DecayedRatio` para a agregação por segmento de `n` constante (§3.3).
4. Seleção de déficit-alvo com histerese (§6 do doc de perfil).
5. Sala/encontro como unidades discretas (depende do PCG) — só então `applyRoomBoundary()`/`applyEncounterBoundary()` ganham gatilho automático real.
