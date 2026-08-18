# Spec — Ciclo de Vida da Oportunidade (Quatro Outcomes)

**Data:** 18/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** quarto sub-projeto do TCC (ver `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md`, `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md` e `docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md` para os três anteriores). Este spec implementa o passo 1+2 da ordem de implementação sugerida em `docs/especificacao-perfil-instrumentacao-v2.md` §8: expandir `OppOutcome` de dois para quatro desfechos (`taken`/`missed`/`expired`/`invalid`), sua tabela de precedência, e os dois gatilhos reais já possíveis com o jogo atual — deixando contagens decaídas, as 7 dimensões de perfil e seleção de déficit-alvo para sub-projetos seguintes.

---

## 1. Por que este recorte

Hoje o `OpportunitySystem` só emite `taken` (dodge bem-sucedido / hit de punish aterrissado) e `expired` (janela fechou sem resposta). Isso bastou para provar a mecânica de abertura/fechamento de janelas, mas o documento de perfil/instrumentação (`especificacao-perfil-instrumentacao-v2.md`) identifica os quatro outcomes como pré-requisito de tudo o que vem depois — o sinal diagnóstico `omissao(s)` (§2.4 do doc), as fórmulas de domínio (§3.1/§3.2), e a auditoria de denominador (§8, passo 2) dependem de `missed` e `invalid` existirem de verdade no esquema de eventos.

Este sub-projeto existe para:
- expandir `OppOutcome` para os quatro valores com a tabela de precedência `invalid > taken > missed > expired` (§2.1 do doc de perfil);
- implementar o único caso de `missed` já possível com o jogo atual: jogador ataca durante uma janela de esquiva aberta (§2.1a, ação de classe incompatível);
- implementar o único caso de `invalid` já possível: jogador nunca entra em alcance efetivo durante toda a janela de `punish` (§2.2, condição 2);
- adicionar os campos `reason`/`attempt` ao evento `opp.close`, com validação de que `invalid` sempre carrega `reason` (§2.2: "sem isso não há como distinguir instrumentação correta de bug que está engolindo denominador");
- provar com testes que a soma dos desfechos fecha com o total de aberturas (§8, passo 2 do doc de perfil).

Fora de escopo: as outras quatro condições canônicas de `invalid` (hitstun de outra fonte, morte do jogador, ferramenta bloqueada, prioridade sobreposta) — nenhuma delas é possível hoje, porque o jogo não tem sistema de hitstun externo, morte, desbloqueio de ferramentas, ou oportunidades concorrentes. Contagens decaídas, as 7 dimensões de perfil, seleção de déficit-alvo, pesos de regra e telemetria de rede ficam para sub-projetos seguintes, conforme a ordem do §8 do doc de perfil.

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| `OppOutcome` | `'taken' \| 'missed' \| 'expired' \| 'invalid'` — substitui o `'taken' \| 'expired'` atual |
| `InvalidReason` | Conjunto fechado com as 6 razões do §2.2 do doc de perfil, mesmo que só uma (`'out_of_range'`) seja emitida por este sub-projeto — as outras 5 ficam no tipo para os sub-projetos que as implementarem não precisarem tocar no schema de novo |
| Validação de `invalid` | `OpportunitySystem.resolve()` lança `Error` se `outcome==='invalid'` e `reason` estiver ausente — única validação nova, pois é a fronteira que o doc de perfil aponta como risco de denominador vazando |
| Precedência `taken > missed` | Garantida pela ordem de checagem em `Encounter.step()`: colisão (dodge-success/hit-landed) sempre resolvida antes de qualquer reação a `missed` no mesmo instante — sem necessidade de lógica de arbitragem explícita, porque `resolve()` em oportunidade já fechada é no-op (comportamento já existente) |
| Gatilho de `missed` | Jogador chama `tryLightAttack()` (emite `player.action` com `action:'light_attack'`) enquanto o Assaltante está em `attacking` (janela `dodge` aberta) → `AssaltanteController.onPlayerWrongAction('light_attack')` resolve a oportunidade `dodge` ativa como `missed` com `attempt:'light_attack'` |
| Gatilho de `invalid` | Durante `recovering` (janela `punish` aberta), o Assaltante rastreia se o jogador esteve dentro de `ATTACK_REACH` em algum frame. Se a janela expira sem isso ter ocorrido nunca, resolve como `invalid`/`reason:'out_of_range'` em vez de `expired` |
| Extensão de `OpportunitySystem.open()` | Ganha um parâmetro opcional `onExpire?: () => { outcome: 'expired' \| 'invalid'; reason?: InvalidReason }`, chamado pelo timer de expiração em `step()` no lugar de sempre emitir `'expired'` — é o único gancho novo na API pública do sistema |

