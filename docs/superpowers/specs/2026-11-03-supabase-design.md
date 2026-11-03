# Contas e dados na nuvem (Supabase) — design

Data: 2026-11-03. Parte de `master` (e490ce5). Completa o botão Login que o menu mostra como "em breve" (spec `2026-11-03-ui-estrutura-design.md`).

## 1. Intenção

O jogo precisa deixar de ser uma máquina de um jogador só. Três pedidos do autor:

1. **Guardar o perfil e a jogatina de cada jogador** em um lugar de fácil acesso para a pesquisa.
2. **O jogador volta e continua de onde parou**, em qualquer computador, entrando com sua conta.
3. **O projeto será publicado na Vercel**, aberto a quem receber o link.

Um quarto pedido define quem vê o quê: o autor (`devlucaznery@gmail.com`) é **administrador**. Ver logs, pular para o chefe, forçar ataques e as demais ferramentas de desenvolvimento são só dele; o jogador comum não as tem.

O sistema de perfil continua sendo o produto da tese. Este projeto só muda **onde** o log de eventos vive e **quem** pode acessá-lo. O perfil continua sendo reconstruído do log, como hoje.

## 2. Objetivos

- Cadastro e login por e-mail e senha, dentro do menu do jogo.
- Eventos do jogo sincronizados com o Supabase em segundo plano; o jogo nunca espera pela rede.
- Ao entrar em outro computador, o histórico do jogador é baixado e o perfil reconstruído, idêntico ao do computador anterior.
- Administrador: acesso de leitura a todos os dados, e as ferramentas de desenvolvimento.
- Jogador comum: acesso só aos próprios dados, sem as ferramentas.
- Consentimento registrado antes da primeira jogada; direito de apagar os próprios dados.
- Publicação estática na Vercel.

## 3. Não objetivos

- Servidor de jogo próprio, partidas multiplayer, ranking ou placar.
- Login social (Google etc.) e login sem senha: ficam para depois, se pedirem.
- Impedir que um jogador adultere o próprio cliente. Ele só escreve nas próprias linhas; o dado de um jogador adulterado é um risco aceito da pesquisa aberta, e o marcador `debug_jump` já existe para o caso do autor.
- Painel de pesquisa dentro do jogo. A consulta ao conjunto de dados é feita pelo painel do Supabase e por SQL.
- Mudar qualquer regra de jogo, de perfil ou de chefe. Os agentes sintéticos V0/V0.1 continuam sem rede e idênticos.

## 4. Visão geral

O armazenamento local atual (IndexedDB, interface `EventStore` em `src/telemetry/eventStore.ts`) continua sendo a fonte da verdade durante a partida. A interface foi escrita para aceitar uma implementação com servidor sem tocar no jogo, e os eventos já têm chave `(session_id, seq)`, de modo que gravar duas vezes é inofensivo.

```
jogo ──grava──> IndexedDB (local, rápido) ──envia em lotes──> Supabase (Postgres)
                     ^                                              │
                     └────────── baixa o que falta ao entrar ───────┘
```

- **Local primeiro:** nenhuma jogada espera a rede. Sem internet o jogo funciona e acumula; o envio acontece quando a conexão volta.
- **Servidor como cópia durável e compartilhada:** o que está no servidor é o histórico completo do jogador. Ao entrar numa máquina nova, o log é baixado para o IndexedDB e o fluxo de inicialização existente (`loadProfileState`) reconstrói o perfil.

## 5. Contas e menu

- **Supabase Auth**, e-mail e senha, com confirmação de e-mail e recuperação de senha.
- O identificador do jogador (`player_id`) deixa de ser um UUID gerado no navegador e passa a ser o **id do usuário do Supabase** (`auth.users.id`). Isso liga os eventos, o perfil e a conta.
- **Menu:** o botão Login passa a funcionar. Sem sessão ativa: Login (entrar/criar conta). Com sessão: o menu mostra o e-mail e as opções Jogar, Como jogar, Análise e Sair.
- **Na versão publicada, Jogar exige login.** Sem login não se joga, porque o histórico precisa de dono e o consentimento precisa estar registrado.
- **Em desenvolvimento sem credenciais configuradas** (sem as variáveis de ambiente abaixo), o jogo continua exatamente como hoje, só local, para os testes e para o autor trabalhar sem rede.

