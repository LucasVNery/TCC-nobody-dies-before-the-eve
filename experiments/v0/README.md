# V0: validação do perfil com agentes sintéticos

A V0 pergunta: **o perfil descritivo distingue estilos de jogo conhecidos?** (validade discriminante, sem participantes humanos nem chefe). Sete agentes scriptados (agressivo, evasivo, bloqueador, paciente, variado, repetitivo, aleatório) jogam o jogo real, run a run, pelo mesmo caminho de telemetria; o log de cada um é reconstruído em perfil, e um conjunto de hipóteses **pré-registradas** (H1 a H11, H1u, H2u) é avaliado. O mesmo relatório traz o ICC por dimensão (limite superior da estabilidade) e verificações de integridade do pipeline. Desenho completo: `docs/superpowers/specs/2026-10-19-v0-agentes-sinteticos-design.md`; contexto: `Contexto_pesquisa/documento-tecnico-mestre.md` §8.4.

Código: `src/experiments/v0/` (puro: sem relógio nem arquivos) e `tools/run-v0.ts` (a linha de comando, único ponto com `node:fs`, `process.argv` e relógio).

## Comandos

```
npm run v0 -- [opções]
# ou
npx vite-node tools/run-v0.ts [opções]
```

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `--agents a,b,…` | os 7 | subconjunto de agentes |
| `--runs N` | 30 | runs por agente |
| `--runs-per-session N` | 10 | runs por sessão (o perfil persiste entre sessões) |
| `--cap-ms N` | 300000 | teto de tempo simulado por run |
| `--seed N` | 20261019 | semente do experimento; todas as outras derivam dela |
| `--out DIR` | `experiments/v0/out/<aaaa-mm-dd-HHMM>-seed<seed>[-smoke]/` (data e hora LOCAIS) | pasta de saída; recusada se já tiver conteúdo, a menos que haja `--force` |
| `--reviewed-before yes\|no` | não informado | o autor revisou as hipóteses antes da execução completa? Aparece na seção 1 do relatório |
| `--smoke` | desligado | 2 agentes (agressivo, repetitivo) × 3 runs, teto 60000 ms, seed 4242 |
| `--full` | desligado | confirma que é a execução completa; obrigatório com a seed pré-registrada |
| `--force` | desligado | permite gravar em pasta de saída não vazia |

Com `npm run`, os argumentos precisam do separador `--`: `npm run v0 -- --smoke`. Regras de proteção (exit 2, nada é executado):

- argumentos desconhecidos, valores faltando, flags repetidas e a forma `--flag=valor` são recusados (escreva `--flag valor`);
- `--agents` não pode ser vazio, ter itens vazios nem ids repetidos;
- **sem `--full` uma execução com a seed pré-registrada (20261019, o padrão) é recusada**: a execução completa exige `--full` E `--reviewed-before yes|no`. `--smoke` e outras seeds não exigem nenhum dos dois; `--smoke` com a seed pré-registrada e `--full` com outra seed são recusados.

A **execução completa** é `npm run v0 -- --full --reviewed-before yes` (ou `no`). Use a seed 20261019 **só** nela: pilotos, fumaça e estimativas usam outras seeds (a calibração usou a 1, a fumaça a 4242), para que o experimento não seja os dados da calibração.

O comando termina com código diferente de zero se qualquer verificação do pipeline falhar, nomeando agente e verificação.

## Saídas (sete arquivos na pasta de saída; `experiments/v0/out/` é ignorada pelo git)

| Arquivo | Conteúdo |
| --- | --- |
| `relatorio.md` | O relatório, em seis seções: 1 configuração, 2 perfil final por agente, 3 separação de estilos (hipóteses e matriz estilo × dimensão), 4 estabilidade (ICC), 5 verificações do pipeline, 6 limitações |
| `runs.csv` | Um valor por run, agente e dimensão |
| `rooms.csv` | Um valor por sala, agente e dimensão (base do ICC) |
| `hipoteses.csv` | Um veredito por hipótese, com delta, IC e tamanhos de amostra |
| `icc.csv` | ICC(1,1) por dimensão, com IC |
| `perfil_final.csv` | Perfil final de cada agente |
| `events_by_type.csv` | Contagem de eventos por agente e por tipo (também em tabela na seção 5 do relatório, com o total) |

CSV: ponto decimal e vazio para indefinido. Markdown: vírgula decimal (o tempo decorrido sai em ms) e "—" para indefinido.

## Como ler o relatório

