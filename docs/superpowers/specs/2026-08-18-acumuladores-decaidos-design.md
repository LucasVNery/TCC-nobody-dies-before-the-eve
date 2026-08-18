# Spec — Acumuladores Decaídos + `profile.snapshot`

**Data:** 18/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** quinto sub-projeto do TCC (ver `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md`, `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md`, `docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md` e `docs/superpowers/specs/2026-08-18-ciclo-vida-oportunidade-design.md` para os quatro anteriores). Este spec implementa o passo 3 da ordem de implementação sugerida em `docs/especificacao-perfil-instrumentacao-v2.md` §8: o mecanismo de contagens decaídas do §4 (dois relógios — traço e estado — com o mesmo mecanismo de decaimento) e o formato de dados do `profile.snapshot` do §7, como uma classe autocontida e testável, sem ligá-la a nenhum evento real do jogo ainda.

---

## 1. Por que este recorte

O sub-projeto anterior deu ao `OpportunitySystem` os quatro outcomes reais (`taken`/`missed`/`expired`/`invalid`), que são a matéria-prima do perfil do jogador. O doc de perfil (§4) define como agregar esses outcomes ao longo do tempo — contagens decaídas por `γ`, aplicadas em duas fronteiras diferentes (sala, para o perfil-traço; encontro, para o estado de curto prazo) — e o formato do evento `profile.snapshot` (§7) que materializa esse estado.

O jogo hoje **não tem** o conceito de sala ou encontro como unidades discretas: existe um único `Encounter` contínuo, sem transição, sem fim de encontro, sem morte do jogador. Amarrar os acumuladores a fronteiras reais agora seria inventar uma semântica que não corresponde a nada — as fronteiras de verdade só existirão quando o PCG (múltiplas salas) e possivelmente um sistema de morte existirem, no futuro roadmap do §8.

Este sub-projeto existe para:
- implementar o mecanismo de decaimento do §4 (`total ← γ · total + pendente`) como uma classe pura, genérica sobre qualquer `SkillId` (não amarrada às 7 dimensões, que são os passos 4/5 do §8);
- manter os dois relógios (traço `γ=0,87`, estado `γ=0,55`) como acumuladores independentes, cada um com seu próprio gatilho de fronteira;
- implementar as fórmulas de domínio/confiança/déficit da Família A (§3.1: `α=β=1`, `κ=10`) sobre essas contagens;
- implementar `resetSession()` como o único ponto de zeragem total, provando estruturalmente a persistência entre runs (D4 do doc de perfil);
- produzir o formato de `profile.snapshot` (§7) a partir do relógio traço, com os campos que dependem de sub-projetos futuros (`target`, `lambda`) como placeholders explícitos.

Fora de escopo: qualquer gatilho real (nenhum evento do jogo chama `applyRoomBoundary()`/`applyEncounterBoundary()`/`recordOutcome()` ainda — isso é trabalho de integração para quando sala/encontro existirem de verdade); as 7 dimensões de perfil e suas fórmulas específicas (Família A completa com os denominadores reais, Família B de entropia) — passos 4/5 do §8; seleção de déficit-alvo com histerese — passo 6; adicionar `profile.snapshot` ao `GameEvents`/`EventBus` compartilhado — não faz sentido registrar um evento no barramento antes de existir quem o emita de verdade.

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Módulo | `src/profile/` — pasta nova, já reservada desde o primeiro spec do projeto, nunca criada até agora |
| Acoplamento | Lógica pura, sem Phaser, **sem dependência do `EventBus`/`GameEvents`** nesta rodada — desacoplada como `combat/movement.ts`, esperando integração num sub-projeto futuro |
| `SkillId` | `string` genérico — não amarra ainda nas 7 dimensões (Família A/B ficam para os passos 4/5) |
| Registro de outcome | `recordOutcome(skill, taken: boolean)` — `oportunidades += 1` sempre, `aproveitadas += 1` só se `taken`. `invalid` nunca é passado (D3: excluído de numerador e denominador — decisão do chamador, não da classe) |
| Dois relógios independentes | Cada `recordOutcome()` alimenta os dois buffers pendentes (traço e estado) ao mesmo tempo; `applyRoomBoundary()` só decai/reseta o traço, `applyEncounterBoundary()` só decai/reseta o estado |
| Fórmulas (Família A) | `domínio = (aproveitadas + 1) / (oportunidades + 2)`, `déficit = 1 - domínio`, `confiança = oportunidades / (oportunidades + 10)` — direto do §3.1/§5 do doc de perfil |
| Persistência (D4) | `resetSession()` é o único método que zera tudo. Não existe método de reset entre runs — a ausência estrutural de um "resetRun" é a prova de D4 |
| `profile.snapshot` | `snapshot(at)` lê só o relógio **traço** (bate com "perfil, fronteira de sala, consumido pelo Estudo 1" do §4) e retorna o formato do §7 com `target: null` e `lambda: 0` fixos — campos que só ganham sentido quando a seleção de déficit-alvo (passo 6) existir |

## 3. Arquitetura

```
src/
└── profile/                    NOVO
    ├── types.ts                NOVO — SkillId, Clock, ProfileSnapshotPayload
    └── profileAccumulator.ts   NOVO — class ProfileAccumulator
```

`src/profile/` não importa de `combat/`, `opportunity/`, `ai/`, `core/eventBus`, nem `core/events` — só seus próprios tipos. Nenhum arquivo existente é modificado neste sub-projeto.

## 4. Componentes

