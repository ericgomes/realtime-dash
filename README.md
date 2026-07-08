# Realtime Dash — prospin.com.br

Dashboard em HTML puro para monitorar, em tempo real, a performance de carregamento de páginas de usuários reais do `prospin.com.br`. Objetivo: identificar se usuários reais — especialmente em **iPhone / Safari** — estão sofrendo com carregamento lento após a migração do site.

## Arquitetura

```
GTM (site) --> POST /api/ingest (Vercel) --> Supabase Postgres
                                                    |
                                          Supabase Realtime
                                                    |
                                          public/index.html (dashboard)
```

- **Frontend:** HTML puro em `public/` (Tailwind e Supabase JS via CDN).
- **Ingestão:** Vercel Serverless Function em `api/ingest.js`.
- **Banco:** Supabase Postgres com RLS (leitura pública, insert só pela API).
- **Tempo real:** Supabase Realtime.

O GTM **nunca** grava direto no Supabase — só chama `POST /api/ingest`, que valida o segredo (`x-ingest-secret`) e o `site`, e grava usando `SUPABASE_SERVICE_ROLE_KEY` (que só existe no backend). O frontend usa apenas a `SUPABASE_ANON_KEY`, com permissão de **leitura** via RLS.

## Recursos em produção

| Recurso | Onde |
|---|---|
| Dashboard | https://realtime-dash-eric-9609s-projects.vercel.app |
| API de ingestão | https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest |
| Repositório | https://github.com/ericgomes/realtime-dash |
| Banco | Supabase (projeto `qbrjymubcwzboyhtjafd`) |

Variáveis de ambiente na Vercel (já configuradas): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET`, `ALLOWED_SITE`. A `SUPABASE_SERVICE_ROLE_KEY` só é usada em `api/ingest.js` e nunca aparece no frontend.

---

## O que falta para o go-live

### 1. Liberar o domínio no CSP do site

O site do prospin tem um `Content-Security-Policy` cuja diretiva `connect-src` restringe para onde a página pode enviar requisições. O domínio de ingestão precisa estar nessa lista, senão o navegador bloqueia o envio das métricas.

Pedir ao responsável pelo site para adicionar em `connect-src`:

```
https://realtime-dash-eric-9609s-projects.vercel.app
```

> Se no futuro a ingestão migrar para um domínio próprio (ex.: `ingest.agencialinka.com.br`), basta liberar esse domínio no CSP e trocar a URL do `fetch` na tag do GTM.

### 2. Configurar a tag no GTM

Criar uma tag do tipo **HTML personalizado** com o gatilho **Window Loaded**. Trocar `SEU_SEGREDO_AQUI` pelo valor de `INGEST_SECRET`.

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

  fetch('https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ingest-secret': 'SEU_SEGREDO_AQUI'
    },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(function() {});
})();
</script>
```

Usar sempre a **URL de produção** (acima) no `fetch` — nunca uma URL de deploy com hash, pois ela aponta para um deploy congelado.

**Por que `fetch` com `keepalive` e não `sendBeacon`:** o `sendBeacon` não permite header customizado facilmente, e precisamos do `x-ingest-secret`. O `fetch` com `keepalive: true` envia mesmo durante o unload e permite headers.

> O segredo fica visível no código da tag (é client-side). Ele reduz spam casual, não é barreira criptográfica. A proteção real é o RLS + `service_role` só no backend + validação de `ALLOWED_SITE`.

### 3. Validar e publicar

1. **Preview** no GTM → navegar no prospin → confirmar `200` no `/api/ingest` (aba Network) e o evento aparecendo no dashboard em tempo real.
2. **Publish** o container no GTM.
3. Limpar os eventos de teste (abaixo).

---

## Testar a ingestão (curl)

Substituir `SEU_SEGREDO` pelo valor de `INGEST_SECRET`. Resposta esperada: `{"ok":true}`.

```bash
curl -X POST "https://realtime-dash-eric-9609s-projects.vercel.app/api/ingest" \
  -H "content-type: application/json" \
  -H "x-ingest-secret: SEU_SEGREDO" \
  -d '{"site":"prospin.com.br","page_path":"/","load_time_ms":6200,"user_agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"}'
```

Respostas de erro: `401` (segredo inválido), `403` (site diferente de `ALLOWED_SITE`), `405` (método diferente de POST).

## Limpar dados de teste

Antes de entrar tráfego real, zerar a tabela no **SQL Editor** do Supabase:

```sql
truncate table public.load_events;
```

---

## Como interpretar as métricas

- **`load_time_ms`** — tempo total até o `load` da página. Métrica principal de "página pronta".
- **`dom_ready_ms`** — tempo até o `DOMContentLoaded` (estrutura pronta, antes de imagens/recursos pesados).
- **`ttfb_ms`** — *Time To First Byte*. TTFB alto indica lentidão de servidor/rede, não de frontend.
- **p95** — 95% dos eventos carregaram nesse tempo ou menos. Melhor que a média para enxergar a cauda ruim.
- **Eventos lentos** — `load_time_ms >= 5000` (5s). Experiência ruim.
- **Eventos muito lentos** — `load_time_ms >= 10000` (10s). Experiência crítica.

Para o objetivo do projeto, olhar o cruzamento **iPhone / Safari** com **p95** e **% lento** — é onde problemas de migração aparecem primeiro.

## Escala e custo

O prospin tem volume alto (~2M carregamentos/mês, mais em campanhas). Duas medidas mantêm o custo previsível:

- **Amostragem (10%)** — a tag do GTM só envia uma fração dos carregamentos (`SAMPLE_RATE = 0.10`). É amostragem **uniforme** (mesma taxa pra todos), então `p95`, `% lento` e médias continuam sendo estimativas corretas do total. Apenas os números **absolutos** ficam em escala — multiplique por `1/SAMPLE_RATE` (10x) para o volume real. Para ajustar, mude `SAMPLE_RATE` na tag e republique o container.
- **Retenção (7 dias)** — um job `pg_cron` apaga eventos antigos todo dia às 3h, mantendo o storage estável. Rodar uma vez, no **SQL Editor** do Supabase:

```sql
-- conteúdo de supabase/retention.sql
```

Para conferir o job agendado: `select * from cron.job;`. Para trocar a janela, reagende com outro `interval`.

## Multi-cliente (futuro)

O refactor para multi-tenant (tabela `clients`, segredo por cliente, isolamento de leitura por site via RLS/JWT, painel admin) está desenhado em [`docs/multi-tenant.md`](docs/multi-tenant.md). Enquanto o isolamento de leitura não existir, **o dashboard é interno da Linka** — não enviar link para clientes, pois o RLS atual deixa a anon key ler todos os sites.

## Desenvolvimento local

```bash
npm install
vercel dev
```

Dashboard em `http://localhost:3000`, API em `http://localhost:3000/api/ingest`. As variáveis de ambiente vêm do projeto vinculado na Vercel ou de um `.env` local (ver `.env.example`).
