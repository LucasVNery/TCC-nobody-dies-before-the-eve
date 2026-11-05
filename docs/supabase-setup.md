# Supabase e Vercel: roteiro de configuração

Passo a passo para o autor colocar no ar as contas e o armazenamento dos eventos na nuvem.
Especificação: `docs/superpowers/specs/2026-11-03-supabase-design.md` (seções 5 a 8, 12 e 13).
Arquivos: `supabase/migrations/0001_init.sql` (esquema e regras de acesso) e `supabase/tests/rls_check.sql` (verificação das regras).

Todas as ações abaixo são feitas pelo autor, no painel de cada serviço. Nenhuma chave vai para o repositório.
Os nomes de menus do painel mudam com o tempo; quando este texto diz "procure por ...", o nome exato pode ser outro.

## 0. Dois projetos: teste e produção

Recomendado: criar **dois** projetos no Supabase, um de **teste** (onde se roda `rls_check.sql` e se experimenta) e um de **produção** (o da pesquisa).
O plano gratuito permite dois projetos ativos por organização (conferir o limite atual na página de preços).
O roteiro de verificação desfaz tudo o que faz, mas mesmo assim ele não deve rodar no banco da pesquisa.

## 1. Criar o projeto

1. Em <https://supabase.com>, entre e crie um projeto novo (Organização > New project).
2. Escolha um nome, uma senha forte para o banco (guarde num gerenciador de senhas; o jogo não usa essa senha) e a região mais próxima (por exemplo, São Paulo, se disponível).
3. Aguarde o projeto terminar de ser criado.

## 2. Rodar a migração

1. No painel do projeto, abra o **SQL Editor**.
2. Cole o conteúdo inteiro de `supabase/migrations/0001_init.sql` e execute.
3. Deve terminar sem erro. Confira em **Table Editor** (ou procure por "Database > Tables") que existem `event_batches`, `consents` e `admins`, com RLS ligada (o painel mostra um aviso quando uma tabela está **sem** RLS; aqui as três têm).

O banco identifica cada jogador pelo **id do usuário no Clerk** (texto como `user_...`), que chega no token da sessão como `sub`. As três tabelas guardam esse id na coluna `user_id` (texto), sem ligação com a lista de usuários do próprio Supabase. As regras de linha (RLS) comparam `user_id` com o `sub` do token: um token sem `sub` não vê nem grava nada, e o papel `anon` (sem login) não tem acesso a nenhuma tabela, visão ou função do jogo. Por isso o token precisa chegar ao Supabase com o papel `authenticated`.

A migração roda uma vez só. Rodar de novo dá erro de "já existe"; isso é esperado e não estraga nada (ela está dentro de uma transação).

## 3. Autenticação

No painel, em **Authentication** (procure por "Sign In / Providers" ou "Providers" e por "URL Configuration"):

1. Provedor **Email**: ligado.
2. **Confirm email** (confirmação de e-mail): ligado.
3. **Site URL**: a URL da Vercel quando existir (`https://<SEU_PROJETO>.vercel.app`); até lá, `http://localhost:5173`.
4. **Redirect URLs** (URLs permitidas de redirecionamento, usadas pela confirmação de e-mail e pela recuperação de senha). Cadastre as duas:
   - `http://localhost:5173/**`
   - `https://<SEU_PROJETO>.vercel.app/**`

### 3.1 SMTP próprio: OBRIGATÓRIO antes de chamar participantes

O servidor de e-mail embutido do Supabase só entrega mensagens para endereços de membros da equipe do projeto (da organização no Supabase) e tem limite muito baixo (cerca de 2 e-mails por hora; conferir o valor atual na documentação). Ele serve **só** para a conta de teste do próprio autor. Com ele, um participante comum não recebe o e-mail de confirmação e não consegue criar a conta.

Antes de coletar dados de participantes:

