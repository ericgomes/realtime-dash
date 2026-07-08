# Plano multi-tenant (fase 2)

> Estado atual: **single-tenant** (prospin.com.br). Este documento descreve o refactor
> para multi-cliente, a ser feito **depois** que o prospin estiver validado em produção.
> Nada do código single-tenant é descartado — o multi-tenant é uma camada por cima.

## Contexto da decisão

- Audiência dos dashboards: **Linka (vê todos) + cada cliente vê o seu**.
- Escala projetada: **6 a 20 clientes** em ~12 meses.
- Conclusão: **um único deploy multi-tenant**, com clientes cadastrados no banco
  (não em env var, para não exigir redeploy a cada novo cliente).

## Componentes

### 1. Tabela `clients`

```sql
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  site text not null unique,
  name text,
  ingest_secret text not null,
  dashboard_token text not null unique,
  active boolean not null default true
);
```

- `ingest_secret`: **um por cliente**, revogável individualmente (troca a linha).
- `dashboard_token`: token aleatório que vai no link do dashboard do cliente.
- Adicionar cliente = inserir 1 linha. Zero redeploy.

### 2. Ingestão (`api/ingest.js`)

Trocar a comparação com `INGEST_SECRET`/`ALLOWED_SITE` únicos por um lookup:

1. Ler `site` do payload.
2. Buscar em `clients` a linha com esse `site` e `active = true`.
3. Comparar `x-ingest-secret` com `clients.ingest_secret` dessa linha.
4. Se não bater, 401/403.

Os env vars `INGEST_SECRET` e `ALLOWED_SITE` deixam de ser usados (podem sair).

### 3. Isolamento de leitura (RLS por site via JWT)

Hoje o RLS permite `anon` ler tudo (`using (true)`). No multi-tenant:

- Novo endpoint `api/token.js`: recebe `dashboard_token`, valida em `clients`,
  e emite um **JWT do Supabase** (assinado com o JWT secret do projeto) com claim `site`.
- O dashboard usa esse JWT nas queries **e no Realtime** (mesmo token).
- Substituir a policy de leitura:

```sql
drop policy "Allow public read load events" on public.load_events;

create policy "Read own site"
on public.load_events
for select
to authenticated
using (site = auth.jwt() ->> 'site');
```

### 4. Painel admin (Linka vê todos)

- `api/token.js` também emite um JWT com claim `is_admin = true` (protegido por um
  segredo de admin, ex.: `ADMIN_SECRET`).
- Policy considerando admin:

```sql
create policy "Admin reads all"
on public.load_events
for select
to authenticated
using ( coalesce((auth.jwt() ->> 'is_admin')::boolean, false) );
```

- Dashboard admin ganha um seletor de `site` no topo.

## Fluxo final

```
Cliente → dashboard?token=XYZ → /api/token → JWT(site)  → Supabase (RLS filtra por site)
Linka   → painel admin        → /api/token → JWT(admin) → Supabase (vê todos)
GTM     → /api/ingest (secret do cliente) → lookup em clients → grava
```

## Cuidado durante a transição

**Não enviar link de dashboard para nenhum cliente enquanto o passo 3 (isolamento de
leitura) não estiver pronto.** Com o RLS atual (`using (true)`), qualquer anon key lê os
dados de todos os sites. Até o isolamento existir, o dashboard é **interno da Linka**.

## Novos env vars (fase 2)

```
SUPABASE_JWT_SECRET=   (Project Settings → API → JWT Settings)
ADMIN_SECRET=          (segredo para emitir JWT de admin)
```
