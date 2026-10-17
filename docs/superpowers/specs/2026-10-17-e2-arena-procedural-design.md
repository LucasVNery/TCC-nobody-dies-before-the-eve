# E2: Arena procedural com tiles do Blender — Design

**Data:** 2026-10-17
**Status:** rascunho para revisão do autor (escrito com padrões do Claude, conforme pedido; escolhas minhas estão marcadas como **[minha escolha]**).
**Sub-projeto:** E2 do ambiente de gameplay v2. Sequência: E1 (feito) → **E2 arena** → E3 herói e inimigo comum animados → E4 chefe. Contexto: `Contexto_pesquisa/documento-tecnico-mestre.md` §3.3 e §3.8.

## 1. Intenção

A tese é sobre o sistema de análise de perfil; o ambiente só precisa ser **legível, coerente e feito por você**. A arena é a parte da arte mais barata de tornar autoral: poucos tiles, sem rig e sem animação. Hoje o chão é um tabuleiro fixo de dois tiles de origem não registrada (`grass.png` no miolo, `water.png` na borda), o que deixa uma licença pendente.

O E2 troca esse chão por **3 a 6 tiles modelados do zero no Blender** e por uma **função pura que compõe o piso a partir de uma seed**. O resultado é uma arena mais bonita, que varia de sala para sala e que se **expande trocando só números** (tamanho) ou o conjunto de tiles.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Tileset próprio (5 tiles, ver §4.1), gerado por script reproduzível no Blender em modo headless, sem texturas de imagem externas (modelos e materiais procedurais ⇒ licença própria, sem dependência).
- `composeFloor(seed, colunas, linhas, tileset)` determinística, testada em Node.
- Piso reconstruível a partir do log **sem mudar o formato do log** (§5).
- A arena lê bem no zoom padrão de 2×, com as sobreposições de telegrafia e depuração visíveis sobre qualquer tile.
- Remover `grass.png` e `water.png` ao fim, resolvendo a pendência de licença deles.

**Não-objetivos**
- Paredes, obstáculos, pilares, decoração com colisão ou qualquer elemento que mude geometria jogável. Isso mudaria a lógica e exigiria nova `GAME_VERSION` (E2 é **só visual**).
- Props decorativos sem colisão (tochas, rachaduras grandes). Possível E2.5, fora daqui.
- Iluminação dinâmica, partículas, parallax, animação de tiles.
- Personagens, armas, som (E3, E4).
- Mostrar a seed do piso no painel de análise.

**Anti-objetivos (falha mesmo que "funcione")**
- O chão competir com telegrafia, projéteis ou personagens (alto contraste, padrão de alta frequência, saturação alta).
- Qualquer mudança em colisão, limites, velocidades, alcances ou no log. Os 445 testes atuais têm de passar **sem alteração**.
- Consumir o PRNG do jogo para compor o piso (alteraria a sequência de eventos e quebraria o replay).

## 3. Restrições

- **`GAME_VERSION` continua `0.0.2+combatB`.** Arte e arena visual podem mudar sem nova versão (documento mestre §8.5), desde que a lógica fique idêntica.
- A lógica (`core`, `combat`, `opportunity`, `profile`, `ai`, `game`, `telemetry`) **não importa** Phaser nem `visual/`. A composição do piso fica em `src/visual/floor/` (função pura, sem Phaser) e só a vista do mundo a usa.
- Projeção: losango 2:1; tile lógico de 64 unidades ⇒ 64 × 32 px na tela (`ISO_CONFIG`). Câmera ortográfica do Blender a 26,57°, a mesma do pipeline dos personagens (`tools/blender/render_character.py`).
- Tamanho atual da arena: `ARENA_BOUNDS` = 1600 × 1200 (25 × 19 tiles). Continua sendo a fonte da verdade da lógica; o piso lê esse valor, não o define.
- **Objetos criados depois do `CameraRig.attach` aparecem nas duas câmeras** (achado do E1). O piso é trocado a cada sala; portanto os tiles devem viver em **um contêiner criado uma vez, antes do `attach`**, cujos filhos são substituídos. Não criar imagens soltas na cena depois do `attach`.
- Convenção de commits: Conventional Commits em inglês, sem trailer de co-autoria; mensagens aprovadas pelo autor.