1. Em **Authentication**, procure por **SMTP Settings** e ligue o SMTP próprio (custom SMTP), com os dados de um provedor de e-mail transacional (host, porta, usuário, senha do SMTP e o remetente). A senha do SMTP fica só no painel do Supabase, nunca no repositório.
2. Depois, em **Authentication**, procure por **Rate Limits** e ajuste o limite de e-mails por hora para o número esperado de cadastros.
3. Teste criando uma conta com um e-mail que **não** seja de membro da equipe e confira que a confirmação chega.

## 4. Chaves no ambiente local

1. No painel, procure por **Project Settings > API** (ou "API Keys" / "Data API"). Copie:
   - **Project URL** (`https://<algo>.supabase.co`);
   - a chave pública. Projetos novos podem mostrar chaves no formato novo: **`sb_publishable_...`** (pública) e **`sb_secret_...`** (secreta), além ou no lugar das antigas **anon** e **service_role**. Use a **publishable** (`sb_publishable_...`) ou, se só houver as antigas, a **anon**. Ela vai em `VITE_SUPABASE_ANON_KEY` (o nome da variável continua o mesmo).
2. Na raiz do repositório, copie `.env.example` para `.env.local` e preencha:

   ```
   VITE_SUPABASE_URL=https://<algo>.supabase.co
   VITE_SUPABASE_ANON_KEY=<chave publishable (sb_publishable_...) ou anon>
   ```

3. `.env.local` está no `.gitignore` e nunca vai para o repositório.

A chave publishable/`anon` é pública por desenho: ela vai dentro do jogo enviado ao navegador, e a segurança está nas regras de linha (RLS), não em esconder a chave.
A chave secreta (**`sb_secret_...`** ou a antiga **`service_role`**) ignora todas as regras: o jogo **nunca** a usa, e ela **nunca** vai para `.env.local`, para a Vercel ou para qualquer arquivo do repositório.

Sem `.env.local` o jogo continua no modo local de hoje (sem login, só IndexedDB).

## 5. Tornar-se administrador

1. Rode o jogo (`npm run dev`, em `http://localhost:5173`) e crie a sua conta pelo menu do jogo.
2. No painel do **Clerk**, na lista de usuários (procure por "Users"), abra a sua conta e copie o **id do usuário** (um texto que começa com `user_`).
3. No **SQL Editor** do Supabase, rode (troque o parâmetro pelo id copiado; o id não é gravado em nenhum arquivo do repositório):

   ```sql
   insert into public.admins (user_id) values ('<ID_DO_CLERK>');
   ```

   O administrador é sempre inserido pelo id do Clerk, nunca pelo e-mail: o banco não guarda e-mails.
4. Confira: `select * from public.admins;` deve mostrar uma linha com o seu id do Clerk.
5. Saia e entre de novo no jogo para que ele perceba que você é administrador (ferramentas F2, F3, F4, F6, F8/F9, Tab e `?boss=demo`).

Para tirar alguém da lista: `delete from public.admins where user_id = '<ID_DO_CLERK>';`.
A tabela `admins` só se altera assim, por SQL no painel; o jogo não tem como escrever nela.

## 6. Verificar as regras de acesso (só no projeto de TESTE)

1. No projeto de **teste**, rode antes a migração (passo 2).
2. No **SQL Editor**, cole o conteúdo inteiro de `supabase/tests/rls_check.sql` e execute.
3. **O editor vai mostrar um ERRO.** Isso é proposital: o roteiro termina levantando um erro cuja mensagem é o relatório, e o erro faz o banco desfazer tudo o que o roteiro criou (lotes, consentimentos e a linha em `admins` de dois usuários simulados).
4. Leia a mensagem: uma linha por verificação com `OK` ou `FALHOU`, e no fim `RESULTADO: TODOS OK` ou `RESULTADO: HA FALHAS`. Se a mensagem for outra, o roteiro não conseguiu nem começar (por exemplo, a migração não foi aplicada nesse projeto).
5. Não é preciso criar usuários: o roteiro simula dois jogadores (`user_test_a` e `user_test_b`, ids falsos) colocando o `sub` direto nas claims do token, como o PostgREST faz com o token do Clerk. O Clerk nem precisa estar configurado no projeto de teste.
6. Só considere a verificação concluída com `RESULTADO: TODOS OK`. Qualquer `FALHOU` bloqueia a coleta de dados até ser entendido.