## 3. Arquitetura

```
src/
├── opportunity/
│   ├── types.ts             MODIFICADO — OppOutcome (4 valores), InvalidReason, ActionId, OppClosePayload com reason/attempt
│   └── opportunitySystem.ts MODIFICADO — resolve() valida invalid+reason; open() aceita onExpire opcional
└── combat/
    ├── encounter.ts             MODIFICADO — assina 'player.action' no bus, chama onPlayerWrongAction quando aplicável
    └── assaltanteController.ts  MODIFICADO — onPlayerWrongAction(attempt); rastreia alcance durante recovering; passa onExpire ao abrir o punish
```

Nenhuma pasta nova. `PlayerController` não muda — ele já emite `player.action`, o novo consumidor é o `Encounter`.

## 4. Componentes

### `src/opportunity/types.ts`
```ts
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';
export type ActionId = 'light_attack' | 'dodge';
export type InvalidReason =
  | 'other_source_hitstun'
  | 'out_of_range'
  | 'player_dead'
  | 'tool_locked'
  | 'source_interrupted'
  | 'overlapping_priority';

export interface OppClosePayload {
  opp_id: string;
  type: OppType;
  outcome: OppOutcome;
  reason?: InvalidReason;  // presente quando outcome === 'invalid'
  attempt?: ActionId;      // presente quando outcome === 'missed'
}
```

### `src/opportunity/opportunitySystem.ts`
- `open(type, src, windowMs, onExpire?)`: guarda `onExpire` junto com a entrada em `active`.
- `resolve(opp_id, outcome, extras?)`: `extras: { reason?: InvalidReason; attempt?: ActionId }`. Se `outcome === 'invalid'` e `extras?.reason` for `undefined`, lança `Error('invalid outcome requires a reason')` — a checagem acontece antes de remover a oportunidade de `active` (chamada inválida não deve fechar a janela).
- `step(stepMs)`: no timeout, se a oportunidade tem `onExpire`, chama e usa o resultado (`outcome`/`reason`) para o `opp.close`; senão, mantém o comportamento atual (`outcome: 'expired'`).

### `src/combat/assaltanteController.ts`
- Novo `onPlayerWrongAction(attempt: ActionId): void` — se `this.state === 'attacking'` e há `activeOppId` (a oportunidade `dodge` da fase de telegraph/swing), chama `this.opp.resolve(this.activeOppId, 'missed', { attempt })` e zera `activeOppId`.
- Novo campo privado `playerWasInRangeDuringPunish = false`, resetado para `false` sempre que abre uma oportunidade `punish`.
- Dentro de `step()`, enquanto `state === 'recovering'`, atualiza `playerWasInRangeDuringPunish ||= distanceToPlayer <= ATTACK_REACH` a cada chamada.
- Ao chamar `this.opp.open('punish', 'assaltante.recover', RECOVERY_MS, onExpire)`, o `onExpire` fechado sobre `this` retorna `{ outcome: 'invalid', reason: 'out_of_range' }` se `!this.playerWasInRangeDuringPunish`, senão `{ outcome: 'expired' }`.