### `src/profile/types.ts`
```ts
export type SkillId = string;
export type Clock = 'trait' | 'state';

export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  counts: Record<SkillId, [number, number]>; // [aproveitadas, oportunidades], relógio traço
  domain: Record<SkillId, number>;
  confidence: Record<SkillId, number>;
  target: SkillId | null; // sempre null neste sub-projeto — seleção de alvo é passo 6
  lambda: number;         // sempre 0 neste sub-projeto — pesos de regra são passo 7
}
```

### `src/profile/profileAccumulator.ts`
```ts
const TRAIT_GAMMA = 0.87;
const STATE_GAMMA = 0.55;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const CONFIDENCE_KAPPA = 10;

interface SkillCounts { aproveitadas: number; oportunidades: number; }

export class ProfileAccumulator {
  // dois mapas de contagens decaídas (trait, state), dois mapas de buffers pendentes (trait, state)

  recordOutcome(skill: SkillId, taken: boolean): void;
  applyRoomBoundary(): void;
  applyEncounterBoundary(): void;
  resetSession(): void;

  domain(skill: SkillId, clock: Clock): number;
  confidence(skill: SkillId, clock: Clock): number;
  deficit(skill: SkillId, clock: Clock): number;

  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload;
}
```

- `recordOutcome`: incrementa `oportunidades` (e `aproveitadas` se `taken`) nos buffers pendentes de **ambos** os relógios. Não decai nada — só acumula.
- `applyRoomBoundary`/`applyEncounterBoundary`: para cada skill com buffer pendente não-zero no relógio correspondente, aplica `total.aproveitadas = γ·total.aproveitadas + pendente.aproveitadas`, `total.oportunidades = γ·total.oportunidades + pendente.oportunidades`, depois zera o buffer pendente daquele relógio. Skills sem contagem decaída ainda começam implicitamente em `{aproveitadas:0, oportunidades:0}`.
- `domain`/`confidence`/`deficit`: leem as contagens decaídas do relógio pedido (não o buffer pendente) e aplicam as fórmulas fixas da tabela acima. Uma skill nunca vista retorna `domain=0,5` (prior uniforme), `confidence=0`, `deficit=0,5`.
- `snapshot`: itera as skills conhecidas no relógio traço, monta `counts`/`domain`/`confidence`, fixa `target: null` e `lambda: 0`.

## 5. Fluxo de dados

Só interno à classe, sem integração externa: `recordOutcome()` empilha nos dois buffers pendentes → `applyRoomBoundary()`/`applyEncounterBoundary()` fundem o buffer correspondente no total decaído pela fórmula `γ` e zeram esse buffer → `domain()`/`confidence()`/`deficit()` derivam das contagens decaídas a qualquer momento, sem side effect → `snapshot()` empacota o relógio traço no formato do §7.

## 6. Testes

- Fórmulas nos casos-limite: skill nunca vista (`domain=0,5`, `confidence=0`), depois de registros (`domain`/`confidence` convergem corretamente pelas fórmulas fixas).
- Decaimento: duas chamadas consecutivas de `applyRoomBoundary()` sem novos registros entre elas encolhem o total decaído pelo fator `γ=0,87` a cada chamada (prova a decadência exponencial); mesma prova para `applyEncounterBoundary()` com `γ=0,55`.
- Independência dos relógios: registrar um outcome alimenta os dois buffers pendentes, mas `applyRoomBoundary()` nunca deve alterar as contagens decaídas do relógio estado, e vice-versa.
- `resetSession()` zera tudo (traço, estado, pendentes de ambos); nenhum outro método público zera dados — prova estrutural de D4 (persistência entre runs).
- `snapshot()` reflete só o relógio traço, com `target: null`/`lambda: 0` fixos, e escala corretamente para múltiplas skills simultâneas.

## 7. Critério de pronto

- `ProfileAccumulator` implementa `recordOutcome`/`applyRoomBoundary`/`applyEncounterBoundary`/`resetSession`/`domain`/`confidence`/`deficit`/`snapshot` conforme especificado.
- Os dois relógios decaem de forma independente e comprovadamente exponencial (`γ` aplicado a cada chamada de fronteira, não só uma vez).
- `resetSession()` é o único ponto de zeragem total; testes provam que nada mais reseta as contagens.
- Todos os testes automatizados herdados dos quatro sub-projetos anteriores continuam passando.

## 8. Próximos sub-projetos (fora deste spec)

Conforme `docs/especificacao-perfil-instrumentacao-v2.md` §8, passos 4 em diante:
1. Família A de dimensões (punição, distância operacional, paciência, uso de espaço — dims 3/5/6/7), consumindo `ProfileAccumulator` com `SkillId`s reais em vez de strings genéricas.
2. Família B de dimensões (entropia de repertório — dims 1/2/4) com os três casos-limite do §3.3 — precisa de um acumulador de entropia separado, não coberto por `ProfileAccumulator`.
3. Seleção de déficit-alvo com histerese (§6 do doc de perfil) — é quando `target`/`lambda` no `profile.snapshot` ganham valores reais.
4. Integração real: sala/encontro como unidades discretas (depende do PCG), morte do jogador, e só então ligar `recordOutcome`/`applyRoomBoundary`/`applyEncounterBoundary` a eventos reais do jogo e adicionar `profile.snapshot` ao `GameEvents`.
5. As três condições de `missed`/`invalid` ainda não implementadas, identificadas na revisão final do sub-projeto anterior (dodge trocado por punish, whiff de punish, janela de dodge fora de alcance).
