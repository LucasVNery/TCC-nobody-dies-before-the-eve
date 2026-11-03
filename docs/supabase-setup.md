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

A migração roda uma vez só. Rodar de novo dá erro de "já existe"; isso é esperado e não estraga nada (ela está dentro de uma transação).

## 3. Autenticação

No painel, em **Authentication** (procure por "Sign In / Providers" ou "Providers" e por "URL Configuration"):

1. Provedor **Email**: ligado.
2. **Confirm email** (confirmação de e-mail): ligado.
3. **Site URL**: a URL da Vercel quando existir (`https://<SEU_PROJETO>.vercel.app`); até lá, `http://localhost:5173`.
4. **Redirect URLs** (URLs permitidas de redirecionamento, usadas pela confirmação de e-mail e pela recuperação de senha). Cadastre as duas:
   - `http://localhost:5173/**`
   - `https://<SEU_PROJETO>.vercel.app/**`

Observação: o envio de e-mails do plano gratuito usa o servidor de e-mail embutido do Supabase, que tem limite baixo de mensagens por hora e serve para testes. Para muitos participantes, procure por "SMTP Settings" em Authentication e configure um SMTP próprio (conferir o limite atual na documentação).

## 4. Chaves no ambiente local

1. No painel, procure por **Project Settings > API** (ou "API Keys" / "Data API"). Copie:
   - **Project URL** (`https://<algo>.supabase.co`);
   - a chave **anon** / **public** (às vezes chamada de "publishable key").
2. Na raiz do repositório, copie `.env.example` para `.env.local` e preencha:

   ```
   VITE_SUPABASE_URL=https://<algo>.supabase.co
   VITE_SUPABASE_ANON_KEY=<chave anon>
   ```

3. `.env.local` está no `.gitignore` e nunca vai para o repositório.

A chave `anon` é pública por desenho: ela vai dentro do jogo enviado ao navegador, e a segurança está nas regras de linha (RLS), não em esconder a chave.
A chave **`service_role`** (ou "secret key") ignora todas as regras: **nunca** a coloque em `.env.local`, na Vercel ou em qualquer arquivo do repositório.

Sem `.env.local` o jogo continua no modo local de hoje (sem login, só IndexedDB).

## 5. Tornar-se administrador

1. Rode o jogo (`npm run dev`, em `http://localhost:5173`) e crie a sua conta pelo menu Login, com o seu e-mail. Confirme o e-mail pelo link recebido.
2. No painel, em **Authentication > Users**, confira que a sua conta aparece e anote o **UID** (um UUID).
3. No **SQL Editor**, rode **uma** das duas formas (troque o parâmetro; o e-mail não é gravado em nenhum arquivo):

   ```sql
   -- pelo e-mail
   insert into public.admins (user_id)
   select id from auth.users where email = '<SEU_EMAIL>';

   -- ou pelo UID copiado da lista de usuários
   insert into public.admins (user_id) values ('<SEU_UID>');
   ```

4. Confira: `select * from public.admins;` deve mostrar uma linha com o seu UID.
5. Saia e entre de novo no jogo para que ele perceba que você é administrador (ferramentas F2, F3, F4, F6, F8/F9, Tab e `?boss=demo`).

Para tirar alguém da lista: `delete from public.admins where user_id = '<UID>';`.
A tabela `admins` só se altera assim, por SQL no painel; o jogo não tem como escrever nela.

## 6. Verificar as regras de acesso (só no projeto de TESTE)

1. No projeto de **teste**, rode antes a migração (passo 2).
2. No **SQL Editor**, cole o conteúdo inteiro de `supabase/tests/rls_check.sql` e execute.
3. **O editor vai mostrar um ERRO.** Isso é proposital: o roteiro termina levantando um erro cuja mensagem é o relatório, e o erro faz o banco desfazer tudo o que o roteiro criou (dois usuários descartáveis, lotes, consentimentos e a linha em `admins`).
4. Leia a mensagem: uma linha por verificação com `OK` ou `FALHOU`, e no fim `RESULTADO: TODOS OK` ou `RESULTADO: HA FALHAS`.
5. Se a mensagem for outra (por exemplo, permissão negada em `auth.users`), o roteiro não conseguiu nem começar; veja o comentário no topo do arquivo, que explica como usar dois usuários criados à mão no projeto de teste.

