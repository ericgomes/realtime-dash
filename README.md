# Realtime Dash — prospin.com.br

Dashboard simples em HTML puro para monitorar, em tempo real, a performance de carregamento de páginas de usuários reais. O caso inicial é o `prospin.com.br`, após troca/migração de site — o objetivo é identificar se usuários reais (especialmente em **iPhone / Safari**) estão sofrendo com carregamento lento.

## Arquitetura

```
GTM (site) --> POST /api/ingest (Vercel) --> Supabase Postgres
                                                    |
                                          Supabase Realtime
                                                    |
                                          public/index.html (dashboard)
```

- **Deploy:** Vercel.
- **Frontend:** HTML puro em `public/` (Tailwind e Supabase JS via CDN).
- **Ingestão:** Vercel Serverless Function em `api/ingest.js`.
- **Banco:** Supabase Postgres.
- **Tempo real:** Supabase Realtime.

### Regras de segurança

- O GTM **nunca** grava direto no Supabase. Ele só chama `POST /api/ingest`.
- A API valida um segredo simples (`x-ingest-secret`) e só então grava.
- O insert usa `SUPABASE_SERVICE_ROLE_KEY`, que **só existe no backend** (`api/ingest.js`).
- O frontend usa apenas `SUPABASE_ANON_KEY`, que só tem permissão de **leitura** (via RLS).
- Nenhuma chave `service_role` aparece no frontend.

## Estrutura

```
realtime-dash/
  api/
    ingest.js
  public/
    index.html
  supabase/
    schema.sql
  package.json
  .env.example
  README.md
```

---

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
2. Escolha uma região próxima (ex.: São Paulo / `sa-east-1`).
3. Guarde a senha do banco.
4. Em **Project Settings → API**, copie:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta, nunca exponha)

## 2. Executar o schema

1. No painel do Supabase, abra **SQL Editor → New query**.
2. Cole todo o conteúdo de `supabase/schema.sql`.
3. Clique em **Run**.

Isso cria a tabela `public.load_events`, os índices, ativa **Row Level Security** e cria a policy que permite apenas **leitura** pública (`anon`).

> **Importante:** não existe policy de `insert` público. Qualquer tentativa de gravar direto no Supabase pelo frontend/GTM é bloqueada pelo RLS. O insert acontece **apenas** pela API da Vercel, que usa `SUPABASE_SERVICE_ROLE_KEY` (essa chave ignora o RLS).

## 3. Ativar o Realtime para a tabela

1. No Supabase, vá em **Database → Replication** (ou **Realtime**).
2. Localize a publicação `supabase_realtime`.
3. Adicione a tabela `public.load_events`.

Alternativa via SQL:

```sql
alter publication supabase_realtime add table public.load_events;
```

Sem esse passo, o dashboard ainda funciona pelo fallback de 30s, mas não recebe inserts em tempo real.

## 4. Configurar variáveis de ambiente na Vercel

No projeto da Vercel, em **Settings → Environment Variables**, adicione:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx
INGEST_SECRET=troque-este-segredo
ALLOWED_SITE=prospin.com.br
```

- `SUPABASE_SERVICE_ROLE_KEY` é usada **somente** em `api/ingest.js`.
- `INGEST_SECRET` é o segredo que o GTM envia no header `x-ingest-secret`.
- `ALLOWED_SITE` restringe qual `site` pode gravar.

## 5. Configurar o `index.html`

No topo do `<script>` em `public/index.html`, preencha:

```javascript
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'xxxxx';
const SITE = 'prospin.com.br';
```

Use aqui a **anon key** — nunca a service_role.

## 6. Rodar localmente

```bash
npm install
vercel dev
```

- Dashboard: `http://localhost:3000`
- API: `http://localhost:3000/api/ingest`

Com `vercel dev`, as variáveis de ambiente vêm de um arquivo `.env` local (copie de `.env.example`) ou das variáveis já vinculadas ao projeto Vercel.

## 7. Publicar na Vercel

Opção CLI:

