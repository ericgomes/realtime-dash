# Realtime Dash

Ferramenta **multi-tenant** de monitoramento de performance de carregamento (RUM) para múltiplos clientes/sites. O foco é identificar, por percentuais e comparativos, se usuários reais — especialmente em **iPhone / Safari** — estão sofrendo com lentidão.

## Arquitetura

```
GTM (site) --> POST /api/ingest?tenant=slug --> load_events (bruto, com tenant_id)
                                                        |
                                          /api/aggregate (Vercel Cron)
                                                        |
                                          load_summary_snapshots (agregado por tenant/período)
                                                        |
                                          GET /api/summary?tenant=slug&period=60m
                                                        |
                                          public/index.html (dashboard com charts)
```

- **Multi-tenant:** um único Supabase/database, tabelas compartilhadas com `tenant_id`. Config por cliente na tabela `tenants` (retenção, thresholds, freshness, timezone, domínios).
- **Ingestão:** `api/ingest.js` (query `?tenant=`) e `api/ingest/[tenantSlug].js` (rota dinâmica). Valida segredo + `allowed_domains`, aplica thresholds do tenant, grava bruto.
- **Agregação:** `api/aggregate.js` roda por cron, gera snapshots por tenant/período. O frontend **não lê mais eventos brutos** — lê só o snapshot.
- **Dashboard:** HTML puro + Tailwind + Chart.js, consome `/api/summary`. Percentuais, rankings e gráficos comparativos.
- **Segurança:** `SUPABASE_SERVICE_ROLE_KEY` só no backend. Insert de eventos/snapshots só via API. Frontend usa apenas os endpoints.

## Recursos em produção

| Recurso | Onde |
|---|---|
| Dashboard | https://realtime-dash-eric-9609s-projects.vercel.app/?token=&lt;view_token&gt; (link no /admin.html) |
| Ingestão | https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest (header x-ingest-token) |
| Summary | https://realtime-dash-eric-9609s-projects.vercel.app/api/summary?token=&lt;view_token&gt;&period=60m |
| Repositório | https://github.com/ericgomes/realtime-dash |
| Banco | Supabase (projeto `qbrjymubcwzboyhtjafd`) |

Variáveis de ambiente na Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET`, `CRON_SECRET`.

---

## Modelo de dados (multi-tenant)

- **`tenants`** — um registro por cliente/site. Config: `slug`, `name`, `site`, `allowed_domains[]`, `is_active`, `retention_days`, `aggregation_freshness_minutes`, `default_period_key`, `min_group_size`, `slow_threshold_ms`, `very_slow_threshold_ms`, `timezone`.
- **`load_events`** — eventos brutos, com `tenant_id` obrigatório.
- **`load_summary_snapshots`** — snapshots agregados por tenant/período, lidos pelo dashboard.

### Criar / editar tenants (tela de admin)

Abra **`/admin.html`** (protegida por `ADMIN_SECRET`). Nela dá para criar tenants, editar toda a config (domínios, thresholds, sample rate, retenção, etc.), ver/copiar/regenerar o `ingest_token` e ativar/desativar. Requer a env var `ADMIN_SECRET` na Vercel.

Alternativa via SQL:

```sql
insert into public.tenants (slug, name, site, allowed_domains)
values ('fisk', 'Fisk', 'fisk.com.br', array['fisk.com.br', 'www.fisk.com.br']);
```

Cada tenant tem `ingest_token` (tag do GTM) e `view_token` (link do dashboard), gerados automaticamente. O dashboard é aberto pelo link `/?token=<view_token>` (copie no `/admin.html`).

## Setup / migração

1. **Schema:** rodar `supabase/schema.sql` no SQL Editor (idempotente — cria `tenants`, `tenant_id`, `load_summary_snapshots`, índices, RLS).
2. **Retenção antiga:** a retenção agora é por tenant (via `/api/aggregate`). Se existia o job `pg_cron` antigo de 7 dias, remova:
   ```sql
   select cron.unschedule('purge_load_events');
   ```
3. **Env na Vercel:** adicionar `CRON_SECRET` (segredo forte). O Vercel Cron autentica automaticamente enviando `Authorization: Bearer ${CRON_SECRET}`.
4. **Cron:** já configurado em `vercel.json` (`*/1 * * * *`). **Atenção:** no plano **Hobby** o cron da Vercel roda no máximo 1x/dia — para agregação de minuto em minuto, use plano **Pro** ou um cron externo (ex.: cron-job.org) chamando `/api/aggregate?secret=CRON_SECRET`.

## Tag do GTM (loader)

Tag **HTML personalizado**, gatilho **All Pages**. A tag é só um *loader*: a lógica de RUM mora em [`public/lsm.js`](public/lsm.js), servido pela Vercel. Cole o snippet **uma vez** no GTM de cada cliente e, daí em diante, **qualquer mudança no `lsm.js` propaga sozinha** para todos os sites — sem reeditar/publicar o GTM.

```html
<script async src="https://realtime-dash-eric-9609s-projects.vercel.app/lsm.js"
  data-token="SEU_TOKEN_DO_TENANT" data-sample="10"></script>