### `src/combat/encounter.ts`
- No construtor, após criar `player`/`assaltante`: `this.bus.on('player.action', (e) => { if (e.action === 'light_attack' && this.assaltante.state === 'attacking') this.assaltante.onPlayerWrongAction('light_attack'); });`

## 5. Fluxo de dados

`ArenaScene` chama `player.tryLightAttack()` → `PlayerController` emite `player.action` no bus compartilhado → o listener assinado por `Encounter` no construtor recebe o evento na hora (síncrono) → se o Assaltante estiver com uma janela `dodge` aberta (`state==='attacking'`), chama `assaltante.onPlayerWrongAction('light_attack')`, que resolve a oportunidade como `missed`. Em paralelo, durante `recovering`, `assaltante.step()` atualiza a flag de alcance a cada tick; quando o timer da oportunidade `punish` expira dentro de `OpportunitySystem.step()`, o `onExpire` fornecido na abertura decide entre `expired` e `invalid`/`out_of_range`. `taken` continua vindo das checagens de colisão já existentes em `Encounter.step()`, que rodam antes de qualquer possibilidade de `missed` no mesmo instante fechar a mesma oportunidade — preservando `taken > missed` sem lógica de arbitragem extra, porque resolver uma oportunidade já fechada é no-op.

## 6. Testes

- `src/opportunity/opportunitySystem.test.ts`: testes novos para os quatro outcomes isolados (incluindo `invalid` com e sem `reason`, o segundo lançando erro), para o `onExpire` custom sendo respeitado no timeout, e um teste de conservação — dada uma sequência arbitrária de `open`/`resolve`/expiração por tempo, a soma de `opp.close` emitidos bate exatamente com o total de `opp.open`.
- `src/combat/assaltanteController.test.ts`: testes novos para `onPlayerWrongAction` (ataque durante telegraph/swing → `missed` com `attempt:'light_attack'`; chamado fora de `attacking` → no-op) e para o `onExpire` do `punish` (jogador nunca entra em `ATTACK_REACH` durante toda a janela → `invalid`/`out_of_range`; jogador entra em alcance em algum frame mas não ataca → `expired` normal).
- `src/combat/encounter.test.ts`: um teste de integração ponta a ponta para o caminho `missed` — jogador chama `tryLightAttack()` durante o telegraph do Assaltante, e o `opp.close` observado no bus tem `outcome:'missed'` e `attempt:'light_attack'`.
- Suite herdada dos três sub-projetos anteriores deve continuar passando sem regressão.

## 7. Critério de pronto

- `OppOutcome` tem quatro valores; `resolve('invalid', ...)` sem `reason` lança erro.
- Atacar durante a janela de esquiva do Assaltante fecha essa oportunidade como `missed` (visível no overlay de debug e no HUD, se aplicável).
- Ficar fora de `ATTACK_REACH` durante toda a janela de `punish` fecha essa oportunidade como `invalid`/`out_of_range` em vez de `expired`.
- Teste de conservação do denominador passa: nenhuma oportunidade aberta fica sem um `opp.close` correspondente, para qualquer sequência de eventos testada.
- Todos os testes automatizados herdados dos três sub-projetos anteriores continuam passando.

## 8. Próximos sub-projetos (fora deste spec)

Conforme `docs/especificacao-perfil-instrumentacao-v2.md` §8, passos 3 em diante:
1. Acumuladores decaídos (§4 do doc de perfil) + evento `profile.snapshot`.
2. Família A de dimensões (punição, distância operacional, paciência, uso de espaço — dims 3/5/6/7).
3. Família B de dimensões (entropia de repertório — dims 1/2/4) com os três casos-limite do §3.3.
4. Seleção de déficit-alvo com histerese (§6 do doc de perfil).
5. Pesos de regra e parâmetros de árvore de comportamento do boss.
6. As outras cinco condições de `invalid` (hitstun externo, morte, ferramenta bloqueada, fonte interrompida, prioridade sobreposta) — cada uma depende de um sistema de jogo que ainda não existe (hitstun externo, morte, desbloqueio, múltiplas oportunidades concorrentes).