## 4. Decisões

### 4.1 Tileset **[minha escolha]**

Tema: **laje de pedra de masmorra**, poligonal, sombreado chapado (*flat shading*), paleta fria e dessaturada, luminosidade numa faixa estreita. Motivo: contrasta com os personagens e com as sobreposições (telegrafia em cores quentes), combina com o estilo "Zelda antigo" que você pediu e é simples de modelar com poucos polígonos.

| Id | Papel | Descrição |
|---|---|---|
| `floor_base` | miolo, mais frequente | laje lisa, bisel leve |
| `floor_a` | variação 1 | laje com divisão ao meio |
| `floor_b` | variação 2 | laje com um chanfro no canto |
| `floor_worn` | desgastado, raro | laje com depressão rasa e uma rachadura |
| `floor_edge` | borda | laje da moldura externa, mais escura e com meia-altura visível no lado de fora |

Regras de arte (valem como lista de verificação, não como teste automático): sem linhas finas de alto contraste; diferença de luminosidade entre quaisquer dois tiles pequena; nenhuma cor do tileset usa o matiz das sobreposições de telegrafia (vermelho e laranja saturados).

Formato: PNG com fundo transparente, **128 × 64 px de losango** (renderizado em 2× e exibido a 64 × 32, para ficar nítido no zoom 2×). O quadro exato (margens, âncora) deve repetir o que o `groundTilemap` atual espera de `grass.png`; o implementador mede o arquivo atual e mantém a mesma âncora.

### 4.2 Composição

```
composeFloor(seed: number, colunas: number, linhas: number, tileset: TileSet): string[][]
```

- `TileSet`: `{ border: string[]; interior: { id: string; weight: number }[] }` (ids de tile e pesos). Trocar o conjunto não muda nada além dos ids devolvidos.
- Devolve a matriz `[linha][coluna]` de ids.
- A moldura (primeira e última linha e coluna) usa `border`; o miolo sorteia por peso.
- Regra de vizinhança **[minha escolha]**: um tile do miolo não repete a variação do vizinho da esquerda nem a do vizinho de cima, exceto se só existir uma opção. Isso evita faixas e blocos repetidos. `floor_worn` nunca fica adjacente (4-vizinhança) a outro `floor_worn`.
- PRNG próprio e pequeno (por exemplo *mulberry32*) dentro do módulo. **Não** usa o PRNG do jogo.
- Pura e determinística: mesma entrada ⇒ mesma matriz; `colunas` ou `linhas` menores que 3 ⇒ lança erro com mensagem clara (miolo vazio não faz sentido).

### 4.3 Seed e registro **[minha escolha]**

O documento mestre propunha gravar a seed do piso no log. Não é necessário mudar o log:

```
floorSeed(runSeed: number, roomIdx: number): number   // função pura, hash inteiro
```

`run.start` já registra `seed` e `room.enter` já registra `room_idx`. O piso de cada sala é `composeFloor(floorSeed(seed, room_idx), …)`. Assim o piso é reconstruível só com o log existente, sem campo novo e sem tocar a lógica. Uma função `floorFromEvents(events)` (pura) devolve o piso de uma sala a partir dos eventos do log, para a análise e para o texto da tese.

**Efeito visível:** a arena muda a cada sala (cada `room.enter`), o que dá variedade e reforça a sensação de progressão sem alterar a jogabilidade.

### 4.4 Integração na cena

- O contêiner do piso é criado em `WorldView` antes do `CameraRig.attach`.
- A cena reage a `run.start` (guarda a seed) e `room.enter` (reconstrói o piso) por meio da assinatura do gravador que já existe (`recorder.subscribe`), sem tocar o `RunDirector`.
- Antes do primeiro `room.enter` (boot), o piso usa uma seed fixa de reserva; na prática o primeiro `room.enter` chega no mesmo quadro do boot.
- Reconstruir = limpar e recriar as imagens filhas do contêiner (≈ 475 por sala); é um custo por troca de sala, não por quadro.
- `groundTilemap.ts` passa a receber a matriz pronta; deixa de decidir tiles.