Este roteiro **não foi executado** durante o desenvolvimento (não havia projeto Supabase disponível); rodá-lo num projeto real é uma verificação que só o autor pode fazer (seção 11).

O que o roteiro confere: A não lê nem altera nem apaga dados de B; A não insere lote em nome de B; A insere e reenvia (upsert) o próprio lote, e um reenvio menor (desatualizado) não encolhe o lote guardado; sem `user_id`, o lote e o consentimento ficam com o `sub` do token; lotes acima de 1000 eventos ou 1 MiB são recusados; A não lê `events_flat`; A não se coloca em `admins` nem vê os registros de outros; o administrador B lê todos os lotes, consentimentos e `events_flat` (sem duplicatas de lotes reenviados); um token sem `sub` (ou com `sub` vazio) não lê nem grava nada; `delete_my_data(expected)` apaga só os dados de quem chama, é recusada sem usuário e é recusada (sem apagar nada) quando `expected` não é quem está logado, de modo que o `sub` de A nunca apaga dados de B; `anon` (sem login), mesmo com o `sub` de outro usuário no token, não lê nem escreve nada.

## 7. Vercel

1. Em <https://vercel.com>, importe o repositório do GitHub (Add New > Project, ou procure por "Import Project").
2. Framework: **Vite**. Build command: `npm run build`. Output directory: `dist`. (A Vercel costuma detectar sozinha; confira.)
3. Em **Settings > Environment Variables** do projeto, crie as duas variáveis abaixo **nos ambientes Production E Preview**:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = chave publishable (`sb_publishable_...`) ou anon (**nunca** a secreta / `service_role`)

   As variáveis `VITE_*` entram no pacote no momento do build: depois de criar ou mudar uma, faça um novo deploy (Redeploy).
4. Depois do primeiro deploy, copie a URL do site (`https://<SEU_PROJETO>.vercel.app`) e volte ao passo 3 (Site URL e Redirect URLs) no Supabase.
5. Teste no site: criar conta, confirmar e-mail, aceitar o termo, jogar, abrir em outro navegador e ver o mesmo perfil.

### 7.1 Checklist de deploy

- [ ] `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` definidas em **Production** e em **Preview** (só a chave publishable/anon).
- [ ] **Site URL** e **Redirect URLs** do Supabase Auth apontando para a URL da Vercel (e para `http://localhost:5173/**` no desenvolvimento).
- [ ] **SMTP próprio** ligado (seção 3.1); sem ele participantes comuns não recebem o e-mail de confirmação.
- [ ] Migração aplicada e `rls_check.sql` com `TODOS OK` no projeto de teste.
- [ ] Primeiro administrador criado (seção 5).
- [ ] Texto do termo de consentimento definitivo no lugar do provisório (seção 12).
- [ ] Depois do deploy, abrir o site em janela anônima e conferir que aparece Login/Criar conta e que as teclas de desenvolvimento não funcionam.

> **ATENÇÃO:** um build da Vercel **sem** essas variáveis de ambiente roda em **modo local**: não há login nem coleta de dados, e as teclas de desenvolvimento (F2, F3, F8, F9, Tab) ficam **expostas a todos**. Se o site publicado não mostrar Login/Criar conta, as variáveis estão faltando (ou o deploy foi feito antes de criá-las: faça Redeploy).

## 8. Exportar os dados da pesquisa

Os dados ficam em `event_batches`, um lote de até 500 eventos por linha (na prática, durante o jogo, cerca de 30 a 60 eventos por linha: o envio em segundo plano manda o que se acumulou a cada ~2 s, o que dá cerca de 1000 a 1800 linhas por hora de jogo; veja `docs/supabase-volume.md`). A visão `events_flat` desdobra os lotes em uma linha por evento (sem as duplicatas dos lotes reenviados) e, pelo jogo/API, só devolve linhas para administradores. No SQL Editor, que roda como dono do banco (`postgres`), ela também devolve tudo; é por ali que se exporta.