```bash
vercel        # deploy de preview
vercel --prod # deploy de produção
```

Opção Git: conecte o repositório no painel da Vercel e cada push publica automaticamente. Garanta que as variáveis de ambiente do passo 4 estão configuradas.

## 8. Configurar a tag no GTM

Crie uma tag do tipo **HTML personalizado** com o gatilho **Window Loaded**.

Troque `SEU-PROJETO.vercel.app` pela sua URL da Vercel e `SEU_SEGREDO_AQUI` pelo valor de `INGEST_SECRET`.

```html
<script>
(function() {
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

  fetch('https://SEU-PROJETO.vercel.app/api/ingest', {
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

### Por que `fetch` com `keepalive` e não `sendBeacon`?

`navigator.sendBeacon` é ótimo para enviar dados no unload, mas **não permite definir headers customizados** facilmente — e precisamos do header `x-ingest-secret`. Por isso usamos `fetch` com `keepalive: true`, que envia a requisição mesmo que a página esteja sendo descarregada e ainda permite headers customizados.

> **Nota:** o segredo fica visível no código da tag (é client-side). Ele serve para reduzir ruído/spam casual, não é uma barreira criptográfica. Combine com `ALLOWED_SITE` e, se necessário, rotacione o `INGEST_SECRET` periodicamente.

## 9. Testar com curl

```bash
curl -X POST "http://localhost:3000/api/ingest" \
  -H "content-type: application/json" \
  -H "x-ingest-secret: teste123" \
  -d '{
    "site": "prospin.com.br",
    "page_location": "https://www.prospin.com.br/",
    "page_path": "/",
    "load_time_ms": 6200,
    "dom_ready_ms": 2300,
    "ttfb_ms": 900,
    "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "width": 390,
    "height": 844,
    "effective_type": "4g",
    "downlink": 8,
    "timestamp": "2026-07-08T23:00:00.000Z"
  }'
```

Resposta esperada: `{ "ok": true }`. O evento deve aparecer na tabela `load_events` e, com o dashboard aberto, surgir em tempo real (esse exemplo cai como **lento**, pois `load_time_ms >= 5000`).

Respostas de erro:

- `405` — método diferente de POST.
- `401` — header `x-ingest-secret` ausente ou incorreto.
- `403` — `site` diferente de `ALLOWED_SITE`.

---

## Como interpretar as métricas

- **`load_time_ms`** — tempo total até o `load` da página (do início da navegação até `loadEventEnd`). É a métrica principal de "página pronta".
- **`dom_ready_ms`** — tempo até o `DOMContentLoaded`. Mede quando o HTML/estrutura está pronto, antes de imagens e recursos pesados.
- **`ttfb_ms`** — *Time To First Byte*, tempo entre a requisição e o primeiro byte da resposta. TTFB alto indica lentidão de servidor/rede, não de frontend.
- **p95** — 95% dos eventos carregaram nesse tempo ou menos. É melhor que a média para enxergar a cauda ruim: se a média está boa mas o p95 está alto, uma parcela relevante de usuários está sofrendo.
- **Eventos lentos** — `load_time_ms >= 5000` (5s). Sinaliza experiência ruim.
- **Eventos muito lentos** — `load_time_ms >= 10000` (10s). Experiência crítica, alta chance de abandono.

Para o objetivo do projeto, olhe especialmente o cruzamento **iPhone / Safari** com **p95** e **% lento**: é ali que problemas de migração costumam aparecer primeiro.

### Normalização aplicada na ingestão

- Tempos (`load_time_ms`, `dom_ready_ms`, `ttfb_ms`) viram inteiros; valores negativos ou acima de `120000` ms viram `null`.
- `width` / `height` viram inteiros.
- `page_path` recebe `/` no início se não tiver.
- `event_timestamp` usa o `timestamp` do payload se válido, senão a hora atual.
- Campos derivados (`is_slow`, `is_very_slow`, `is_mobile`, `is_iphone`, `is_android`, `browser`, `os`, `device_label`) são calculados no servidor.
- O payload original é sempre guardado em `raw`.