```

- `data-token` = `ingest_token` do cliente (em `tenants.ingest_token`). Identifica **e** autentica (não use `?tenant=slug`, que é adivinhável); por-cliente e revogável: `update tenants set ingest_token = 'ing_' || encode(gen_random_bytes(20),'hex') where slug = '...';`.
- `data-sample` = amostragem **em %** (ex.: `10` = 10%, `5` = 5%), enviada no payload para o backend estimar o total real. O `lsm.js` deriva a URL da API do próprio `src`.

**SPA (mesma tag):** o `lsm.js` detecta troca de rota sem reload — faz *patch* de `history.pushState`/`replaceState` e escuta `popstate`. O carregamento real envia os tempos (`nav_type: 'load'`); cada navegação SPA envia um pageview **sem tempos** (`nav_type: 'spa'`), então conta no volume mas **não entra** nas métricas de load (o backend ignora eventos sem `load_time_ms`). Em site que não é SPA os listeners nunca disparam. Não precisa de trigger extra nem de mudança no banco (`nav_type` fica no `raw`).

> Se o site do cliente tiver CSP, o domínio da Vercel precisa estar em **dois** lugares: `script-src` (para carregar o `lsm.js`) e `connect-src` (para o `fetch` de ingestão).

## Endpoints

```bash
# Ingerir um evento (token do tenant identifica e autentica)
curl -X POST "https://SEU-PROJETO.vercel.app/api/ingest" \
  -H "content-type: application/json" \
  -H "x-ingest-token: SEU_TOKEN_DO_TENANT" \
  -d '{"site":"prospin.com.br","page_path":"/","load_time_ms":6200,"user_agent":"Mozilla/5.0 (iPhone; ... Safari/604.1"}'

# Rodar a agregação manualmente
curl "https://SEU-PROJETO.vercel.app/api/aggregate?secret=SEU_CRON_SECRET"

# Ler o resumo mais recente
curl "https://SEU-PROJETO.vercel.app/api/summary?tenant=prospin&period=60m"
```

## Dashboard

Aberto pelo link com token: `/?token=<view_token>` (copie no `/admin.html`). Foco em **percentuais e comparação**, não em lista de eventos.

- **Cards:** page views no período (+ estimativa real), page views/hora e /min (velocidade estimada), load médio, load p95, TTFB médio, DOM Ready médio (2 casas decimais), % ≥ 5s, % ≥ 10s (limites do tenant). "Page view" = um carregamento de página (window load).
- **Charts:** distribuição por tempo de carregamento, tempos médios (TTFB/DOM/Load), load p95 por página, por device/browser e por conexão.
- **Tabelas:** por página, device/browser, browser e OS (ordenadas por p95).
- **Filtros:** período (15m–3h), mínimo por grupo, busca de página e selects de device e browser (populados com os valores reais). Atualização automática (30s) + cron.

A apresentação é neutra: o dashboard mostra tempos e distribuições factuais (faixas de tempo), sem rotular acessos como "lentos".

Os dados podem estar atrasados conforme `aggregation_freshness_minutes` do tenant (padrão 1 min).

### Como interpretar

- **`% lento ou muito lento`** — proporção de acessos com load ≥ `slow_threshold_ms`. Métrica principal.
- **`% muito lento`** — load ≥ `very_slow_threshold_ms`. Experiência crítica.
- **p95** — 95% dos acessos carregaram nesse tempo ou menos. Enxerga a cauda ruim.
- **TTFB / DOM Ready / Load médios** — ajudam a localizar o gargalo (servidor vs frontend vs total).
- **score** = `slowOrVerySlowPercent + verySlowPercent * 2` — ordena os piores grupos.

## Escala e custo

- **Amostragem na tag do GTM** (`SAMPLE_PERCENT`, em %, padrão 10), enviada no payload como `sample_rate`. Reduz invocações da Vercel **e** storage. O backend aceita o valor em % (>1) ou fração (≤1) e normaliza; guarda a taxa efetiva por evento e estima o total real somando `1/taxa`. O dashboard mostra a amostra e a estimativa.
- **Rede de segurança:** `tenants.sample_rate` é um **teto** por cliente (também aceita % ou fração). Se um evento chegar sem amostragem (ex.: removeram o `SAMPLE_PERCENT` da tag), o `/api/ingest` re-amostra no servidor até esse teto — protegendo o custo mesmo com erro no GTM.
- **Retenção por tenant** (`retention_hours`, padrão **3h**): é um monitor ao vivo, não um histórico (o GA4 cobre o passado). O `/api/aggregate` descarta eventos brutos com mais de 3h. Por isso os períodos vão só até 3h.
- Como o dashboard lê snapshots pequenos (não milhares de eventos), o front escala bem mesmo com tráfego alto.

## Multi-cliente — isolamento de leitura

O dashboard **isola por cliente via `view_token`**: a URL é `/?token=<view_token>` (não `?tenant=slug`), e o `/api/summary` resolve o cliente pelo token — sem token válido, não retorna nada, e não dá pra adivinhar outro cliente. Como o frontend lê **apenas** via `/api/summary` (não acessa o Supabase direto) e a leitura anon de `load_events` foi removida, isso já é isolamento real, sem precisar de RLS/JWT no cliente.

Cada tenant tem `ingest_token` (escrita, na tag do GTM) e `view_token` (leitura, no link do dashboard), separados e revogáveis no `/admin.html`. Pegue o link pronto de cada cliente no card do `/admin.html` ("Link do dashboard").

## Desenvolvimento local

```bash
npm install
vercel dev
```

Dashboard em `http://localhost:3000/?tenant=prospin`. As funções (`/api/*`) precisam das env vars (via `.env` local ou projeto vinculado na Vercel).