- **Veredito** de cada hipótese: *confirmada* (IC 95% de bootstrap do delta de Cliff acima de 0 e delta ≥ 0,33, ou a taxa de indefinição pedida), *refutada*, ou *indefinida* (menos de 10 valores definidos por grupo, ou menos de 10 runs nas hipóteses de taxa). Refutada ou indefinida é resultado, não defeito.
- **Indef.** é a fração de runs do grupo em que a dimensão ficou indefinida; **N definidos** conta só os valores definidos.
- Linhas "a priori (sem dados)" na seção 2 não são desempenho: são o prior.
- **ICC** é um limite superior (políticas estacionárias) e o IC é condicional aos agentes (reamostra runs, não agentes). O sinalizador "< 0,50" é mostrado, não aplicado.
- Runs vazias (abertas pelo diretor depois de uma morte que encerra a sessão, sem evidência) são descartadas de todas as tabelas e contadas só na seção 2.
- As 13 hipóteses não têm correção para comparações múltiplas (V0 exploratório).
- Seção 5: todas as verificações devem estar `ok`; se alguma falhar, os números das outras seções não valem.

## Pré-registro e como alterá-lo

As hipóteses estão em `src/experiments/v0/hypotheses.ts` (`HYPOTHESES`) e fixadas por um teste (`evaluate.test.ts`, "HYPOTHESES are pre-registered"). Alterar uma hipótese depois de ver resultados é decisão do autor e precisa de rastro:

1. editar `HYPOTHESES`;
2. editar o teste fixado para o novo conteúdo;
3. registrar a mudança no relatório, passando `hypothesisChanges` (lista de textos) ao `buildReport`; a seção 1 passa a listar as alterações depois da primeira execução completa. (A linha de comando ainda não tem opção para isso: acrescente a lista em `tools/run-v0.ts` na chamada de `buildReport`.)

Os estilos e a calibração (`styles.ts`, `policy.ts`) são decisões separadas do pré-registro; a calibração foi feita só sobre comportamento cru, com outras seeds.

## Limites

Política estacionária (os agentes não aprendem); validade discriminante entre agentes sintéticos não é validade em humanos; dimensão 7 fora do experimento; atraso de reação humanizado, mas sem adaptação; 13 hipóteses sem correção para múltiplas comparações; ICC é limite superior; em defensive_repertoire (H5, H6) só entram runs com pelo menos 2 rótulos de defesa, o que gera viés de seleção. A lista completa vai na seção 6 de cada relatório.

## Custo

A simulação é rápida. Medido em 2026-10-19 (seed 4242, nunca a do experimento): `--agents agressivo --runs 5` levou 22 ms; `--agents agressivo --runs 30`, 66 ms; `--agents evasivo,variado,paciente --runs 10` (30 runs), 410 ms; a fumaça (6 runs), cerca de 46 ms. O tempo inclui simulação, bootstrap e verificações, não a escrita dos arquivos. Extrapolação para 7 × 30 = 210 runs: pelo agressivo, 66 ms/30 runs × 210 = ~0,5 s; pelos três agentes mais lentos medidos, 410 ms/30 × 210 = ~2,9 s. Ordem de grandeza: **de 1 a 10 segundos**, mais ~1 s de inicialização. Com os 60 runs por agente (o padrão), o dobro: de 2 a 20 segundos.

## Decisões em aberto do autor (antes da primeira execução completa)

1. **Revisão dos 13 itens (H1–H11, H1u, H2u): decidida pelo autor em 2026-10-20**, depois do piloto e antes da execução completa. Duas mudanças: H1 recebeu a cláusula "ou indefinido" (`orLowerUndefined`) e H12 foi retirada (só confirmaria pela indefinição do repetitivo; redundante com H2u). Resta passar `--reviewed-before yes|no` na execução completa; o relatório registra a resposta.
2. ~~Considerar `runsPerAgent` 60~~ **Decidido pelo autor em 2026-10-20: o padrão agora é 60 runs por agente** (spec §4.3 atualizada). O piloto mostrou poucos dados por run em defesa e punição, e com menos de 10 valores definidos por grupo a hipótese sai *indefinida*.
3. ~~Observação da revisão independente (H1 e H5)~~ **Resolvida em 2026-10-20:** H1 agora tem a cláusula "ou indefinido", porque o agressivo quase sempre usa uma só arma por run. Correção de uma afirmação anterior sobre H5: ela só é confirmada pela indefinição se o agressivo ficar indefinido em pelo menos 95% das runs, e o piloto mostra 30 a 60%; o risco real é um viés de seleção (só entram runs com pelo menos 2 rótulos de defesa).
4. **Gráfico**: incluir ou não um mapa de calor estilo × dimensão (spec §8, item 3); hoje só há tabelas.
5. **Confirmar a D-0 com o orientador** (o sistema de perfil é o produto; o chefe é validação), além da definição de "eficaz" do chefe (V3).
