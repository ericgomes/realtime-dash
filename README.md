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
| Dashboard | https://realtime-dash-eric-9609s-projects.vercel.app/?tenant=prospin |
| Ingestão | https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest?tenant=prospin |
| Summary | https://realtime-dash-eric-9609s-projects.vercel.app/api/summary?tenant=prospin&period=60m |
| Repositório | https://github.com/ericgomes/realtime-dash |
| Banco | Supabase (projeto `qbrjymubcwzboyhtjafd`) |

Variáveis de ambiente na Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET`, `CRON_SECRET`.

---

## Modelo de dados (multi-tenant)

- **`tenants`** — um registro por cliente/site. Config: `slug`, `name`, `site`, `allowed_domains[]`, `is_active`, `retention_days`, `aggregation_freshness_minutes`, `default_period_key`, `min_group_size`, `slow_threshold_ms`, `very_slow_threshold_ms`, `timezone`.
- **`load_events`** — eventos brutos, com `tenant_id` obrigatório.
- **`load_summary_snapshots`** — snapshots agregados por tenant/período, lidos pelo dashboard.

### Criar um novo tenant

No SQL Editor do Supabase:

```sql
insert into public.tenants (slug, name, site, allowed_domains)
values ('fisk', 'Fisk', 'fisk.com.br', array['fisk.com.br', 'www.fisk.com.br']);
```

Depois use `?tenant=fisk` na ingestão e no dashboard. Os demais campos têm defaults sensatos e podem ser ajustados por `update`.

## Setup / migração

1. **Schema:** rodar `supabase/schema.sql` no SQL Editor (idempotente — cria `tenants`, `tenant_id`, `load_summary_snapshots`, índices, RLS).
2. **Retenção antiga:** a retenção agora é por tenant (via `/api/aggregate`). Se existia o job `pg_cron` antigo de 7 dias, remova:
   ```sql
   select cron.unschedule('purge_load_events');
   ```
3. **Env na Vercel:** adicionar `CRON_SECRET` (segredo forte). O Vercel Cron autentica automaticamente enviando `Authorization: Bearer ${CRON_SECRET}`.
4. **Cron:** já configurado em `vercel.json` (`*/1 * * * *`). **Atenção:** no plano **Hobby** o cron da Vercel roda no máximo 1x/dia — para agregação de minuto em minuto, use plano **Pro** ou um cron externo (ex.: cron-job.org) chamando `/api/aggregate?secret=CRON_SECRET`.

## Tag do GTM

Tag **HTML personalizado**, gatilho **Window Loaded**. Trocar `SEU_SEGREDO_AQUI` por `INGEST_SECRET`. O `SAMPLE_RATE` controla a amostragem (10% = envia 1 em cada 10) e é **enviado no payload** para o backend estimar o total real.

```html
<script>
(function() {
  var SAMPLE_RATE = 0.10;
  if (Math.random() >= SAMPLE_RATE) return;

  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (!nav) return;

  var payload = {
    site: 'prospin.com.br',
    page_location: location.href,
    page_path: location.pathname,
    sample_rate: SAMPLE_RATE,
    load_time_ms: Math.round(nav.loadEventEnd - nav.startTime),
    dom_ready_ms: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
    ttfb_ms: Math.round(nav.responseStart - nav.requestStart),
    user_agent: navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    timestamp: new Date().toISOString()
  };

  if (navigator.connection) {
    payload.effective_type = navigator.connection.effectiveType || null;
    payload.downlink = navigator.connection.downlink || null;
  }

  fetch('https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest?tenant=prospin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-secret': 'SEU_SEGREDO_AQUI' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(function() {});
})();
</script>
```

> O domínio de ingestão precisa estar no `connect-src` do CSP do site. Ver seção CSP.

## Endpoints

```bash
# Ingerir um evento
curl -X POST "https://SEU-PROJETO.vercel.app/api/ingest?tenant=prospin" \
  -H "content-type: application/json" \
  -H "x-ingest-secret: SEU_SEGREDO" \
  -d '{"site":"prospin.com.br","page_path":"/","load_time_ms":6200,"user_agent":"Mozilla/5.0 (iPhone; ... Safari/604.1"}'

# Rodar a agregação manualmente
curl "https://SEU-PROJETO.vercel.app/api/aggregate?secret=SEU_CRON_SECRET"

# Ler o resumo mais recente
curl "https://SEU-PROJETO.vercel.app/api/summary?tenant=prospin&period=60m"
```

## Dashboard

`/?tenant=prospin`. Foco em **percentuais e comparação**, não em lista de eventos.

- **Cards:** eventos, load médio, load p95, TTFB médio, DOM Ready médio, % ≥ 5s, % ≥ 10s (os limites vêm dos thresholds do tenant).
- **Charts:** distribuição por tempo de carregamento, tempos médios (TTFB/DOM/Load), load p95 por página, por device/browser e por conexão.
- **Tabelas:** por página, device/browser, browser e OS (ordenadas por p95).
- **Filtros:** período (15m–24h), mínimo por grupo, e selects de página, device e browser (populados com os valores reais). Atualização automática (30s) + cron.

A apresentação é neutra: o dashboard mostra tempos e distribuições factuais (faixas de tempo), sem rotular acessos como "lentos".

Os dados podem estar atrasados conforme `aggregation_freshness_minutes` do tenant (padrão 1 min).

### Como interpretar

- **`% lento ou muito lento`** — proporção de acessos com load ≥ `slow_threshold_ms`. Métrica principal.
- **`% muito lento`** — load ≥ `very_slow_threshold_ms`. Experiência crítica.
- **p95** — 95% dos acessos carregaram nesse tempo ou menos. Enxerga a cauda ruim.
- **TTFB / DOM Ready / Load médios** — ajudam a localizar o gargalo (servidor vs frontend vs total).
- **score** = `slowOrVerySlowPercent + verySlowPercent * 2` — ordena os piores grupos.

## Escala e custo

- **Amostragem na tag do GTM** (`SAMPLE_RATE`, padrão 0.10), enviada no payload como `sample_rate`. Reduz invocações da Vercel **e** storage. O backend guarda o `sample_rate` efetivo por evento e estima o total real somando `1/sample_rate` (correto mesmo com taxas diferentes). O dashboard mostra a amostra e a estimativa.
- **Rede de segurança:** `tenants.sample_rate` é um **teto** por cliente. Se um evento chegar sem amostragem (ex.: alguém removeu o `SAMPLE_RATE` da tag), o `/api/ingest` re-amostra no servidor até esse teto — protegendo o custo mesmo com erro no GTM.
- **Retenção por tenant** (`retention_days`): `/api/aggregate` apaga eventos brutos antigos e snapshots com mais de 7 dias.
- Como o dashboard lê snapshots pequenos (não milhares de eventos), o front escala bem mesmo com tráfego alto.

## Multi-cliente — isolamento de leitura (futuro)

Hoje o dashboard/summary não isolam leitura por cliente via auth. O plano de isolamento (RLS/JWT por site, painel admin) está em [`docs/multi-tenant.md`](docs/multi-tenant.md). Enquanto não existir, o dashboard é **interno da Linka**.

## Desenvolvimento local

```bash
npm install
vercel dev
```

Dashboard em `http://localhost:3000/?tenant=prospin`. As funções (`/api/*`) precisam das env vars (via `.env` local ou projeto vinculado na Vercel).
