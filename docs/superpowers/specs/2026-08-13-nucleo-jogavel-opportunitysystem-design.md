# Spec — Núcleo Jogável Mínimo + OpportunitySystem

**Data:** 13/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** primeiro sub-projeto de um TCC maior (roguelike 2.5D com inimigos adaptativos — ver `arquitetura-tcc-v1_1.md`). Este spec cobre **apenas** o vertical slice inicial: combate mínimo + `OpportunitySystem`. Perfil, adaptação, PCG e telemetria de rede ficam para sub-projetos futuros.

---

## 1. Por que este recorte

O documento de arquitetura completo identifica o `OpportunitySystem` como a peça de maior risco técnico e a base de todo o resto (perfil, adaptação e telemetria dependem dele). Construir o jogo inteiro antes de validar essa peça inverteria o risco na ordem errada. Este slice existe para provar, com o menor código possível, que:

- é possível declarar oportunidades (`opp.open`/`opp.close`) com denominador explícito durante o combate real;
- o timestep fixo + PRNG semeado produzem execução determinística;
- a arquitetura suporta crescer (mais ações, mais arquétipos, mais tipos de oportunidade) sem reescrita.

Fora de escopo neste ciclo: telemetria de rede (buffer/POST/IndexedDB), perfil do jogador, adaptação (pesos de regra, BT do boss), PCG, múltiplos arquétipos, weight clipping/top-culling, eixo Z.

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Perspectiva de câmera | Top-down / isométrica, estilo Hades |
| Eixo Z | Não existe. Combate inteiro no plano do chão; y-sort é só ordem de desenho |
| Referência de "feel" | Combate ágil estilo Hades; estética visual mirando Elden Ring |
| Camada visual | Sprites 2D no slice atual, mas **desacoplada** da lógica de combate — troca futura por modelos 3D (via engine embutida ou sprites pré-renderizados a partir de modelos 3D) não deve tocar `combat/`, `opportunity/` ou `ai/` |
| Ações do jogador no slice | Ataque leve, esquiva. Sistema de ações **data-driven** desde já, para que pesado/carregado/aéreo/arremesso/utilitário/bloqueio/contra-ataque sejam adições de dados, não reescritas |
| Oportunidades no slice | `dodge` e `punish` |
| Arquétipo de inimigo | 1 (Assaltante), 2–3 regras, prioridade fixa — sem roleta ponderada de verdade ainda |
| Validação | Overlay visual de debug mostrando abertura/fechamento de janelas em tempo real, mais testes automatizados determinísticos |
| Stack | Phaser 3 + TypeScript, bundler Vite, testes Vitest |

## 3. Arquitetura

```
src/
├── core/          loop de timestep fixo, PRNG semeado, barramento de eventos
├── combat/        hitboxes, frames, janelas, estados (jogador + Assaltante)
├── opportunity/   registro de oportunidades, abertura/fechamento, resolução
├── ai/
│   ├── rules/     regras do Assaltante, com opportunity_tags (interface Rule do doc original)
│   └── selector/  seleção por prioridade fixa (roleta ponderada adiada)
├── debug/         overlay visual de oportunidades — só existe neste ciclo
└── scenes/        cena única de arena de teste
```

Pastas do documento original não criadas ainda: `profile/`, `adaptation/`, `pcg/`, `telemetry/`. A interface de eventos (`opp.open`/`opp.close`, mesmo formato do esquema §4.1 do documento original) já é real desde este slice — só o consumidor muda (hoje: `debug/`; depois: pipeline de telemetria).

### Restrição de design: lógica de combate nunca referencia asset visual

`combat/`, `opportunity/` e `ai/` operam sobre estado abstrato (posição, hitbox, estado de animação lógica — não o sprite em si). `scenes/` é a única camada que lê esse estado para desenhar. Isso é o que permite trocar sprites 2D por modelos 3D depois sem tocar em lógica de jogo.