Colunas de `events_flat`: `user_id`, `session_id`, `seq`, `type`, `run_idx`, `t_ms`, `event` (o evento inteiro em JSON, no mesmo formato do log NDJSON local, com `game_version` etc.), `batch_first_seq`, `batch_last_seq`.

Exemplos:

```sql
-- tudo, em ordem
select * from public.events_flat order by user_id, session_id, seq;

-- só uma versão do jogo (game_version vem no evento session.start de cada sessão)
select f.*
from public.events_flat f
where (f.user_id, f.session_id) in (
  select user_id, session_id from public.events_flat
  where type = 'session.start' and event ->> 'game_version' = '0.0.7'
)
order by f.user_id, f.session_id, f.seq;

-- quantos eventos e sessões por participante
select user_id, count(distinct session_id) as sessoes, count(*) as eventos
from public.events_flat group by user_id;

-- NDJSON: uma linha de texto por evento (copie o resultado ou exporte em CSV de uma coluna)
select event::text from public.events_flat order by user_id, session_id, seq;
```

Para baixar: no resultado do SQL Editor há uma opção de exportar/baixar (procure por "Export" / "Download CSV"); no **Table Editor** também há exportação em CSV por tabela. Resultados muito grandes podem ser cortados pelo editor: exporte por partes (por participante ou por sessão, com `where user_id = '...'`) ou use `psql` com a string de conexão do projeto (procure por "Connect" no painel) e `\copy (select ...) to 'arquivo.csv' csv header`.

Os participantes aparecem pelo `user_id` (o id do Clerk, texto como `user_...`), não pelo e-mail; o banco não guarda e-mails.

## 9. Direitos do participante

- **Apagar meus dados:** o jogo chama `public.delete_my_data(<id da conta>)`, que apaga todos os lotes e consentimentos de quem está logado (e só dele). O servidor recusa (erro 42501, nada é apagado) se o token da requisição não for dessa conta, por exemplo se outra conta entrou em outra aba nesse meio-tempo. Depois o jogo apaga o banco local da conta neste navegador.
  - **Não apaga:** a conta de login (o **e-mail continua guardado** no serviço de login), a linha em `admins` (se houver) e o histórico anterior ao login deste navegador (o banco `tcc-telemetry`, de antes de entrar na conta). O jogo diz isso na tela de confirmação.
- **Apagar a conta inteira (apagamento completo, inclusive o e-mail):** apagar a conta de login **não** apaga nada no banco (não há ligação entre as tabelas e a lista de usuários). Primeiro apague os dados (pelo jogo, "Apagar meus dados", ou por SQL no painel: `delete from public.event_batches where user_id = '<ID_DO_CLERK>';` e o mesmo em `public.consents` e, se for o caso, `public.admins`); depois apague o usuário no painel do serviço de login. Só o autor pode fazer a parte do painel.

## 10. Plano gratuito: limites e cuidados

- **Capacidade:** pela medição em `docs/supabase-volume.md`, cerca de 18 MB por hora de jogo de um participante. Com o banco de 500 MB do plano gratuito e 50% de folga, cabem cerca de **14 horas-participante** (cerca de 28 sem folga). Acompanhe o uso do banco no painel (procure por "Usage" ou "Database size"). Se for faltar espaço: exportar e apagar dados antigos, registrar menos eventos (`pos.sample`, `obs.record`) ou mudar de plano. A decisão é do autor.
- **Pausa por inatividade:** projetos do plano gratuito com pouca atividade durante 7 dias são pausados (documentação "Project Pausing" do Supabase, consultada em 2026-11-03; conferir antes da coleta, porque a política muda). Pausado, o jogo publicado não consegue login nem envio (os eventos continuam salvos localmente no navegador e são enviados depois).
  - **Como reativar:** no painel, abra a organização, selecione o projeto pausado e clique em **Resume** (ou "Restore"). Os dados e a configuração voltam como estavam. Segundo a documentação atual, há uma janela de restauração (1 ano na página atual; uma nota antiga falava em 90 dias, conferir).
  - Durante a coleta, abrir o jogo ou o painel com alguma frequência evita a pausa; os planos pagos não são pausados.
