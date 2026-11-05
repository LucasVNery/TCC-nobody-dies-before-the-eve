# Autenticação com Clerk (Supabase só como banco) — design

Data: 2026-11-05. Parte da branch `supabase`. Substitui, no
[design de contas e dados na nuvem](2026-11-03-supabase-design.md), tudo o que diz respeito a **quem autentica**
(§4 contas, parte do §5 consentimento, §7 RLS por `auth.uid()`, §8 administrador). O restante (local-first, lotes,
sincronização, importação do histórico, direitos do usuário, ferramentas só do administrador) continua valendo.

## 1. Intenção

O autor decidiu usar o **Clerk** para entrar, criar conta e (quando disponível) entrar com Google. O Supabase passa a
ser **só o banco de dados**: ele reconhece o usuário pelo token do Clerk (integração "third-party auth" do Supabase).
Decisões do autor nesta conversa: o Clerk cuida de toda a autenticação; o código de "Entrar com Google" pelo Supabase
(não commitado) foi descartado; a migração `0001_init.sql` **ainda não foi rodada** em nenhum projeto, então o esquema
pode ser mudado direto.

## 2. Objetivos

1. Entrar / criar conta / sair pelo Clerk, a partir do menu do jogo. Sem senha nem e-mail tratados pelo nosso código.
2. As regras de acesso (RLS) passam a usar o id do Clerk (`auth.jwt()->>'sub'`, texto). Jogador só lê e escreve as
   próprias linhas; administrador continua definido só por SQL.
3. Tudo o que já existe e não depende de quem autentica continua igual: banco local por conta (`tcc-telemetry-<id>`),
   `SyncingEventStore`, lotes, leitura paginada, termo de consentimento, apagar meus dados, importação do histórico,
   ferramentas de desenvolvimento só para administrador, modo local sem variáveis de ambiente, `?cloud=fake` em DEV.

## 3. Não objetivos

- Sincronizar usuários do Clerk para o Supabase por webhook (o banco só guarda o id em texto).
- Recuperação de senha, troca de senha e confirmação de e-mail em telas próprias: ficam por conta do Clerk.
- Trocar o banco, o modelo de eventos ou a telemetria.

## 4. Arquitetura

- **Cliente:** `@clerk/clerk-js` (o jogo não usa React). O menu chama a janela de entrada do Clerk (`openSignIn`, e
  `openSignUp` se necessário). Chave pública do Clerk em `VITE_CLERK_PUBLISHABLE_KEY`. Enquanto a janela do Clerk
  estiver aberta, as teclas não podem chegar ao Phaser nem aos atalhos do jogo.
- **Token para o Supabase:** o cliente `supabase-js` é criado com a opção `accessToken` devolvendo
  `clerk.session.getToken()` (token nativo da integração; o modelo de JWT antigo está descontinuado).
- **`CloudApi`:** `signUp`, `signIn`, `resetPassword` e `updatePassword` saem. Entram `openSignIn()` (abre a janela do
  Clerk) e eventos de sessão do Clerk em `onAuthChange`. `getUser` devolve o id do Clerk e o e-mail principal.
  `signOut`, `isAdmin`, `acceptedTermsVersion`, `acceptTerms`, `pushBatches`, `pullPage`, `deleteMyData` continuam.
- **Interface do menu:** os painéis de e-mail/senha, "esqueci a senha" e "nova senha" saem; "Entrar / Criar conta" abre
  a janela do Clerk. O termo, a importação do histórico e a confirmação de apagar dados continuam sendo painéis nossos.
- **Nuvem simulada (`?cloud=fake`, só DEV):** continua simulando a entrada, sem o Clerk, para testar o menu.

## 5. Banco de dados (mudanças em `0001_init.sql`)

- `user_id` vira `text` em `event_batches`, `consents` e `admins`; as chaves estrangeiras para `auth.users` saem
  (não há cascata ao apagar um usuário: apagar o usuário no Clerk **não** apaga as linhas; `delete_my_data` apaga).
- Dono da linha: `default (auth.jwt()->>'sub')`; as políticas comparam `(select auth.jwt()->>'sub') = user_id`.
- `is_admin()` e `delete_my_data(expected text)` leem `auth.jwt()->>'sub'`; continuam `security definer` com
  `search_path = ''`; `delete_my_data` ainda exige `expected = sub` (erro 42501 caso contrário).
- A visão `events_flat` e o limite de tamanho/quantidade do lote não mudam. As concessões de coluna e a
  monotonicidade do lote não mudam.
- O token precisa ter o papel `authenticated` (a integração do Clerk com o Supabase adiciona a claim `role`); o guia
  explica a ativação. `rls_check.sql` passa a simular usuários com `set_config('request.jwt.claims', ...)` (sem
  inserir em `auth.users`).
- O administrador é inserido em `admins` com o id do Clerk (visível no painel do Clerk), nunca com e-mail.

## 6. Pontos que dependem do autor (fora do código)

1. Criar a aplicação no Clerk; ativar a integração com o Supabase no painel do Clerk e adicionar o Clerk como provedor
   em Authentication → Sign In / Providers do Supabase (cola-se o domínio do Clerk).
2. Escolher os métodos de entrada no Clerk (e-mail com código/senha; Google é opcional e **em produção exige
   credenciais Google próprias** — o autor mencionou a exigência de CNPJ; sem Google, o e-mail funciona).
3. **Instância do Clerk:** a instância de desenvolvimento funciona em qualquer domínio (inclusive `*.vercel.app`) mas
   mostra aviso de desenvolvimento; pelo que se sabe, a instância de produção exige um domínio próprio. Confira antes de
   publicar. Isso é decisão do autor.
4. Colocar `VITE_CLERK_PUBLISHABLE_KEY` (e as variáveis do Supabase) no `.env.local` e na Vercel. A chave **secreta**
   do Clerk nunca entra no jogo.
5. Texto do termo de consentimento (continua provisório).

## 7. Restrições

- Mesmas do design anterior: sem segredos nem e-mails no repositório, `service_role` nunca no cliente, commits só com
  mensagem aprovada e sem trailer, nada de push/merge sem ordem, V0/V0.1 intactos, semente 4242 nos testes.
- A instalação de `@clerk/clerk-js` usa versão exata publicada há mais de duas semanas.

## 8. Fica para o construtor

Forma exata da integração com a janela do Clerk (modal vs. componente montado), captura de teclado enquanto ela está
aberta, como o `Account` reage ao ciclo de sessão do Clerk, e a migração dos testes (`FakeCloudApi`, painéis,
`account`) para a interface menor.