O que o roteiro confere: A não lê nem altera nem apaga dados de B; A não insere lote em nome de B; A insere e reenvia (upsert) o próprio lote; A não lê `events_flat`; A não se coloca em `admins` nem vê os registros de outros; o administrador B lê todos os lotes, consentimentos e `events_flat` (sem duplicatas de lotes reenviados); `delete_my_data()` apaga só os dados de quem chama e é recusada sem usuário; `anon` (sem login) não lê nem escreve nada.

## 7. Vercel

1. Em <https://vercel.com>, importe o repositório do GitHub (Add New > Project, ou procure por "Import Project").
2. Framework: **Vite**. Build command: `npm run build`. Output directory: `dist`. (A Vercel costuma detectar sozinha; confira.)
3. Em **Settings > Environment Variables** do projeto, crie:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = chave anon
   
   As variáveis `VITE_*` entram no pacote no momento do build: depois de criar ou mudar uma, faça um novo deploy (Redeploy).
4. Depois do primeiro deploy, copie a URL do site (`https://<SEU_PROJETO>.vercel.app`) e volte ao passo 3 (Site URL e Redirect URLs) no Supabase.
5. Teste no site: criar conta, confirmar e-mail, aceitar o termo, jogar, abrir em outro navegador e ver o mesmo perfil.

## 8. Exportar os dados da pesquisa

Os dados ficam em `event_batches`, um lote de até 500 eventos por linha. A visão `events_flat` desdobra os lotes em uma linha por evento (sem as duplicatas dos lotes reenviados) e, pelo jogo/API, só devolve linhas para administradores. No SQL Editor, que roda como dono do banco (`postgres`), ela também devolve tudo; é por ali que se exporta.

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

Os participantes aparecem pelo `user_id` (UUID), não pelo e-mail; o e-mail fica só no Supabase Auth.

## 9. Direitos do participante

- **Apagar meus dados:** o jogo chama `public.delete_my_data()`, que apaga todos os lotes e consentimentos de quem está logado (e só dele).
- **Apagar a conta inteira:** em Authentication > Users, apague o usuário; os lotes e consentimentos dele são apagados junto (chave estrangeira com `on delete cascade`).

## 10. Plano gratuito: limites e cuidados

- **Capacidade:** pela medição em `docs/supabase-volume.md`, cerca de 18 MB por hora de jogo de um participante. Com o banco de 500 MB do plano gratuito e 50% de folga, cabem cerca de **14 horas-participante** (cerca de 28 sem folga). Acompanhe o uso do banco no painel (procure por "Usage" ou "Database size"). Se for faltar espaço: exportar e apagar dados antigos, registrar menos eventos (`pos.sample`, `obs.record`) ou mudar de plano. A decisão é do autor.
- **Pausa por inatividade:** projetos do plano gratuito com pouca atividade durante 7 dias são pausados (documentação "Project Pausing" do Supabase, consultada em 2026-11-03; conferir antes da coleta, porque a política muda). Pausado, o jogo publicado não consegue login nem envio (os eventos continuam salvos localmente no navegador e são enviados depois).
  - **Como reativar:** no painel, abra a organização, selecione o projeto pausado e clique em **Resume** (ou "Restore"). Os dados e a configuração voltam como estavam. Segundo a documentação atual, há uma janela de restauração (1 ano na página atual; uma nota antiga falava em 90 dias, conferir).
  - Durante a coleta, abrir o jogo ou o painel com alguma frequência evita a pausa; os planos pagos não são pausados.
- **Backups:** os backups do plano gratuito são limitados (conferir na página de preços o que está incluído); não conte com eles e exporte os dados da pesquisa periodicamente (passo 8).

## Referências

- Supabase, Project Pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase, Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase, preços e limites: <https://supabase.com/pricing>