- **Backups:** os backups do plano gratuito são limitados (conferir na página de preços o que está incluído); não conte com eles e exporte os dados da pesquisa periodicamente (passo 8).

## 11. O que o jogo faz (resumo para o autor)

- **Local primeiro:** os eventos são gravados no IndexedDB do navegador, como antes. A nuvem é uma cópia; o jogo funciona sem rede.
- **Envio em segundo plano:** os lotes de eventos são enviados em segundo plano e reenviados se falharem (com espera crescente, quando a rede volta e quando a conta entra de novo), no máximo 20 lotes por requisição. O envio depende **só de haver a conta logada** (a mesma conta dona dos eventos), não do termo: o termo bloqueia o **registro** (sem aceite não se joga, então nada novo é gravado), não o envio do que já estava gravado. Cada linha enviada leva o `user_id` da conta explicitamente; se o token da sessão for de outra conta, o servidor recusa (RLS) e o envio é tentado de novo depois.
  - **Consequência ao aumentar `TERMS_VERSION`:** eventos gravados sob o termo antigo que ainda estavam pendentes (por exemplo, jogados offline) são enviados assim que o menu abrir **Análise** ou **Jogar** com a conta logada, mesmo antes de a pessoa aceitar o termo novo (Análise não pede o aceite; Jogar abre o termo, mas o banco da conta já foi aberto e o envio já começou). Eles foram coletados sob o termo antigo, que a pessoa aceitou na época.
- **Download do histórico (outro navegador/computador):** ao abrir o banco da conta, o jogo baixa o histórico da nuvem em páginas de 100 linhas, guardando cada página assim que chega. Espera no máximo 5 s; o que chegou até ali fica guardado e a próxima abertura (Análise, Jogar) continua de onde parou. O download completo acontece **uma vez por entrada na conta por carregamento da página**; as aberturas seguintes reaproveitam.
- **Banco local por conta:** cada conta tem seu próprio banco local no navegador; trocar de conta não mistura históricos. Sem conta logada no momento de começar a partida (modo nuvem), a partida fica **só na memória** (não é salva) e o jogo avisa na tela; o banco anterior ao login nunca é usado no modo nuvem.
- **Sem internet:** o aceite do termo fica guardado neste navegador (`localStorage`, chave `tcc-terms-<id>`, só a versão). Recarregar a página sem rede ainda permite jogar se a sessão continuar válida; os eventos ficam no navegador e são enviados depois.
- **Importação do histórico anterior ao login:** na primeira entrada, o jogo oferece importar o histórico local de antes do login, **uma vez por navegador**, com o aviso de importar só se foi a própria pessoa quem jogou ali antes de entrar.
- **Apagar meus dados:** apaga na nuvem os lotes e consentimentos da conta (`delete_my_data(<id>)`) e o banco local da conta neste navegador; outras abas do jogo na mesma conta têm o banco fechado e param de enviar. Não apaga o histórico anterior ao login nem o e-mail (seção 9).
- **Ferramentas de desenvolvimento só para administrador:** F2, F3, F4, F6, F8/F9, Tab e `?boss=demo` só funcionam para contas na tabela `admins`. Quem não é administrador não as vê.
- **`?cloud=fake` e `&admin=1` são só de desenvolvimento** (`npm run dev`): o primeiro troca a nuvem por uma simulação em memória, o segundo faz toda conta ser administradora. Nenhum dos dois existe no build publicado.
- **Recuperação de senha** só funciona com a **Site URL** (e as Redirect URLs) configuradas no Supabase; sem isso o link do e-mail leva a um endereço errado.

## 12. Verificações que só o autor pode fazer

Nada abaixo foi (nem poderia ser) verificado no desenvolvimento, que usou só simulação em memória:

- [ ] Rodar `supabase/tests/rls_check.sql` num projeto Supabase real de teste (seção 6) e obter `TODOS OK`.
- [ ] Cadastro real com e-mail de confirmação, com um endereço que não seja de membro da equipe (SMTP próprio).
- [ ] Link real de recuperação de senha chegando e funcionando.
- [ ] Deploy na Vercel com as variáveis de ambiente (seção 7.1).
- [ ] Playtest real da tecla Tab com uma conta **não** administradora (não deve fazer nada) e com a administradora.
- [ ] Enter mantido pressionado na tela de consentimento, num teclado real (não deve aceitar o termo sozinho por repetição de tecla).
- [ ] Layout em celular (login, termo, menu de conta).
- [ ] O banco legado do painel de navegador (o IndexedDB de antes das contas) continua intacto.
- [ ] **Antes de enviar o repositório ao GitHub (para a Vercel):** o e-mail do autor continua no histórico do git, no commit `46c7836` (a especificação). Decidir se reescreve o histórico ou aceita que ele fique público.
- [ ] Confirmar que "Apagar meus dados" apaga os lotes e consentimentos da conta e mantém a conta de login (esperado); para apagar tudo, seguir a seção 9.
- [ ] Confirmar no navegador que, depois do link de confirmação e do link de recuperação, o supabase-js remove os tokens da URL (a barra de endereço não deve ficar com `#access_token=...` ou `?code=...`).
- [ ] Medir, com uma conta com cerca de 1 hora de histórico (1000 a 1800 linhas), quanto tempo leva o download num navegador novo (limite de 5 s; deve continuar nas aberturas seguintes) e se há travadas no jogo durante o envio em segundo plano e durante a Análise.
- [ ] Recarregar a página sem internet com a sessão válida e conferir que Jogar funciona; com o token já vencido offline, conferir o que acontece (provavelmente pede para entrar de novo; ver seção 13).
- [ ] Medir o tempo do download na abertura do banco da conta: o limite de 5 s inclui também a leitura completa do banco local que o jogo faz antes de baixar (para saber o que já tem). Com muito histórico local, essa leitura sozinha pode gastar parte dos 5 s.
- [ ] Conferir no painel que o limite de linhas por resposta do PostgREST (`max_rows`, em Project Settings > API / Data API) **não é menor que 100**: se for, cada página volta com menos de 100 linhas e o jogo entende que o histórico acabou (o download termina cedo, sem erro).
- [ ] Acompanhar o tráfego de saída (Usage > Egress) durante a coleta (estimativa na seção 13).
- [ ] Rodar de novo `rls_check.sql` depois desta revisão (o esquema passou a usar o id do Clerk em texto; as verificações 43 a 54 são novas).

## 13. Limites conhecidos

- **Capacidade do plano gratuito:** cerca de 14 horas-participante no total (seção 10). Acima disso, é preciso exportar e apagar, reduzir eventos ou mudar de plano.
- **Duas abas na mesma conta** usam o mesmo banco local. Cada aba envia os eventos das próprias sessões (as sessões não se misturam); se uma aba fechar sem conseguir enviar, o que ficou pendente dela é enviado na próxima vez que o banco da conta for aberto numa página nova. Reenvios duplicados são inofensivos (upsert; `events_flat` não repete eventos). Ao **apagar os dados** numa aba, a outra aba tem a conexão com o banco fechada na hora (não bloqueia a exclusão), para de enviar e passa a pedir o aceite do termo de novo; o que ela gravar depois disso se perde (o banco foi apagado). Uma aba aberta com uma versão **antiga** do jogo (anterior a esta correção) não fecha a conexão: nesse caso "Apagar meus dados" apaga a nuvem e mostra "feche as outras abas do jogo e tente de novo" para terminar a parte local. Um envio que já estava a caminho na outra aba no instante da exclusão é coberto por uma segunda exclusão no servidor logo depois; um envio que chegue depois disso (rede muito lenta) não é coberto.
- **Reenvio menor nunca encolhe** um lote já guardado (a regra mantém o maior); se um lote foi enviado com mais eventos, ele permanece assim.
- **"Apagar meus dados" não apaga o banco legado** do navegador (o de antes das contas), só os dados da conta na nuvem e o banco local da conta. Também não apaga a conta de login nem o e-mail (seção 9).
- **Token vencido sem internet:** o aceite guardado no navegador permite jogar offline, mas a conta (sessão) continua obrigatória. Se o token da sessão venceu enquanto não havia rede, o jogo pode não conseguir restaurar a sessão e pedir para entrar de novo, o que exige internet. Não verificado com o Supabase real.
- **Linhas por hora:** como o envio vai a cada ~2 s, cada linha tem cerca de 30 a 60 eventos (1000 a 1800 linhas por hora de jogo). O espaço total quase não muda (seção 10), mas o download num navegador novo tem muitas linhas; ele é feito em páginas de 100 linhas e continua nas aberturas seguintes se não terminar em 5 s.
- **Download completo a cada carregamento da página:** em cada carregamento (e entrada na conta) o histórico inteiro é baixado de novo para conferir o que falta. Com muito histórico isso custa tempo e dados; as páginas que já estão no navegador são apenas conferidas, não regravadas.
  - **Estimativa de tráfego de saída (egress):** 2 h de histórico são cerca de 36 MB de JSON. Com cerca de 15 participantes recarregando a página cerca de 10 vezes cada no mês, são cerca de 15 x 10 x 36 MB, ou cerca de **5 GB por mês**, antes de compressão (a resposta costuma ir comprimida, então o real deve ser menor). O plano gratuito tem uma cota mensal de egress (conferir o valor atual na página de preços); acompanhe em **Usage > Egress**. Se ficar perto da cota, este é o primeiro ponto a otimizar (download só do que falta).