## 4. Componentes

### `core/`
- Loop de timestep fixo (ex: 60Hz lógico), desacoplado do framerate de render do Phaser.
- PRNG único semeado (ex: mulberry32/xorshift, sem dependência externa). `Math.random()` proibido em `core/`, `combat/`, `ai/`, `opportunity/`.
- Barramento de eventos simples (`emit`/`on`) por onde trafegam `opp.open`, `opp.close`, `player.action`.

### `combat/`
- Jogador: posição 2D, estados (idle, atacando, esquivando, atordoado), hitbox/hurtbox.
- Ataque leve: startup → active → recovery, frames configuráveis por dados.
- Esquiva: i-frames por N ms + cooldown.
- Assaltante: máquina de estados dirigida por `Rule[]` (persegue, ataca, recua-após-atacar), decidida por prioridade fixa (não roleta).

### `opportunity/`
- `dodge`: janela em torno do ataque do inimigo.
- `punish`: janela após o inimigo errar ou entrar em recovery.
- Cada `Rule` que abre uma oportunidade chama `opportunitySystem.open({type, window_ms, src})`; o sistema fecha com `outcome: 'taken'|'missed'|'expired'` conforme a ação do jogador ou timeout.

### `ai/rules`
- Interface `Rule` conforme o documento original (`id`, `archetype`, `opportunity_tags`, `precond`, `act`), sem `base_weight` operante ainda (campo existe na interface para não quebrar compatibilidade futura, mas não influencia seleção neste slice).

### `debug/`
- Overlay visual (texto/cor na tela) reagindo aos eventos `opp.open`/`opp.close` do barramento em tempo real.

## 5. Fluxo de dados

`ai/rules` decide ação do Assaltante → `combat/` executa e abre hitbox → `opportunity/` observa transições de combate via eventos (não acoplamento direto) e abre/fecha janelas → `debug/` renderiza o estado das janelas.

## 6. Testes

- Vitest cobre `core/` e `opportunity/`: dada uma sequência fixa de inputs e uma semente, o `OpportunitySystem` deve abrir/fechar as janelas certas, sempre no mesmo frame.
- Sem testes de renderização/Phaser neste ciclo — lógica testável vive fora de `scenes/`.

## 7. Critério de pronto

- Cena de teste roda no navegador; overlay de debug acusa `dodge` e `punish` abrindo/fechando corretamente durante combate ao vivo contra o Assaltante.
- Testes automatizados cobrem os mesmos casos de abertura/fechamento sem depender do navegador.
- Nenhum uso de `Math.random()` fora de `debug/`/efeitos visuais.

## 8. Próximos sub-projetos (fora deste spec)

1. Perfil do jogador (`profile/`): agregadores, EWMA, entropia, domínio por oportunidade, déficits — depende deste slice estar validado.
2. Telemetria de rede (`telemetry/`): esquema versionado, buffer, IndexedDB, POST em lote — reusa o barramento de eventos já existente.
3. Roleta ponderada real + weight clipping/top-culling, mais arquétipos.
4. PCG (`pcg/`) e boss (`ai/bt/`, `ai/boss/`).
5. Decisões ainda abertas no documento original (§11): humanos vs. agentes sintéticos, medida de retenção, corte de 7 para 4–5 dimensões de perfil.
6. `OppOutcome` (`src/opportunity/types.ts`) é intencionalmente restrito a `'taken' | 'expired'` neste sub-projeto — o código nunca emite `'missed'` nem `'invalid'`. Esses dois outcomes ficam deferidos até o sub-projeto `profile/` definir o que conta como resposta errada para fins de knowledge tracing (ex.: jogador atacou quando deveria ter esquivado, contando como `'missed'` em vez de simplesmente ausente). Isso segue o esquema de evento de quatro outcomes do documento de arquitetura original (§4.1), que o código deste sub-projeto intencionalmente ainda não implementa por completo.