### 4.5 Pipeline do Blender

Novo script `tools/blender/render_floor_tiles.py`, em modo headless (`blender --background --python …`), igual aos demais: modela os 5 tiles proceduralmente (poucas faces, material de cor sólida, sombreado chapado), usa a câmera ortográfica a 26,57° do pipeline de personagens e escreve os PNGs em `public/assets/tiles/floor/`. Os parâmetros (cores, bisel, profundidade) ficam no topo do script para o ajuste ser barato. O Blender MCP não precisa estar conectado.

Os ids dos tiles entram no `assetRegistry` existente (um registro por tile).

## 5. Testes e aceitação

Testes em Node (Vitest, sem DOM):
- Determinismo: mesma entrada ⇒ matriz idêntica (`toEqual`); seeds diferentes ⇒ matrizes diferentes (para uma lista fixa de seeds).
- Dimensões: devolve `linhas × colunas`; 25 × 19 e 40 × 30 funcionam; menos de 3 lança erro.
- Moldura: todas as células da borda pertencem a `border`; nenhuma do miolo pertence.
- Vizinhança: nenhum tile do miolo repete a variação do vizinho esquerdo/superior quando há alternativa; nenhum par de `floor_worn` adjacente. Verificado em várias seeds.
- Independência do conjunto: trocar o `TileSet` por outro com os mesmos papéis mantém as **posições** dos papéis (moldura e miolo) e só muda os ids.
- `floorSeed`: determinística, e salas diferentes da mesma run dão seeds diferentes.
- `floorFromEvents`: dado um log sintético com `run.start{seed}` e `room.enter{room_idx}`, reconstrói a mesma matriz que `composeFloor` direta.
- A suíte atual (445 testes) passa **sem alteração**; `GAME_VERSION` inalterada.

Verificação manual (jogo no navegador, a cargo do autor):
- A arena lê bem a 2× e o telegrafo do inimigo e as caixas de depuração (F-teclas do painel) ficam visíveis sobre todos os 5 tiles.
- Trocar de sala muda o piso sem tremor nem duplicação de imagens na câmera da interface.
- Recarregar e importar histórico (F9) não deixa pisos duplicados.

**Critério de pronto da arte (limite de escopo):** o autor aprova os 5 tiles vistos em jogo a 2×. **No máximo 2 rodadas de ajuste** depois da primeira entrega; depois disso o conjunto é considerado final e o E3 começa.

## 6. Deixado ao implementador

- Detalhes de modelagem dos 5 tiles dentro do que está em §4.1.
- Como gerar o PRNG e o hash (desde que determinísticos e sem o PRNG do jogo).
- Se o contêiner do piso é um `Container` com imagens ou um `RenderTexture` assado por sala.
- Organização interna de `src/visual/floor/` (por exemplo `composeFloor.ts`, `floorSeed.ts`, `tileset.ts`).

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Piso criado depois do `attach` aparece nas duas câmeras | Contêiner único criado antes do `attach` (§3, §4.4) |
| Tiles competem com telegrafia | Paleta fria e dessaturada, regras de arte (§4.1) e verificação manual a 2× |
| Arte nunca "termina" | Critério de pronto com no máximo 2 rodadas (§5) |
| Alguém liga a seed do piso ao PRNG do jogo e quebra o replay | Anti-objetivo e teste de determinismo; módulo sem import do PRNG do jogo |
| Tamanho da arena mudar | `composeFloor` já recebe colunas e linhas; a lógica continua dona de `ARENA_BOUNDS` |

## 8. Decisões que preciso de você

Nenhuma é bloqueante; todas têm padrão acima. As que você pode querer mudar:
1. **Tema do chão** (§4.1): pedra de masmorra, frio e dessaturado. Se preferir grama/terra/outro, o resto do desenho não muda.
2. **Seed derivada do log** (§4.3) em vez de campo novo no log. Se quiser a seed gravada explicitamente, é um campo aditivo em `room.enter`, sem efeito na lógica, mas muda o formato do log.
3. **Piso novo a cada sala** (§4.3). Se preferir um piso por run, basta trocar `roomIdx` por `0` em `floorSeed`.