## 6. Consentimento

Antes da primeira jogada de uma conta, uma tela de termo de consentimento. O aceite é gravado (usuário, versão do termo, data). Sem aceite, o botão Jogar fica bloqueado. Se o texto do termo mudar, a versão muda e o aceite é pedido de novo. O **texto do termo é do autor/da pesquisa** (comitê de ética); o plano deixa um texto provisório marcado como tal.

## 7. Dados

Uma linha por **lote de eventos**, não por evento. O jogo grava eventos a cada passo da simulação e uma sessão gera dezenas de milhares deles; uma linha por evento esgotaria o plano gratuito rapidamente. Esta é uma escolha minha, a confirmar medindo o volume real (primeira tarefa do plano).

Tabelas (esquema `public`, todas com RLS ligada):

| Tabela | Conteúdo | Observação |
| --- | --- | --- |
| `event_batches` | `user_id`, `session_id`, `first_seq`, `last_seq`, `events` (jsonb, lista de eventos como o log atual), `created_at` | chave única `(user_id, session_id, first_seq)`; reenviar um lote não duplica |
| `consents` | `user_id`, `terms_version`, `accepted_at` | um registro por versão aceita |
| `admins` | `user_id` | quem está nesta tabela é administrador; preenchida só por SQL, nunca pelo jogo |

Uma **visão** `events_flat` (só para administradores) desdobra os lotes em uma linha por evento, para consulta e exportação da pesquisa sem mexer no jogo.

Os eventos mantêm o formato atual, incluindo `game_version`; o filtro por versão continua valendo. Nenhum campo de jogo muda.

## 8. Quem acessa o quê (RLS)

- **Jogador comum:** lê e escreve apenas linhas com `user_id = auth.uid()`; só insere lotes (não edita nem apaga os de outros).
- **Administrador** (`exists` em `admins`): lê tudo; para a visão e as consultas da pesquisa.
- **Tabela `admins`:** ninguém a escreve pelo cliente. O autor entra nela por SQL, depois de criar a própria conta, usando o e-mail dele. O e-mail não aparece no código do cliente.
- A chave pública (`anon`) do Supabase vai no cliente por desenho; a segurança está nas regras de linha, não em esconder a chave. A chave de serviço (`service_role`) **nunca** vai para o cliente nem para o repositório.

## 9. Ferramentas de desenvolvimento: só para o administrador

O jogo descobre se o usuário é administrador consultando `admins` depois do login. Só então liberam-se:

- F2 (zerar perfil), F3 (hitboxes), F4 (pular para o chefe), F6 (forçar barragem), F8/F9 (exportar/importar histórico), a tecla Tab (painel ao vivo) e o parâmetro `?boss=demo`.

Fica para todos: o menu, Jogar, Como jogar, a tecla H (ajuda) e a entrada **Análise do menu**, que mostra só o perfil do próprio jogador (decisão minha; o autor pode tornar a Análise exclusiva do administrador).

Aviso honesto: isso é controle de interface. O código das ferramentas continua no pacote enviado ao navegador, e alguém determinado poderia ativá-las no próprio cliente. Isso não dá acesso a dados de outros (as regras de linha impedem) nem a nada além do próprio jogo. O que a proteção real garante é o acesso aos dados.

## 10. Sincronização

- **Envio:** o que já é gravado no IndexedDB a cada intervalo (`PERSIST_INTERVAL_MS`), ao fim de cada run e ao esconder a página também é enviado ao servidor, em lotes. O jogo guarda, por sessão, até qual `seq` já foi enviado (no `meta` do IndexedDB) e reenvia a partir dali em caso de falha, com espera crescente.
- **Falha de rede:** nunca interrompe a partida e nunca descarta eventos locais. O estado "pendente de envio" aparece de forma discreta no menu/HUD.
- **Ao entrar:** o log do jogador é baixado e mesclado no IndexedDB (idempotente, pela chave `(session_id, seq)`); só depois o perfil é reconstruído e o jogo inicia.
- **Fechar a aba no meio da run:** continua valendo a regra atual (a run aberta é fechada como `abandoned` no próximo início, e a luta de chefe interrompida é inválida).
- **Dois computadores ao mesmo tempo:** cada sessão tem o próprio `session_id`; os logs se somam sem conflito.