- **Aceite guardado offline pode estar desatualizado:** se os dados da conta foram apagados em **outro computador**, o aceite guardado neste navegador continua lá até a próxima consulta com rede. Jogando offline nesse intervalo, os eventos gravados são enviados quando a rede voltar, sem uma linha de consentimento no servidor (até a pessoa aceitar de novo). Caso estreito; documentado, não corrigido.
- **Um lote recusado para sempre bloqueia os seguintes:** se o servidor recusar um lote de forma permanente (erro classificado como "outro", por exemplo um lote acima de 1 MiB), o jogo tenta de novo com requisições menores e espera crescente, mas os lotes seguintes da mesma sessão não passam na frente dele; ficam no navegador. Só o console registra o aviso.
- **Depois de "feche as outras abas do jogo":** o pedido de apagar o banco local fica na fila do navegador até a aba antiga fechar; quando ela fechar, o banco é apagado sozinho. Repetir "Apagar meus dados" depois disso conclui a parte da nuvem de novo (é idempotente).
- **Espera pelo último envio ao apagar:** "Apagar meus dados" espera até 4 s pelos envios desta aba antes da primeira exclusão no servidor e de novo (até 4 s) antes da segunda; um envio mais lento que isso pode voltar a gravar dados depois da segunda exclusão.
- **Não implementado: indicador de envio pendente** (especificação, seção 10). O jogo não mostra quantos eventos ainda não foram enviados; só o console do navegador registra falhas de envio.
- **Ferramenta de administrador F9 (importar histórico) no modo nuvem:** a importação regrava `meta.player_id` com o id da conta, e os lotes importados de outro jogador (outro `player_id`) são marcados como enviados sem serem enviados (ficam só neste navegador). Não corrigido; use F9 só em testes.
- **Sem limite de tempo nas requisições:** as chamadas de rede não têm timeout próprio. Um último envio que trave (rede ruim) faz "Apagar meus dados" e "Sair" esperarem até 4 s por ele; depois disso seguem, mas a requisição travada não é cancelada e pode chegar mais tarde. Uma chamada de apagamento ou de saída que trave deixa a tela em "Apagando..."/"Saindo..." até a rede responder.
- **O texto do termo de consentimento é PROVISÓRIO** (`src/cloud/consentText.ts`). Antes de coletar dados de verdade, substitua-o pelo texto aprovado e **aumente `TERMS_VERSION`**, para que toda conta seja obrigada a aceitar de novo.

## Referências

- Supabase, Project Pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase, Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase, preços e limites: <https://supabase.com/pricing>