## 11. Histórico local já existente

Quem já jogou no navegador (inclusive o autor) tem eventos com um `player_id` local. No primeiro login nesse navegador, o jogo **oferece importar** o histórico local para a conta nova (reescrevendo o `player_id` para o id da conta) ou **descartá-lo**. É escolha do jogador e nunca acontece em silêncio. Como a versão 0.0.7 já separa o perfil do histórico antigo, o impacto é pequeno. O plano precisa dizer o que acontece com os eventos que não são da versão corrente (são importados, mas continuam fora do perfil, como hoje).

## 12. Direitos do jogador

- **Apagar meus dados:** uma ação na conta que remove todos os lotes e consentimentos do usuário (função no servidor, chamada pelo próprio usuário). O jogo apaga também o IndexedDB local.
- **Sair:** encerra a sessão e limpa os dados locais da conta no navegador (ou os mantém marcados como pertencentes àquela conta; o construtor escolhe a opção que evita misturar contas no mesmo navegador).
- O administrador vê os dados pelo `user_id` (UUID), não pelo e-mail. O e-mail fica só no Supabase Auth.

## 13. Vercel

- Site estático (o `vite build` atual); sem servidor próprio.
- Variáveis de ambiente do projeto Vercel: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Sem elas o build funciona em modo local (item 5).
- No painel do Supabase: URL do site da Vercel nas URLs permitidas de redirecionamento (confirmação de e-mail e recuperação de senha).
- **Quem faz o quê:** a conta do Supabase, o projeto, as chaves, o projeto Vercel e o primeiro cadastro do administrador são ações do autor, no painel de cada serviço. O plano entrega o esquema SQL (migração), as regras de linha e o passo a passo, e o autor aplica.

## 14. Testes e verificação

- A rede fica atrás de uma interface; os testes usam um servidor falso em memória. Nenhum teste fala com o Supabase real.
- Testes cobrem: envio em lotes e reenvio após falha, mesclagem idempotente ao entrar, reconstrução do perfil a partir do log baixado igual à local, bloqueio das ferramentas para quem não é administrador, bloqueio de Jogar sem consentimento, e que o modo local (sem credenciais) continua idêntico ao de hoje.
- As regras de linha são conferidas com um roteiro SQL que o autor roda no projeto de teste do Supabase (usuário comum não lê dados alheios; administrador lê tudo).
- Verificação no navegador: cadastro, login, jogar, abrir em outro navegador e ver o mesmo perfil.

## 15. Restrições

- Nada muda nas regras de jogo, no perfil, no chefe, nos agentes sintéticos ou nos resultados pré-registrados do V0/V0.1.
- O formato dos eventos e a chave `(session_id, seq)` não mudam.
- Commits só com mensagem aprovada pelo autor, sem trailer de coautoria, sem push, sem merge sem ordem.
- Nenhuma credencial, chave ou e-mail em arquivos versionados; o arquivo local de variáveis (`.env.local`) fica no `.gitignore`.

## 16. Fica para o construtor

Biblioteca de cliente (`@supabase/supabase-js`) e como encapsular; telas de cadastro/login/termo (texto e retângulos, no estilo do menu atual); formato exato dos lotes e do controle de "enviado até"; política de reenvio; nomes e SQL das tabelas, regras e da função de apagar; estrutura dos testes.

## 17. Decisões em aberto para o autor

1. **Visitantes sem conta:** sugiro não permitir na versão publicada (histórico precisa de dono e de consentimento). Confirmar.
2. **Métodos de login:** e-mail e senha agora; Google depois, se fizer sentido para os participantes.
3. **Texto do termo de consentimento** e se a pesquisa exige pseudonimização adicional além do uso do UUID.
4. **Análise do menu** para todos (próprio perfil) ou só para o administrador.
5. **Importar o histórico local** no primeiro login: oferecer ao jogador (sugerido) ou nunca importar.
6. **Volume e plano do Supabase:** medir o volume real de eventos por sessão antes de fixar o formato de lote; se o plano gratuito não bastar para o número de participantes esperado, decidir entre reduzir o que se grava ou subir de plano.
